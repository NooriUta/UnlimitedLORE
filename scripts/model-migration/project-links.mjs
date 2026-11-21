// 1.18 · Нормализация релизов и PR при переносе (владелица 21.11.2026: «точно ли нормализация релизов и PR прошла»).
// Проверка базы препрода (перенос 19ace2a1): у релиза и PR ключ «проект#тег» / «проект#номер» есть у всех, но связи с
// проектом нет у 6 релизов и 1871 PR, адреса — у 1192 PR. Проект в 1.18 — ребро BELONGS_TO_PROJECT, а не поле.
//
// Правило (детерминированно, без сети): префикс ключа записи → проект приёмника (после перегруппировки — опора группы):
//   1) ключ проекта (slug);  2) прежние ключи (aliases);  3) адрес репозитория проекта (hosts: зеркало
//   AIDA/UnlimitedLORE ↔ NooriUta/UnlimitedLORE);  4) без хвоста «@forgejo» — те же шаги;
//   5) имя репозитория без владельца (udwe-rollout → AIDA/udwe-rollout) — только если проект один.
// Не нашёлся — поимённо в отчёт с причиной, не угадывается. Адрес PR — из pr_url_template основного адреса проекта и
// номера, если адреса нет. Заголовки старых PR из хоста git перенос не тянет (это сеть).

const lc = s => String(s || '').toLowerCase();

/** Адреса репозитория проекта: hosts строкой JSON или списком. */
export function hostsOf(p) {
  let h = p && p.hosts;
  if (typeof h === 'string') { try { h = JSON.parse(h); } catch { h = []; } }
  return Array.isArray(h) ? h.filter(x => x && typeof x === 'object') : [];
}

/** «владелец/имя» из адреса репозитория (https://хост/владелец/имя) — без схемы, хоста и «.git». */
const pathOf = url => { const m = /^[a-z]+:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/i.exec(String(url || '')); return m ? m[1] : null; };

function exact(prefix, projects) {
  const k = lc(prefix);
  let p = projects.find(x => lc(x.slug) === k);
  if (p) return { slug: p.slug, how: 'slug' };
  p = projects.find(x => Array.isArray(x.aliases) && x.aliases.some(a => lc(a) === k));
  if (p) return { slug: p.slug, how: 'alias' };
  p = projects.find(x => hostsOf(x).some(h => lc(pathOf(h.base_url)) === k));
  if (p) return { slug: p.slug, how: 'host' };
  return null;
}

/**
 * Явные соответствия ключей из файла решений (раздел project_links.map): прежний ключ проекта → ключ проекта приёмника.
 * Владелица 21.11.2026: «два релиза: Mobilepoc привяжи к miniLORE, последний — к Odin».
 */
export function projectLinkOverrides(doc) {
  const m = doc && doc.project_links && doc.project_links.map;
  return m && typeof m === 'object' ? { ...m } : {};
}

/** Проект по префиксу ключа записи; null — не нашёлся (не угадываем). overrides — явные соответствия владелицы. */
export function resolveProject(prefix, projects, overrides = {}) {
  if (!prefix) return null;
  const to = Object.entries(overrides).find(([k]) => lc(k) === lc(prefix));
  if (to) {
    const hit = exact(to[1], projects);   // цель — тоже по ключу или прежнему ключу: после перегруппировки — опора группы
    return hit ? { slug: hit.slug, how: 'decision' } : null;
  }
  const hit = exact(prefix, projects);
  if (hit) return hit;
  const at = prefix.indexOf('@');
  if (at > 0) { const t = exact(prefix.slice(0, at), projects); if (t) return { slug: t.slug, how: 'tail' }; }
  if (!prefix.includes('/')) {
    const name = lc(prefix);
    const last = s => lc(String(s || '').split('/').pop());
    const hits = projects.filter(x => last(x.slug) === name || (Array.isArray(x.aliases) && x.aliases.some(a => last(a) === name))
      || hostsOf(x).some(h => last(pathOf(h.base_url)) === name));
    if (hits.length === 1) return { slug: hits[0].slug, how: 'repo_name' };
  }
  return null;
}

/** Адрес PR по шаблону основного адреса проекта ({base}/pulls/{n}); шаблона нет — null. */
export function prUrl(project, number) {
  const hs = hostsOf(project);
  const h = hs.find(x => x.role === 'primary') || hs[0];
  if (!h || !h.pr_url_template || !h.base_url || number == null || number === '') return null;
  return String(h.pr_url_template).split('{base}').join(String(h.base_url).replace(/\/+$/, '')).split('{n}').join(String(number));
}

const prefixOf = uid => { const s = String(uid || ''); const i = s.lastIndexOf('#'); return i > 0 ? s.slice(0, i) : s; };
const linked = r => Array.isArray(r.projects) && r.projects.filter(Boolean).length > 0;
const WHY = 'проект не найден ни по ключу, ни по прежним ключам, адресам и имени репозитория';

/** План: связи релизов и PR с проектом, адреса PR, остаток поимённо. */
export function planProjectLinks({ projects, releases, prs, overrides = {} }) {
  const bySlug = new Map(projects.map(p => [p.slug, p]));
  const releaseLinks = [], prLinks = [], prUrls = [], noUrl = [];
  const unresolved = { releases: [], prs: [] };
  for (const r of releases) {
    if (linked(r)) continue;
    const hit = resolveProject(prefixOf(r.release_uid), projects, overrides);
    if (hit) releaseLinks.push({ rid: r.rid, uid: r.release_uid, slug: hit.slug, how: hit.how });
    else unresolved.releases.push({ uid: r.release_uid, prefix: prefixOf(r.release_uid), why: WHY });
  }
  for (const r of prs) {
    let slug = linked(r) ? r.projects.filter(Boolean)[0] : null;
    if (!slug) {
      const hit = resolveProject(prefixOf(r.pr_uid), projects, overrides);
      if (hit) { slug = hit.slug; prLinks.push({ rid: r.rid, uid: r.pr_uid, slug, how: hit.how }); }
      else unresolved.prs.push({ uid: r.pr_uid, prefix: prefixOf(r.pr_uid), why: WHY });
    }
    if (typeof r.url === 'string' && r.url.trim()) continue;
    const url = slug && bySlug.has(slug) ? prUrl(bySlug.get(slug), r.pr_number) : null;
    if (url) prUrls.push({ rid: r.rid, uid: r.pr_uid, url });
    else noUrl.push({ uid: r.pr_uid, why: slug ? 'у проекта нет шаблона адреса PR (hosts.pr_url_template)' : 'проект PR не найден' });
  }
  const counts = {
    releases: releases.length, releases_linked_before: releases.filter(linked).length, releases_linked: releaseLinks.length,
    releases_unresolved: unresolved.releases.length,
    prs: prs.length, prs_linked_before: prs.filter(linked).length, prs_linked: prLinks.length, prs_unresolved: unresolved.prs.length,
    pr_urls_filled: prUrls.length, prs_without_url_after: noUrl.length,
  };
  return { releaseLinks, prLinks, prUrls, unresolved, noUrl, counts };
}

/** Данные приёмника (после перегруппировки): проекты, релизы и PR с их проектами по ребру. */
export async function readProjectLinksInput(db) {
  const projects = await db.dstQuery('SELECT @rid AS rid, slug, aliases, hosts FROM KnowGitProject');
  const releases = await db.dstQuery("SELECT @rid AS rid, release_uid, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowRelease");
  const prs = await db.dstQuery("SELECT @rid AS rid, pr_uid, pr_number, url, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowPR");
  return { projects, releases, prs };
}

/**
 * Записать связи и адреса; сверка «до и после»: релизов и PR без проекта и PR без адреса после шага ровно столько,
 * сколько названо поимённо (с причиной).
 */
export async function applyProjectLinks(db, input, { log = console.log } = {}) {
  const p = planProjectLinks(input);
  const ridOf = new Map(input.projects.map(x => [x.slug, x.rid]));
  for (const l of [...p.releaseLinks, ...p.prLinks])
    await db.dstCommand(`CREATE EDGE BELONGS_TO_PROJECT FROM ${l.rid} TO ${ridOf.get(l.slug)} CONTENT :c`, { c: { mig_rule: 'project-links', how: l.how } });
  for (const u of p.prUrls) await db.dstCommand(`UPDATE ${u.rid} SET url = :u`, { u: u.url });
  const rel = await db.dstQuery("SELECT release_uid, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowRelease");
  const pr = await db.dstQuery("SELECT pr_uid, url, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowPR");
  const after = {
    releases_without_project: rel.filter(r => !linked(r)).length,
    prs_without_project: pr.filter(r => !linked(r)).length,
    prs_without_url: pr.filter(r => !(typeof r.url === 'string' && r.url.trim())).length,
  };
  const ok = after.releases_without_project === p.unresolved.releases.length && after.prs_without_project === p.unresolved.prs.length
    && after.prs_without_url === p.noUrl.length;
  log(`релизы и PR → проект: связано релизов ${p.counts.releases_linked}, PR ${p.counts.prs_linked}, адресов PR ${p.counts.pr_urls_filled}; `
    + `без проекта: релизов ${after.releases_without_project}, PR ${after.prs_without_project}; PR без адреса ${after.prs_without_url}`
    + (p.unresolved.releases.length ? '; релизы без проекта: ' + p.unresolved.releases.map(x => x.uid).join(', ') : ''));
  log('сверка релизов и PR:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, counts: p.counts, after, unresolved: p.unresolved, no_url: p.noUrl.slice(0, 200), no_url_count: p.noUrl.length };
}
