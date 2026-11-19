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
 * План: репозитории (один объект на адрес) и связи проект → репозиторий с ролью. У проекта ровно один основной:
 * два основных — первый основной, остальные зеркала (предупреждение); ни одного — первый адрес становится основным
 * (предупреждение). Адрес у нескольких проектов — в shared: показывается, не прячется.
 */
export function planRepos(projects) {
  const repos = new Map(), links = [], warnings = [], usedBy = new Map();
  for (const p of projects) {
    const hosts = Array.isArray(p.hosts) ? p.hosts : [];
    const parsed = hosts.map(parseRepo).filter(Boolean);
    if (!parsed.length) continue;
    let primaries = parsed.filter(r => r.role === 'primary');
    if (primaries.length > 1) warnings.push(`${p.slug}: основных ${primaries.length} — основным оставлен ${primaries[0].url}`);
    if (!primaries.length) { warnings.push(`${p.slug}: основного нет — основным назначен ${parsed[0].url}`); primaries = [parsed[0]]; }
    const primary = primaries[0].url;
    const seen = new Set();
    for (const r of parsed) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      if (!repos.has(r.url)) { const { role, ...rest } = r; repos.set(r.url, rest); }
      links.push({ project: p.slug, url: r.url, role: r.url === primary ? 'primary' : 'mirror' });
      (usedBy.get(r.url) || usedBy.set(r.url, []).get(r.url)).push(p.slug);
    }
  }
  const shared = [...usedBy.entries()].filter(([, ps]) => ps.length > 1).map(([url, ps]) => ({ url, projects: ps }));
  return { repos: [...repos.values()], links, shared, warnings };
}

/**
 * Записать в приёмник: тип KnowRepository (url уникален), ребро HAS_REPOSITORY проект → репозиторий с role,
 * ребро DEPENDS_ON_REPOSITORY (заводится пустым: зависимостей в источнике нет), тип KnowOrganization (пустой —
 * какие организации завести, решает владелица). Сверка: репозиториев и связей в приёмнике = в плане.
 */
export async function applyRepos(db, projects, { log = console.log } = {}) {
  const plan = planRepos(projects);
  const c = (sql, p) => db.dstCommand(sql, p);
  const q = (sql, p) => db.dstQuery(sql, p);
  const types = new Set((await q('SELECT name FROM schema:types')).map(x => x.name));
  for (const t of ['HAS_REPOSITORY', 'DEPENDS_ON_REPOSITORY']) if (types.has(t)) await c(`DROP TYPE ${t} UNSAFE`);
  for (const t of ['KnowRepository', 'KnowOrganization']) if (types.has(t)) await c(`DROP TYPE ${t} UNSAFE`);
  await c('CREATE VERTEX TYPE KnowRepository');
  for (const [f, t] of [['url', 'STRING'], ['host', 'STRING'], ['owner', 'STRING'], ['name', 'STRING'], ['full_path', 'STRING'], ['default_branch', 'STRING']])
    await c(`CREATE PROPERTY KnowRepository.${f} ${t}`);
  await c('CREATE INDEX ON KnowRepository (url) UNIQUE');
  await c('CREATE VERTEX TYPE KnowOrganization');
  await c('CREATE PROPERTY KnowOrganization.org_id STRING');
  await c('CREATE PROPERTY KnowOrganization.name STRING');
  await c('CREATE EDGE TYPE HAS_REPOSITORY');
  await c('CREATE PROPERTY HAS_REPOSITORY.role STRING');
  await c('CREATE EDGE TYPE DEPENDS_ON_REPOSITORY');
  for (const r of plan.repos) await c('INSERT INTO KnowRepository CONTENT :r', { r });
  let missing = 0;
  for (const l of plan.links) {
    const pr = (await q('SELECT @rid AS r FROM KnowGitProject WHERE slug = :s', { s: l.project }))[0]?.r;
    if (!pr) { missing++; continue; } // проект влит перегруппировкой — его адреса уже у опоры
    await c(`CREATE EDGE HAS_REPOSITORY FROM ${pr} TO (SELECT FROM KnowRepository WHERE url = :u) SET role = :role`, { u: l.url, role: l.role });
  }
  const gotRepos = Number((await q('SELECT count(*) AS n FROM KnowRepository'))[0]?.n) || 0;
  const gotLinks = Number((await q('SELECT count(*) AS n FROM HAS_REPOSITORY'))[0]?.n) || 0;
  const primaries = await q("SELECT @out AS p, count(*) AS n FROM HAS_REPOSITORY WHERE role = 'primary' GROUP BY @out");
  const notOne = primaries.filter(x => Number(x.n) !== 1).length;
  const report = { repos: { plan: plan.repos.length, target: gotRepos }, links: { plan: plan.links.length - missing, target: gotLinks, skipped_merged_projects: missing }, projects_with_not_one_primary: notOne, shared: plan.shared, warnings: plan.warnings };
  report.ok = gotRepos === plan.repos.length && gotLinks === plan.links.length - missing && notOne === 0;
  log(`репозитории: ${gotRepos} (план ${plan.repos.length}), связей проект → репозиторий ${gotLinks}, проектов не с одним основным: ${notOne}` +
    (plan.shared.length ? `, адрес у нескольких проектов: ${plan.shared.map(s => s.url + ' ← ' + s.projects.join(', ')).join('; ')}` : '') +
    (plan.warnings.length ? `, предупреждения: ${plan.warnings.join('; ')}` : ''));
  log('сверка репозиториев:', report.ok ? 'сошлась' : 'НЕ сошлась');
  return report;
}
