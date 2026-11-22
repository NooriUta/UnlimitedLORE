import { splitGaps, gapLine, strictMode } from './source-gap.mjs';

// 1.18 · Код, краткое и полное название, описание проекта — ru/en/pl (владелица 21.11.2026: «не вижу на препроде полей,
// перепроверяй, я просила код, краткое название, полное название, описание»). Значения — раздел project_names файла
// решений (таблица владелицы; en/pl — перевод агента на проверку). Внутренний ключ slug не меняется: по нему проект знают
// MCP (git_project), роли и мост Forgejo.
//
// Проект приёмника ищется по ключу и по прежним ключам (aliases) — перегруппировка 1.18 сливает проекты в группы.
// Строка, чьи ключи ведут в проект чужой группы (core-services слит в SEIDR_BACKOFFICE), не пишется: названия легли бы
// на другую группу; это расхождение, его решает владелица. Шаг идёт после перегруппировки.

/** Строки таблицы из файла решений (раздел project_names.list); нет раздела — пусто. */
export function projectNamesOf(doc) {
  const l = doc && doc.project_names && Array.isArray(doc.project_names.list) ? doc.project_names.list : [];
  return l.map(x => ({ code: x.code, slugs: x.slugs || [], group: x.group ?? null, short_title: x.short_title || {},
    title: x.title || {}, description: x.description ?? null }));
}

const pick = (m, lang) => (m && typeof m[lang] === 'string' && m[lang].trim() ? m[lang] : null);

/** Поля проекта по строке: короткий код, краткое и полное название и описание на трёх языках (полное ru — name). */
function fieldsOf(x) {
  return {
    short_code: x.code,
    short_title: pick(x.short_title, 'ru'), short_title_en: pick(x.short_title, 'en'), short_title_pl: pick(x.short_title, 'pl'),
    name: pick(x.title, 'ru'), title_en: pick(x.title, 'en'), title_pl: pick(x.title, 'pl'),
    description: pick(x.description, 'ru'), description_en: pick(x.description, 'en'), description_pl: pick(x.description, 'pl'),
  };
}

/**
 * План: строка таблицы → проект приёмника ({slug, aliases, regroup}). problems: not_found (ни ключа, ни прежнего ключа),
 * ambiguous (ключи строки ведут в несколько проектов), merged_into_other_group (проект слит в другую группу),
 * same_project_as_<код> (две строки ведут в один проект).
 */
export function planProjectNames(rows, projects) {
  const updates = [], problems = [], taken = new Map();
  for (const x of rows) {
    const keys = new Set(x.slugs);
    const hits = projects.filter(p => keys.has(p.slug) || (Array.isArray(p.aliases) && p.aliases.some(a => keys.has(a))));
    if (!hits.length) { problems.push({ code: x.code, kind: 'not_found', slugs: x.slugs }); continue; }
    if (hits.length > 1) { problems.push({ code: x.code, kind: 'ambiguous', projects: hits.map(p => p.slug) }); continue; }
    const p = hits[0];
    if ((p.regroup ?? null) !== x.group && p.regroup) {
      problems.push({ code: x.code, kind: 'merged_into_other_group', project: p.slug, group: p.regroup, expected: x.group });
      continue;
    }
    if (taken.has(p.slug)) { problems.push({ code: x.code, kind: 'same_project_as_' + taken.get(p.slug), project: p.slug }); continue; }
    taken.set(p.slug, x.code);
    updates.push({ code: x.code, slug: p.slug, set: fieldsOf(x) });
  }
  return { updates, problems };
}

/** Проекты приёмника (после перегруппировки). */
export async function readProjectNamesInput(db) {
  return db.dstQuery('SELECT slug, aliases, regroup FROM KnowGitProject');
}

const REQUIRED = ['short_code', 'short_title', 'short_title_en', 'short_title_pl', 'name', 'title_en', 'title_pl'];

/**
 * Записать поля и сверить «после»: у каждого найденного проекта код, краткое и полное название на трёх языках заполнены
 * (описание — если оно есть в таблице). Расхождения плана — сверка не сходится.
 */
export async function applyProjectNames(db, rows, projects, { log = console.log } = {}) {
  const p = planProjectNames(rows, projects);
  for (const f of [...REQUIRED, 'description', 'description_en', 'description_pl'])
    if (f !== 'name' && f !== 'description') await db.dstCommand(`CREATE PROPERTY KnowGitProject.${f} IF NOT EXISTS STRING`);
  for (const u of p.updates) {
    const set = Object.keys(u.set).map(k => `${k} = :${k}`).join(', ');
    await db.dstCommand(`UPDATE KnowGitProject SET ${set} WHERE slug = :slug`, { slug: u.slug, ...u.set });
  }
  const got = new Map((await db.dstQuery('SELECT slug, short_code, short_title, short_title_en, short_title_pl, name, title_en, title_pl, '
    + 'description, description_en, description_pl FROM KnowGitProject')).map(r => [r.slug, r]));
  const unfilled = [];
  for (const u of p.updates) {
    const r = got.get(u.slug) || {};
    const want = [...REQUIRED, ...(u.set.description ? ['description', 'description_en', 'description_pl'] : [])];
    const empty = want.filter(f => typeof r[f] !== 'string' || !r[f].trim() || r[f] !== u.set[f]);
    if (empty.length) unfilled.push({ code: u.code, slug: u.slug, fields: empty });
  }
  const v = judgeProjectNames({ problems: p.problems, unfilled });
  log(`названия проектов: записано ${p.updates.length} из ${rows.length}` + (v.mismatch.length ? '; расхождения: '
    + v.mismatch.map(x => `${x.code} ${x.kind}${x.group ? ' (' + x.group + ')' : ''}`).join(', ') : '') + v.line
    + (unfilled.length ? '; не заполнено: ' + unfilled.map(x => x.code + ' ' + x.fields.join('/')).join(', ') : ''));
  log('сверка названий проектов:', v.ok ? 'сошлась' : 'НЕ сошлась');
  return { ok: v.ok, applied: p.updates.length, rows: rows.length, mapped: p.updates.map(u => ({ code: u.code, slug: u.slug })),
    problems: p.problems, unfilled, absent_in_source: v.absent };
}

/**
 * Вердикт шага. «Проекта с такими ключами нет» (not_found) и «ключи ведут в несколько проектов» (ambiguous) —
 * это источник старше таблицы: на базе до перегруппировки 1.18 слитые проекты ещё лежат порознь. Переносить
 * нечего, установку не роняем, но называем поимённо. Противоречие самой таблицы (две строки на один проект,
 * проект слит в чужую группу) и «записали, а не сошлось» (unfilled) — красные всегда.
 */
export function judgeProjectNames({ problems = [], unfilled = [] }, { strict = strictMode() } = {}) {
  const g = splitGaps(problems, ['not_found', 'ambiguous'], { strict });
  const blocking = [...g.blocking, ...unfilled];
  return {
    ok: blocking.length === 0,
    absent: g.absent,
    mismatch: g.mismatch,
    line: gapLine(g.absent, x => `${x.code} (${x.kind === 'ambiguous' ? 'ещё не слиты в группу' : 'нет такого проекта'})`),
  };
}
