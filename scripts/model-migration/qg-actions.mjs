import { parseRepo } from './repos.mjs';

// SPRINT_LORE_ADMIN_POLISH/AP-DICT-UPSERT-DUP · настройка qg.actions_projects → гейт канала Actions с ребром на проект.
// Решение владелицы 21.11.2026 «перевязать не к репозиторию, а к проекту, они схлопнутся»; выбор владельца 23.11.2026 —
// вариант «а»: гейт QG-LORE-CI-ACTIONS с ребром BELONGS_TO_PROJECT (то же ребро, что у проектного гейта, QG-01);
// настройка удаляется. На снимке прода две строки на один ключ — «AIDA/UnlimitedLORE» (путь основного репозитория на
// Forgejo) и «NooriUta/UnlimitedLORE» (slug проекта): уникальный индекс справочника из-за них не создавался, чтение по
// ключу видело одну. Обе ведут в один проект — гейт один.
//
// Шаг 2 (transfer.mjs): строки настройки снимаются из справочника, убыль — в остаток с причиной.
// Шаг связей (transfer-edges.mjs, после охвата гейтов): гейта канала Actions в источнике нет — он заводится в приёмнике
// с ребром на проект; опросчик LoreQgActionsPoller берёт проекты из таких гейтов. Повторный перенос даёт тот же итог.

export const SETTING = { dict_type: 'app_setting', code: 'qg.actions_projects' };
export const ACTIONS_ROUTINE = 'qg-actions-poll';
export const GATE_ID = 'QG-LORE-CI-ACTIONS';
const SRC_KEY = 'from-setting:' + SETTING.code;
const ROUTINE_RE = /\*\*Routine:\*\*\s*`([^`]+)`/;

/** Гейт канала Actions: рутина полем routine_name или «**Routine:** `qg-actions-poll`» в тексте; снятый не в счёт. */
export function isActionsGate(g) {
  if (!g || g.status === 'retired') return false;
  if (typeof g.routine_name === 'string' && g.routine_name.trim() === ACTIONS_ROUTINE) return true;
  const m = typeof g.content_md === 'string' ? g.content_md.match(ROUTINE_RE) : null;
  return m ? m[1].trim() === ACTIONS_ROUTINE : String(g.qg_id || '').toLowerCase() === ACTIONS_ROUTINE;
}

/** Строки справочника [{rid, res:{out}}] → без строк настройки; values — их значения, leftovers — убыль с причиной. */
export function splitActionsSetting(rows) {
  const keep = [], values = [], leftovers = [];
  for (const r of rows) {
    const o = r.res.out;
    if (o.dict_type !== SETTING.dict_type || o.code !== SETTING.code) { keep.push(r); continue; }
    values.push(o.label_ru);
    leftovers.push({ src_rid: r.rid, field: 'label_ru', value: o.label_ru, kind: 'replaced_by_gate',
      why: `настройка ${SETTING.code} снята (AP-DICT-UPSERT-DUP, выбор владельца 23.11.2026 «а»): что опрашивать в Actions, `
        + `задаёт гейт ${GATE_ID} с ребром на проект; значение «${o.label_ru}» сведено к проекту` });
  }
  return { keep, values, leftovers };
}

/** Проект источника, в который ведёт значение: slug проекта или путь owner/name любого его адреса (основной, зеркало). */
function projectOf(value, projects) {
  const v = String(value || '').trim();
  for (const p of projects) {
    if (p.slug === v) return p.slug;
    for (const h of Array.isArray(p.hosts) ? p.hosts : []) {
      const r = parseRepo(h);
      if (r && `${r.owner}/${r.name}` === v) return p.slug;
    }
  }
  return null;
}

/**
 * План: values — значения настройки источника; gates — гейты источника [{qg_id, status, content_md, routine_name, projects}];
 * projects — проекты источника [{slug, hosts}]; anchorOf — проект → опора его группы после перегруппировки.
 * create — гейты к заведению [{qg_id, project}]; existing — гейты канала Actions, уже бывшие в источнике.
 */
export function planQgActions({ values = [], gates = [], projects = [], anchorOf = {} }) {
  const existing = gates.filter(isActionsGate).map(g => g.qg_id);
  const problems = [], targets = [];
  if (existing.length || !values.length) return { create: [], existing, problems };
  for (const v of values) {
    const slug = projectOf(v, projects);
    if (!slug) { problems.push({ value: v, kind: 'value_no_project' }); continue; }
    const t = anchorOf[slug] || slug;
    if (!targets.includes(t)) targets.push(t);
  }
  const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const create = targets.map((project, i) => ({ qg_id: targets.length === 1 ? GATE_ID : `QG-CI-ACTIONS-${norm(project)}`, project }));
  return { create, existing, problems };
}

/** Чтение источника (только чтение): значения настройки, гейты, проекты. Ключ ищется в JS — по WHERE code=… прод видел одну строку. */
export async function readQgActionsInput(db) {
  const dict = await db.src("SELECT code, label_ru FROM KnowDictEntry WHERE dict_type = 'app_setting'");
  const gates = await db.src("SELECT qg_id, status, content_md, routine_name, out('BELONGS_TO_PROJECT').slug AS projects FROM QualityGate ORDER BY qg_id");
  const projects = await db.src('SELECT slug, hosts FROM KnowGitProject');
  const hostsOf = h => { if (Array.isArray(h)) return h; try { return JSON.parse(h); } catch { return []; } };
  return {
    values: dict.filter(x => x.code === SETTING.code).map(x => x.label_ru).filter(Boolean),
    gates: gates.map(g => ({ ...g, projects: (Array.isArray(g.projects) ? g.projects : []).filter(Boolean) })),
    projects: projects.map(p => ({ slug: p.slug, hosts: hostsOf(p.hosts) })),
  };
}

/** Запись в приёмник и сверка «после»: у каждого гейта плана — рутина и ровно ребро на свой проект. */
export async function applyQgActions(db, plan, { log = console.log } = {}) {
  const created = [], missingProject = [];
  for (const c of plan.create) {
    const proj = await db.dstQuery('SELECT slug FROM KnowGitProject WHERE slug = :s', { s: c.project });
    if (!proj.length) { missingProject.push(c.project); continue; }
    const had = await db.dstQuery('SELECT qg_id FROM QualityGate WHERE qg_id = :id', { id: c.qg_id });
    if (!had.length) {
      await db.dstCommand('INSERT INTO QualityGate CONTENT :c', { c: {
        qg_id: c.qg_id, name: 'CI: прогоны Forgejo Actions', status: 'active', scope: 'project', routine_name: ACTIONS_ROUTINE,
        description: 'Канал 1 гейтов: опросчик LoreQgActionsPoller забирает прогоны Forgejo Actions репозиториев проекта.',
        content_md: `**Routine:** \`${ACTIONS_ROUTINE}\`\n\nКанал 1: прогоны Forgejo Actions основного репозитория проекта `
          + `(зеркала называются в журнале, но не опрашиваются). Заведён переносом из настройки ${SETTING.code} `
          + '(SPRINT_LORE_ADMIN_POLISH/AP-DICT-UPSERT-DUP).',
        mig_src_rid: `${SRC_KEY}:${c.qg_id}` } });
      created.push(c.qg_id);
    }
    await db.dstCommand('CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM QualityGate WHERE qg_id = :id) TO (SELECT FROM KnowGitProject WHERE slug = :s) IF NOT EXISTS',
      { id: c.qg_id, s: c.project });
  }
  const after = [];
  for (const c of plan.create) {
    if (missingProject.includes(c.project)) continue;
    const g = (await db.dstQuery("SELECT qg_id, status, content_md, routine_name, out('BELONGS_TO_PROJECT').slug AS projects FROM QualityGate WHERE qg_id = :id", { id: c.qg_id }))[0];
    after.push({ qg_id: c.qg_id, ok: !!g && isActionsGate(g) && Array.isArray(g.projects) && g.projects.includes(c.project) });
  }
  const ok = !missingProject.length && after.every(x => x.ok);
  log(`гейт канала Actions: заведено ${created.length} (${created.join(', ') || '—'}), были в источнике ${plan.existing.join(', ') || '—'}`
    + (plan.problems.length ? '; значения без проекта: ' + plan.problems.map(x => x.value).join(', ') : '')
    + (missingProject.length ? '; проекта нет в приёмнике: ' + missingProject.join(', ') : ''));
  log('сверка гейта канала Actions:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, created, existing: plan.existing, problems: plan.problems, missing_project: missingProject, after };
}
