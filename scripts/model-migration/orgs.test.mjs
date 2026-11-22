// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · организации при переносе (владелица 21.11.2026: «можешь предложить завести
// организации и связать их с проектами» · «DOCS — архивный, привяжи к AIDA» · «в админке кроме организации должен быть
// и срез репозиториев к ней»). План — из файла решений (раздел organizations), не выводится по владельцу git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planOrgs, judgeOrgs } from './orgs.mjs';

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

// ── База старше правила: проект, которого в приёмнике нет, не роняет установку (MIG-04, 22.11.2026) ──
// На бэкапе прода от 01.11 шаг краснел из-за строки «AIDA → AIDA/core-services»: такого проекта в той базе
// ещё не было. Переносить нечего — это не ошибка; но названо должно быть вслух.
test('мягкий режим: неизвестный проект пропущен с именем, сверка сходится', () => {
  const r = judgeOrgs({ ok: true, unknownProjects: [{ org: 'AIDA', slug: 'AIDA/core-services' }] }, { strict: false });
  assert.equal(r.ok, true, 'счёт сошёлся — установка идёт дальше');
  assert.deepEqual(r.absent.map(u => u.slug), ['AIDA/core-services']);
  assert.match(r.line, /AIDA\/core-services/);
});

test('строгий режим (наша труба): тот же пропуск — красный', () => {
  const r = judgeOrgs({ ok: true, unknownProjects: [{ org: 'AIDA', slug: 'AIDA/core-services' }] }, { strict: true });
  assert.equal(r.ok, false);
});

test('несошедшийся счёт красный в обоих режимах — это запись, а не отсутствие', () => {
  for (const strict of [false, true])
    assert.equal(judgeOrgs({ ok: false, unknownProjects: [] }, { strict }).ok, false);
});
