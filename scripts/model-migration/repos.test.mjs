// D-2026-MIG-REPOSITORY-ORGANIZATION · владелица 19.11.2026: «aida nooriuta это характеристики репозитария … дают
// полный путь», «у проекта … один основной сколько угодно зеркал и репозитории от которых он зависит», «посложнее
// элемент (компонент) у него связь с основным репозиторием в проекте. а у того может быть доп связи использует кит
// или зеркалит в github».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, planRepos } from './repos.mjs';

test('адрес репозитория → хост, владелец на хосте, имя, полный путь', () => {
  assert.deepEqual(parseRepo({ role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE/', default_branch: 'develop' }),
    { url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE', host: 'git.seidrstudio.pro', owner: 'AIDA', name: 'UnlimitedLORE', full_path: 'git.seidrstudio.pro/AIDA/UnlimitedLORE', default_branch: 'develop', role: 'primary' });
  assert.equal(parseRepo({ base_url: 'https://github.com/NooriUta/AIDA' }).role, 'mirror');
  assert.equal(parseRepo({ base_url: 'не адрес' }), null);
  assert.equal(parseRepo(null), null);
});

const SRC = [
  { slug: 'AIDA/MIDGARD', name: 'MIDGARD', hosts: [{ role: 'primary', base_url: 'https://f/AIDA/MIDGARD' }] },
  { slug: 'AIDA/GLADSHEIM', name: 'GLADSHEIM', hosts: [{ role: 'primary', base_url: 'https://f/AIDA/GLADSHEIM' }, { role: 'mirror', base_url: 'https://github.com/N/GLADSHEIM' }] },
  { slug: 'AIDA/TEIKN', name: 'TEIKN', hosts: [{ role: 'primary', base_url: 'https://f/AIDA/TEIKN' }] },
  { slug: 'NooriUta/UnlimitedLORE', name: 'UnlimitedLORE', hosts: [{ role: 'primary', base_url: 'https://f/AIDA/UnlimitedLORE' }, { role: 'mirror', base_url: 'https://github.com/NooriUta/UnlimitedLORE' }] },
  { slug: 'AIDA/studio', name: 'studio', hosts: null },
];
const ANCHOR = { 'AIDA/MIDGARD': 'AIDA/MIDGARD', 'AIDA/GLADSHEIM': 'AIDA/MIDGARD', 'AIDA/TEIKN': 'AIDA/MIDGARD', 'NooriUta/UnlimitedLORE': 'NooriUta/UnlimitedLORE', 'AIDA/studio': 'AIDA/studio' };
const COMPONENTS = ['GLADSHEIM', 'MIDGARD', 'OMILORE'];

test('проект → только свой основной; зеркало — связь репозиторий → репозиторий', () => {
  const p = planRepos(SRC, ANCHOR, COMPONENTS);
  assert.deepEqual(p.projectRepos, [
    { project: 'AIDA/MIDGARD', url: 'https://f/AIDA/MIDGARD' },
    { project: 'NooriUta/UnlimitedLORE', url: 'https://f/AIDA/UnlimitedLORE' },
  ]);
  assert.deepEqual(p.mirrors, [
    { from: 'https://f/AIDA/GLADSHEIM', to: 'https://github.com/N/GLADSHEIM' },
    { from: 'https://f/AIDA/UnlimitedLORE', to: 'https://github.com/NooriUta/UnlimitedLORE' },
  ]);
  assert.equal(p.repos.length, 6, 'репозиторий — один объект на адрес, зеркала тоже репозитории');
});

test('влитый проект: его основной — репозиторий компонента с тем же именем; компонента нет — «куда?», не выдумываем', () => {
  const p = planRepos(SRC, ANCHOR, COMPONENTS);
  assert.deepEqual(p.componentRepos, [{ component: 'GLADSHEIM', url: 'https://f/AIDA/GLADSHEIM', project: 'AIDA/MIDGARD' }]);
  assert.deepEqual(p.unassigned, [{ url: 'https://f/AIDA/TEIKN', from: 'AIDA/TEIKN', project: 'AIDA/MIDGARD', why: 'нет компонента TEIKN' }]);
});

test('дубль проекта с тем же основным адресом не попадает в «куда?» — это тот же репозиторий', () => {
  const src = [
    { slug: 'AIDA/udwe-mig-gen', name: 'udwe-mig-gen', hosts: [{ role: 'primary', base_url: 'https://f/AIDA/udwe-mig-gen' }] },
    { slug: 'ciadmin/udwe-mig-gen', name: 'udwe-mig-gen', hosts: [{ role: 'primary', base_url: 'https://f/AIDA/udwe-mig-gen' }] },
  ];
  const p = planRepos(src, { 'ciadmin/udwe-mig-gen': 'AIDA/udwe-mig-gen' }, []);
  assert.deepEqual(p.unassigned, []);
  assert.equal(p.repos.length, 1);
});
