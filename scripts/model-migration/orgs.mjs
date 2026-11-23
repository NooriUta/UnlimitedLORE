// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · организации при переносе (D-2026-MIG-REPOSITORY-ORGANIZATION).
// Владелица 21.11.2026: «можешь предложить завести организации и связать их с проектами, но если будет отказ
// (NooriUta не организация) — оставляем слеш в репозиториях» · «DOCS — архивный, привяжи к AIDA» · «в админке кроме
// организации должен быть и срез репозиториев к ней». Организация — НЕ git-пространство: заводится только по решению
// человека (раздел organizations файла решений) — какие проекты и чьи репозитории к ней относятся.
// Чистая функция (planOrgs) + запись в приёмник (applyOrgs).

import { splitGaps, gapLine, strictMode } from './source-gap.mjs';

/** Ребро организация → репозиторий (вкладка «Репозитории» у организации). */
export const ORG_REPO_EDGE = 'ORG_HAS_REPOSITORY';

/**
 * doc — файл решений; projects — slug проектов приёмника (после перегруппировки); repos — [{url, owner}].
 * Решение: organizations.list = [{ org_id, name, projects: [slug…], repo_owner? }].
 */
export function planOrgs(doc, projects, repos) {
  const list = doc && doc.organizations && Array.isArray(doc.organizations.list) ? doc.organizations.list : [];
  const known = new Set(projects);
  const orgs = [], projectLinks = [], repoLinks = [], unknownProjects = [];
  for (const o of list) {
    if (!o || !o.org_id) continue;
    orgs.push({ org_id: o.org_id, name: o.name || o.org_id });
    for (const slug of o.projects || []) {
      if (known.has(slug)) projectLinks.push({ org: o.org_id, slug });
      else unknownProjects.push({ org: o.org_id, slug });
    }
    if (o.repo_owner) for (const r of repos) if (r.owner === o.repo_owner) repoLinks.push({ org: o.org_id, url: r.url });
  }
  return { orgs, projectLinks, repoLinks, unknownProjects };
}

/** Записать в приёмник; типы KnowOrganization, ORG_HAS_PROJECT и ORG_HAS_REPOSITORY заводит шаг репозиториев. Сверка — всё = план. */
export async function applyOrgs(db, doc, { log = console.log } = {}) {
  const q = (sql, p) => db.dstQuery(sql, p);
  const c = (sql, p) => db.dstCommand(sql, p);
  const projects = (await q('SELECT slug FROM KnowGitProject')).map(x => x.slug).filter(Boolean);
  const repos = await q('SELECT url, owner FROM KnowRepository');
  const plan = planOrgs(doc, projects, repos);
  for (const o of plan.orgs) await c('INSERT INTO KnowOrganization SET org_id = :id, name = :name', { id: o.org_id, name: o.name });
  const org = '(SELECT FROM KnowOrganization WHERE org_id = :o)';
  for (const l of plan.projectLinks) await c(`CREATE EDGE ORG_HAS_PROJECT FROM ${org} TO (SELECT FROM KnowGitProject WHERE slug = :s)`, { o: l.org, s: l.slug });
  for (const l of plan.repoLinks) await c(`CREATE EDGE ${ORG_REPO_EDGE} FROM ${org} TO (SELECT FROM KnowRepository WHERE url = :u)`, { o: l.org, u: l.url });
  const n = async sql => Number((await q(sql))[0]?.n) || 0;
  const got = { orgs: await n('SELECT count(*) AS n FROM KnowOrganization'), projects: await n('SELECT count(*) AS n FROM ORG_HAS_PROJECT'), repos: await n(`SELECT count(*) AS n FROM ${ORG_REPO_EDGE}`) };
  const want = { orgs: plan.orgs.length, projects: plan.projectLinks.length, repos: plan.repoLinks.length };
  const counted = Object.keys(want).every(k => want[k] === got[k]);
  const verdict = judgeOrgs({ ok: counted, unknownProjects: plan.unknownProjects });
  log(`организации: ${got.orgs}/${want.orgs}, организация → проект ${got.projects}/${want.projects}, организация → репозиторий ${got.repos}/${want.repos}`
    + verdict.line);
  log('сверка организаций:', verdict.ok ? 'сошлась' : 'НЕ сошлась');
  return { ok: verdict.ok, want, got, unknown: plan.unknownProjects, absent_in_target: verdict.absent };
}

/**
 * Вердикт шага. Счёт обязан сойтись всегда — это запись. «Проекта нет в приёмнике» — другое: источник старше
 * правила (бэкап прода до 1.18 не знает проектов, заведённых позже). Такой пропуск называется поимённо и
 * установку не роняет; в строгом режиме нашей трубы он красный, потому что там это дефект правила.
 */
export function judgeOrgs({ ok, unknownProjects = [] }, { strict = strictMode() } = {}) {
  const gaps = splitGaps(unknownProjects.map(u => ({ ...u, kind: 'project_absent_in_target' })),
    ['project_absent_in_target'], { strict });
  return {
    ok: ok && gaps.blocking.length === 0,
    absent: gaps.absent,
    line: gapLine(gaps.absent, u => `${u.org}→${u.slug}`),
  };
}
