// D-2026-MIG-REPOSITORY-ORGANIZATION · владелица 19.11.2026: «aida nooriuta это характеристики репозитария и там
// должны быть они вместе с указанием github и репозитария дают полный путь», «репозиторий отдельный объект у проекта
// может быть несколько репо но один основной сколько угодно зеркал и репозитории от который он зависит».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, planRepos } from './repos.mjs';

test('адрес репозитория → хост, владелец на хосте, имя, полный путь', () => {
  assert.deepEqual(parseRepo({ role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE/', default_branch: 'develop' }),
    { url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE', host: 'git.seidrstudio.pro', owner: 'AIDA', name: 'UnlimitedLORE', full_path: 'git.seidrstudio.pro/AIDA/UnlimitedLORE', default_branch: 'develop', role: 'primary' });
  assert.equal(parseRepo({ base_url: 'https://github.com/NooriUta/AIDA' }).role, 'mirror', 'без роли — зеркало, основной объявляется явно');
  assert.equal(parseRepo({ base_url: 'не адрес' }), null);
  assert.equal(parseRepo(null), null);
});

test('проект → один основной и зеркала; репозиторий — один объект на адрес; без адресов — 0 репозиториев', () => {
  const p = planRepos([
    { slug: 'NooriUta/UnlimitedLORE', hosts: [{ role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE' }, { role: 'mirror', base_url: 'https://github.com/NooriUta/UnlimitedLORE' }] },
    { slug: 'AIDA/udwe-mig-gen', hosts: [{ role: 'primary', base_url: 'https://git.seidrstudio.pro/AIDA/udwe-mig-gen' }, { role: 'mirror', base_url: 'https://github.com/ivanovalex32/UDWE' }] },
    { slug: 'ivanovalex32/UDWE', hosts: [{ role: 'primary', base_url: 'https://github.com/ivanovalex32/UDWE' }] },
    { slug: 'AIDA/studio', hosts: null },
  ]);
  assert.equal(p.repos.length, 4, 'GitHub ivanovalex32/UDWE — один объект, хотя у двух проектов');
  assert.deepEqual(p.links.filter(l => l.project === 'NooriUta/UnlimitedLORE').map(l => l.role).sort(), ['mirror', 'primary']);
  assert.equal(p.links.filter(l => l.project === 'AIDA/studio').length, 0);
  // один адрес у двух проектов: основной у одного, зеркало у другого — честно показывается, не прячется
  assert.deepEqual(p.shared.map(s => s.url), ['https://github.com/ivanovalex32/UDWE']);
});

test('у проекта ровно один основной: два основных — первый основной, второй зеркало и предупреждение; нет основного — первый становится основным', () => {
  const p = planRepos([
    { slug: 'X/two', hosts: [{ role: 'primary', base_url: 'https://h/a/one' }, { role: 'primary', base_url: 'https://h/a/two' }] },
    { slug: 'X/none', hosts: [{ role: 'mirror', base_url: 'https://h/b/one' }] },
  ]);
  const roles = s => p.links.filter(l => l.project === s).map(l => l.role);
  assert.deepEqual(roles('X/two'), ['primary', 'mirror']);
  assert.deepEqual(roles('X/none'), ['primary']);
  assert.equal(p.warnings.length, 2);
});
