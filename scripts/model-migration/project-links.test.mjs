// 1.18 · нормализация релизов и PR при переносе (владелица 21.11.2026: «точно ли нормализация релизов и PR прошла»).
// Проверка базы препрода (перенос 19ace2a1): релизов без связи с проектом 6, PR без связи — 1871, PR без адреса — 1192.
// Ключ проекта берётся из префикса ключа записи («проект#тег», «проект#номер») и находится детерминированно, без сети:
// по ключу, прежним ключам, адресам репозитория (зеркало), без хвоста «@forgejo», по имени репозитория без владельца.
// Не нашёлся — поимённо в отчёт, не угадывается.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProject, planProjectLinks, prUrl, applyProjectLinks } from './project-links.mjs';

const projects = [
  { rid: '#p:1', slug: 'NooriUta/UnlimitedLORE', aliases: ['NooriUta/UnlimitedLORE', 'AIDA/forgejo-mcp'],
    hosts: [{ remote: 'origin', role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE', pr_url_template: '{base}/pulls/{n}' },
      { remote: 'github', role: 'mirror', base_url: 'https://github.com/NooriUta/UnlimitedLORE', pr_url_template: '{base}/pull/{n}' }] },
  { rid: '#p:2', slug: 'AIDA/udwe-mig-gen', aliases: ['AIDA/udwe-mig-gen', 'AIDA/udwe-rollout', 'AIDA/udwe-engine'], hosts: '[]' },
  { rid: '#p:3', slug: 'AIDA/miniLORE', aliases: ['AIDA/miniLORE', 'AIDA/miniLore_serverside'],
    hosts: JSON.stringify([{ remote: 'forgejo', role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/miniLORE', pr_url_template: '{base}/pulls/{n}' }]) },
  { rid: '#p:4', slug: 'NooriUta/AIDA', aliases: null, hosts: [] },
];

test('проект по префиксу ключа: ключ, прежний ключ, адрес-зеркало, хвост @forgejo, имя репозитория без владельца', () => {
  const r = p => resolveProject(p, projects);
  assert.deepEqual(r('NooriUta/UnlimitedLORE'), { slug: 'NooriUta/UnlimitedLORE', how: 'slug' });
  assert.deepEqual(r('AIDA/miniLore_serverside'), { slug: 'AIDA/miniLORE', how: 'alias' });
  assert.deepEqual(r('AIDA/UnlimitedLORE'), { slug: 'NooriUta/UnlimitedLORE', how: 'host' });
  assert.deepEqual(r('AIDA/miniLORE@forgejo'), { slug: 'AIDA/miniLORE', how: 'tail' });
  assert.deepEqual(r('udwe-rollout'), { slug: 'AIDA/udwe-mig-gen', how: 'repo_name' });
  assert.equal(r('NooriUta/Mobilepoc'), null, 'не нашёлся — не угадываем');
  assert.equal(r('AIDA/research-llm-sql-dialect'), null);
});

// Владелица 21.11.2026: «два релиза: Mobilepoc привяжи к miniLORE, последний — к Odin». Явное соответствие ключей —
// раздел project_links файла решений; цель ищется теми же шагами (ключ, прежний ключ → опора группы).
test('явное соответствие из файла решений: Mobilepoc → miniLORE, research-llm-sql-dialect → ODIN', async () => {
  const { projectLinkOverrides } = await import('./project-links.mjs');
  const decisions = (await import('./rules/decisions.lore.json', { with: { type: 'json' } })).default;
  const map = projectLinkOverrides(decisions);
  assert.deepEqual(map, { 'NooriUta/Mobilepoc': 'AIDA/miniLORE', 'AIDA/research-llm-sql-dialect': 'NooriUta/ODIN' });
  const withOdin = [...projects, { rid: '#p:5', slug: 'NooriUta/ODIN', aliases: ['NooriUta/ODIN'], hosts: [] }];
  assert.deepEqual(resolveProject('NooriUta/Mobilepoc', withOdin, map), { slug: 'AIDA/miniLORE', how: 'decision' });
  assert.deepEqual(resolveProject('AIDA/research-llm-sql-dialect', withOdin, map), { slug: 'NooriUta/ODIN', how: 'decision' });
  const p = planProjectLinks({ projects: withOdin, releases, prs: [], overrides: map });
  assert.deepEqual(p.unresolved.releases, [], 'релизов без проекта — 0');
  assert.ok(p.releaseLinks.some(l => l.uid === 'NooriUta/Mobilepoc#v1.0.3' && l.slug === 'AIDA/miniLORE'));
  assert.equal(resolveProject('Ghost/x', withOdin, { 'Ghost/x': 'Nobody/here' }), null, 'цель соответствия не найдена — не угадываем');
});

test('имя репозитория без владельца неоднозначно — не угадываем', () => {
  const two = [{ slug: 'A/x', aliases: null, hosts: [] }, { slug: 'B/x', aliases: null, hosts: [] }];
  assert.equal(resolveProject('x', two), null);
});

test('адрес PR — шаблон основного адреса проекта и номер; адрес уже есть — не трогается; шаблона нет — пусто', () => {
  assert.equal(prUrl(projects[0], 1641), 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1641');
  assert.equal(prUrl(projects[2], 7), 'https://git.seidrstudio.pro/AIDA/miniLORE/pulls/7');
  assert.equal(prUrl(projects[3], 5), null);
});

const releases = [
  { rid: '#r:1', release_uid: 'udwe-rollout#rollout-2026-08-16', projects: [] },
  { rid: '#r:2', release_uid: 'AIDA/miniLORE@forgejo#minilore-app-1.11.80', projects: [] },
  { rid: '#r:3', release_uid: 'NooriUta/Mobilepoc#v1.0.3', projects: [] },
  { rid: '#r:4', release_uid: 'NooriUta/UnlimitedLORE#v1.17.25', projects: ['NooriUta/UnlimitedLORE'] },
];
const prs = [
  { rid: '#q:1', pr_uid: 'NooriUta/UnlimitedLORE#1641', pr_number: 1641, url: null, projects: [] },
  { rid: '#q:2', pr_uid: 'AIDA/UnlimitedLORE#12', pr_number: 12, url: 'https://x/12', projects: [] },
  { rid: '#q:3', pr_uid: 'AIDA/miniLORE@forgejo#3', pr_number: 3, url: '', projects: [] },
  { rid: '#q:4', pr_uid: 'NooriUta/AIDA#204', pr_number: 204, url: null, projects: [] },
  { rid: '#q:5', pr_uid: 'Ghost/repo#1', pr_number: 1, url: null, projects: [] },
];

test('план: связи релизов и PR с проектом, адреса PR; не найденные — поимённо; уже связанные не дублируются', () => {
  const p = planProjectLinks({ projects, releases, prs });
  assert.deepEqual(p.releaseLinks.map(l => `${l.rid}>${l.slug}`), ['#r:1>AIDA/udwe-mig-gen', '#r:2>AIDA/miniLORE']);
  assert.deepEqual(p.prLinks.map(l => `${l.rid}>${l.slug}`), ['#q:1>NooriUta/UnlimitedLORE', '#q:2>NooriUta/UnlimitedLORE', '#q:3>AIDA/miniLORE', '#q:4>NooriUta/AIDA']);
  assert.deepEqual(p.prUrls.map(u => `${u.rid}=${u.url}`), [
    '#q:1=https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1641', '#q:3=https://git.seidrstudio.pro/AIDA/miniLORE/pulls/3']);
  assert.deepEqual(p.unresolved.releases, [{ uid: 'NooriUta/Mobilepoc#v1.0.3', prefix: 'NooriUta/Mobilepoc', why: 'проект не найден ни по ключу, ни по прежним ключам, адресам и имени репозитория' }]);
  assert.deepEqual(p.unresolved.prs.map(x => x.uid), ['Ghost/repo#1']);
  assert.deepEqual(p.noUrl.map(x => x.uid), ['NooriUta/AIDA#204', 'Ghost/repo#1'], 'адреса нет и шаблона нет — поимённо');
  assert.deepEqual(p.counts, { releases: 4, releases_linked_before: 1, releases_linked: 2, releases_unresolved: 1,
    prs: 5, prs_linked_before: 0, prs_linked: 4, prs_unresolved: 1, pr_urls_filled: 2, prs_without_url_after: 2 });
});

test('применение и сверка «до и после»: после шага без проекта — только поимённо названные', async () => {
  const edges = [];
  const urls = new Map();
  const db = {
    dstCommand: async (sql, p = {}) => {
      const m = /^CREATE EDGE BELONGS_TO_PROJECT FROM (#\S+) TO (#\S+)/.exec(sql);
      if (m) edges.push([m[1], m[2]]);
      if (sql.startsWith('UPDATE')) urls.set(sql.split(' ')[1], p.u);
      return [];
    },
    dstQuery: async sql => {
      if (sql.includes('FROM KnowRelease')) return releases.map(r => ({ ...r, projects: [...r.projects, ...edges.filter(e => e[0] === r.rid).map(() => 'x')] }));
      if (sql.includes('FROM KnowPR')) return prs.map(r => ({ ...r, url: urls.get(r.rid) ?? r.url, projects: edges.filter(e => e[0] === r.rid).map(() => 'x') }));
      return [];
    },
  };
  const r = await applyProjectLinks(db, { projects, releases, prs }, { log: () => {} });
  assert.deepEqual(edges.map(e => e.join('>')), ['#r:1>#p:2', '#r:2>#p:3', '#q:1>#p:1', '#q:2>#p:1', '#q:3>#p:3', '#q:4>#p:4']);
  assert.deepEqual(r.after, { releases_without_project: 1, prs_without_project: 1, prs_without_url: 2 });
  assert.equal(r.ok, true, 'остаток назван поимённо с причиной — сверка сходится');
  assert.equal(r.unresolved.releases[0].uid, 'NooriUta/Mobilepoc#v1.0.3');
});
