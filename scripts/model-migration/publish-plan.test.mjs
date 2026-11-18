// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · План выкладки установщика в kkRepo (raw-hosted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishPlan, sha256sums, versionOf } from './publish-plan.mjs';

const files = [
  { name: 'lore-migrate.mjs', bytes: Buffer.from('a') },
  { name: 'lore-migrate', bytes: Buffer.from('b') },
];

test('файлы кладутся в каталог версии с версией в имени, плюс SHA256SUMS', () => {
  const p = publishPlan({ base: 'http://192.168.3.131:8081/repository', repo: 'lore-installer', version: '0.1.0-preview.5621d518', files });
  assert.deepEqual(p.map(x => x.url), [
    'http://192.168.3.131:8081/repository/lore-installer/0.1.0-preview.5621d518/lore-migrate-0.1.0-preview.5621d518.mjs',
    'http://192.168.3.131:8081/repository/lore-installer/0.1.0-preview.5621d518/lore-migrate-0.1.0-preview.5621d518-linux-x64',
    'http://192.168.3.131:8081/repository/lore-installer/0.1.0-preview.5621d518/SHA256SUMS',
  ]);
});

test('SHA256SUMS — формат sha256sum -c, имена как в каталоге', () => {
  const s = sha256sums([{ name: 'x.mjs', bytes: Buffer.from('a') }]);
  assert.equal(s, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  x.mjs\n');
});

test('версия: явная — как есть; без неё — предварительная по коммиту', () => {
  assert.equal(versionOf({ input: '0.2.0', sha: 'abcdef0123' }), '0.2.0');
  assert.equal(versionOf({ input: '', sha: 'abcdef0123' }), '0.0.0-preview.abcdef01');
});

test('кривая версия и чужой адрес отбиваются, а не уходят в PUT', () => {
  assert.throws(() => versionOf({ input: '../x', sha: 'abc' }), /версия/);
  assert.throws(() => publishPlan({ base: 'ftp://x', repo: 'lore-installer', version: '1.0.0', files }), /адрес/);
  assert.throws(() => publishPlan({ base: 'http://h/repository', repo: 'a/b', version: '1.0.0', files }), /репозиторий/);
});

test('готовый MSI для Windows кладётся под своим именем рядом с SHA256SUMS', () => {
  const p = publishPlan({ base: 'http://h/repository', repo: 'lore-installer', version: '0.0.0-preview.891f7a5a',
    files: [{ name: 'lore-installer-0.0.0-preview.891f7a5a-win-x64.msi', bytes: Buffer.from('m') }] });
  assert.deepEqual(p.map(x => x.url.split('/').pop()), ['lore-installer-0.0.0-preview.891f7a5a-win-x64.msi', 'SHA256SUMS']);
  assert.throws(() => publishPlan({ base: 'http://h/repository', repo: 'lore-installer', version: '1.0.0',
    files: [{ name: 'lore-installer-0.9.0-win-x64.msi', bytes: Buffer.from('m') }] }), /версия/);
});
