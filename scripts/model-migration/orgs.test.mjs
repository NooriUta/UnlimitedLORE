// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · организации при переносе (владелица 21.11.2026: «можешь предложить завести
// организации и связать их с проектами» · «DOCS — архивный, привяжи к AIDA» · «в админке кроме организации должен быть
// и срез репозиториев к ней»). План — из файла решений (раздел organizations), не выводится по владельцу git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planOrgs } from './orgs.mjs';

const projects = ['NooriUta/AIDA', 'AIDA/miniLORE', 'NooriUta/ODIN', 'NooriUta/aida-documentation'];
const repos = [
  { url: 'https://git.seidrstudio.pro/AIDA/aida-root', owner: 'AIDA' },
  { url: 'https://git.seidrstudio.pro/AIDA/miniLORE', owner: 'AIDA' },
  { url: 'https://github.com/NooriUta/AIDA', owner: 'NooriUta' },
];
const doc = { organizations: { list: [{ org_id: 'AIDA', name: 'AIDA', projects: ['NooriUta/AIDA', 'AIDA/miniLORE', 'NooriUta/aida-documentation', 'Ghost/x'], repo_owner: 'AIDA' }] } };

test('организация — только из решения человека; нет раздела — ничего не заводится', () => {
  const p = planOrgs(null, projects, repos);
  assert.deepEqual(p, { orgs: [], projectLinks: [], repoLinks: [], unknownProjects: [] });
});

test('проекты — по списку решения; неизвестный проект называется, а не теряется молча', () => {
  const p = planOrgs(doc, projects, repos);
  assert.deepEqual(p.orgs, [{ org_id: 'AIDA', name: 'AIDA' }]);
  assert.deepEqual(p.projectLinks.map(l => l.slug), ['NooriUta/AIDA', 'AIDA/miniLORE', 'NooriUta/aida-documentation']);
  assert.deepEqual(p.unknownProjects, [{ org: 'AIDA', slug: 'Ghost/x' }]);
});

test('репозитории — владельца, названного в решении; чужие (NooriUta) не приписываются', () => {
  const p = planOrgs(doc, projects, repos);
  assert.deepEqual(p.repoLinks.map(l => l.url), ['https://git.seidrstudio.pro/AIDA/aida-root', 'https://git.seidrstudio.pro/AIDA/miniLORE']);
});

test('проект без решения (ODIN) остаётся без организации', () => {
  const p = planOrgs(doc, projects, repos);
  assert.ok(!p.projectLinks.some(l => l.slug === 'NooriUta/ODIN'));
});
