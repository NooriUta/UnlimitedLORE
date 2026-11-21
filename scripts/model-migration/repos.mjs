// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · D-2026-MIG-REPOSITORY-ORGANIZATION.
// Владелица 19.11.2026: репозиторий — отдельный объект; владелец на хосте (AIDA, NooriUta, ciadmin) — его
// характеристика, вместе с хостом и именем даёт полный путь; у проекта один основной, сколько угодно зеркал и
// репозитории, от которых он зависит. Организация — самостоятельный объект, не git-пространство (здесь не выводится).
// Чистые функции (план) + запись в приёмник (applyRepos).

/** Запись адреса проекта ({role, base_url, default_branch}) → репозиторий; не адрес — null. Без роли — зеркало. */
export function parseRepo(h) {
  if (!h || typeof h.base_url !== 'string') return null;
  let u;
  try { u = new URL(h.base_url.trim()); } catch { return null; }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts;
  const url = `${u.protocol}//${u.host}/${owner}/${name}`;
  return { url, host: u.host, owner, name, full_path: `${u.host}/${owner}/${name}`, default_branch: h.default_branch || null, role: h.role === 'primary' ? 'primary' : 'mirror' };
}

/**
 * План по модели владелицы 19.11.2026: проект → один основной репозиторий; компонент → свой репозиторий;
 * репозиторий → зеркало (MIRRORED_TO); репозиторий → используемый (USES_REPOSITORY, данных пока нет).
 * srcProjects — проекты ИСТОЧНИКА (до перегруппировки), anchorOf — проект → опора его группы (или он сам),
 * componentIds — компоненты приёмника. Основной влитого проекта — репозиторий компонента с тем же именем;
 * компонента нет — unassigned («куда?»), группа не выдумывается.
 */
export function planRepos(srcProjects, anchorOf = {}, componentIds = [], overrides = {}) {
  const repos = new Map(), projectRepos = [], componentRepos = [], mirrors = [], unassigned = [], warnings = [];
  const norm = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const comps = new Map(componentIds.map(c => [norm(c), c]));
  const add = r => { if (!repos.has(r.url)) { const { role, ...rest } = r; repos.set(r.url, rest); } };
  for (const p of srcProjects) {
    const parsed = (Array.isArray(p.hosts) ? p.hosts : []).map(parseRepo).filter(Boolean);
    if (!parsed.length) continue;
    let primaries = parsed.filter(r => r.role === 'primary');
    if (primaries.length > 1) warnings.push(`${p.slug}: основных ${primaries.length} — основным оставлен ${primaries[0].url}`);
    if (!primaries.length) { warnings.push(`${p.slug}: основного нет — основным назначен ${parsed[0].url}`); primaries = [parsed[0]]; }
    const primary = primaries[0];
    parsed.forEach(add);
    for (const r of parsed) if (r.url !== primary.url && !mirrors.some(m => m.from === primary.url && m.to === r.url)) mirrors.push({ from: primary.url, to: r.url });
    const anchor = anchorOf[p.slug] || p.slug;
    if (anchor === p.slug) { projectRepos.push({ project: p.slug, url: primary.url }); continue; }
    // правка человека (файл решений, projects.repos): «это зеркало» — репозиторий только зеркало, связь уже есть
    // у основного; компонент — по слову, новый заводится переносом (create)
    const ov = overrides[p.slug];
    if (ov && ov.mirror) continue;
    if (ov && ov.component) {
      const known = comps.get(norm(ov.component));
      componentRepos.push({ component: known || ov.component, url: primary.url, project: anchor, ...(known ? {} : { create: true }) });
      continue;
    }
    const comp = comps.get(norm(primary.name)) || comps.get(norm(p.name));
    if (comp) componentRepos.push({ component: comp, url: primary.url, project: anchor });
    else unassigned.push({ url: primary.url, from: p.slug, project: anchor, why: `нет компонента ${primary.name}` });
  }
  // тот же адрес уже чей-то основной или репозиторий компонента — это дубль проекта, не «куда?»
  const placed = new Set([...projectRepos.map(x => x.url), ...componentRepos.map(x => x.url)]);
  const open = unassigned.filter(u => !placed.has(u.url) && unassigned.findIndex(v => v.url === u.url) === unassigned.indexOf(u));
  return { repos: [...repos.values()], projectRepos, componentRepos, mirrors, unassigned: open, warnings };
}

/**
 * Записать в приёмник: KnowRepository (url уникален), HAS_REPOSITORY проект → основной (role primary; влитый без
 * компонента — role unassigned, чтобы не потерять), COMPONENT_REPOSITORY компонент → репозиторий, MIRRORED_TO
 * репозиторий → зеркало, пустые USES_REPOSITORY и KnowOrganization. Сверка: всё = план; у проекта ≤ 1 основного.
 */
/** Связи организации (владелица 19.11.2026: «с проектами, продуктами и людьми»): организация → проект/продукт/человек. */
export const ORG_EDGES = ['ORG_HAS_PROJECT', 'ORG_HAS_PRODUCT', 'ORG_MEMBER'];
/** Все типы, которые пересоздаёт этот шаг: свои для приёмника (повторный перенос с --reset их не считает чужими). */
export const REPO_TYPES = ['HAS_REPOSITORY', 'COMPONENT_REPOSITORY', 'MIRRORED_TO', 'USES_REPOSITORY', 'DEPENDS_ON_REPOSITORY', ...ORG_EDGES, 'KnowRepository', 'KnowOrganization'];

export async function applyRepos(db, srcProjects, anchorOf, { log = console.log, overrides = {} } = {}) {
  const c = (sql, p) => db.dstCommand(sql, p);
  const q = (sql, p) => db.dstQuery(sql, p);
  const comps = (await q('SELECT component_id FROM LoreComponent')).map(x => x.component_id).filter(Boolean);
  const plan = planRepos(srcProjects, anchorOf, comps, overrides);
  const types = new Set((await q('SELECT name FROM schema:types')).map(x => x.name));
  for (const t of REPO_TYPES) if (types.has(t)) await c(`DROP TYPE ${t} UNSAFE`);
  await c('CREATE VERTEX TYPE KnowRepository');
  for (const f of ['url', 'host', 'owner', 'name', 'full_path', 'default_branch']) await c(`CREATE PROPERTY KnowRepository.${f} STRING`);
  await c('CREATE INDEX ON KnowRepository (url) UNIQUE');
  await c('CREATE VERTEX TYPE KnowOrganization');
  await c('CREATE PROPERTY KnowOrganization.org_id STRING');
  await c('CREATE PROPERTY KnowOrganization.name STRING');
  // Владелица 19.11.2026 («1б»): схему организации заводит перенос, а не первое создание на работающей базе.
  await c('CREATE INDEX ON KnowOrganization (org_id) UNIQUE');
  for (const t of ORG_EDGES) await c(`CREATE EDGE TYPE ${t}`);
  for (const t of ['HAS_REPOSITORY', 'COMPONENT_REPOSITORY', 'MIRRORED_TO', 'USES_REPOSITORY']) await c(`CREATE EDGE TYPE ${t}`);
  await c('CREATE PROPERTY HAS_REPOSITORY.role STRING');
  for (const r of plan.repos) await c('INSERT INTO KnowRepository CONTENT :r', { r });
  const repo = '(SELECT FROM KnowRepository WHERE url = :u)';
  let miss = 0;
  const projRid = async s => (await q('SELECT @rid AS r FROM KnowGitProject WHERE slug = :s', { s }))[0]?.r;
  for (const l of plan.projectRepos) { const pr = await projRid(l.project); if (!pr) { miss++; continue; } await c(`CREATE EDGE HAS_REPOSITORY FROM ${pr} TO ${repo} SET role = 'primary'`, { u: l.url }); }
  for (const l of plan.unassigned) { const pr = await projRid(l.project); if (!pr) { miss++; continue; } await c(`CREATE EDGE HAS_REPOSITORY FROM ${pr} TO ${repo} SET role = 'unassigned'`, { u: l.url }); }
  // компонент по слову человека, которого нет в базе, — заводится (только код; описание — потом в LORE)
  for (const l of plan.componentRepos.filter(x => x.create)) await c('INSERT INTO LoreComponent SET component_id = :cid, name = :cid, mig_created_by = :why', { cid: l.component, why: 'решение владелицы: репозиторий ' + l.url });
  for (const l of plan.componentRepos) await c(`CREATE EDGE COMPONENT_REPOSITORY FROM (SELECT FROM LoreComponent WHERE component_id = :cid) TO ${repo}`, { cid: l.component, u: l.url });
  for (const m of plan.mirrors) await c(`CREATE EDGE MIRRORED_TO FROM (SELECT FROM KnowRepository WHERE url = :a) TO (SELECT FROM KnowRepository WHERE url = :b)`, { a: m.from, b: m.to });
  const n = async sql => Number((await q(sql))[0]?.n) || 0;
  const got = { repos: await n('SELECT count(*) AS n FROM KnowRepository'), primary: await n("SELECT count(*) AS n FROM HAS_REPOSITORY WHERE role = 'primary'"), unassigned: await n("SELECT count(*) AS n FROM HAS_REPOSITORY WHERE role = 'unassigned'"), components: await n('SELECT count(*) AS n FROM COMPONENT_REPOSITORY'), mirrors: await n('SELECT count(*) AS n FROM MIRRORED_TO') };
  const multi = (await q("SELECT @out AS p, count(*) AS n FROM HAS_REPOSITORY WHERE role = 'primary' GROUP BY @out")).filter(x => Number(x.n) > 1).length;
  const want = { repos: plan.repos.length, primary: plan.projectRepos.length, unassigned: plan.unassigned.length, components: plan.componentRepos.length, mirrors: plan.mirrors.length };
  const ok = miss === 0 && multi === 0 && Object.keys(want).every(k => want[k] === got[k]);
  log(`репозитории: ${got.repos}/${want.repos}, проект → основной ${got.primary}/${want.primary}, компонент → репозиторий ${got.components}/${want.components}, зеркал ${got.mirrors}/${want.mirrors}, без компонента («куда?») ${got.unassigned}: ${plan.unassigned.map(u => u.from + ' (' + u.why + ')').join(', ') || 'нет'}` + (plan.warnings.length ? `; предупреждения: ${plan.warnings.join('; ')}` : ''));
  log('сверка репозиториев:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, want, got, unassigned: plan.unassigned, warnings: plan.warnings, multi_primary: multi };
}
