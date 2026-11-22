// Образ сервера miniLORE в пакете: локальное имя, архив с подписью, адрес реестра — только в трубе.
// Повод — сторож noBakedHosts поймал в пакете git.seidrstudio.pro (22.11.2026): пакет едет чужим людям,
// нашего реестра у них нет. Схема повторяет forgejo-mcp: имя без реестра + images/*.tar + .sha256.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MINILORE_IMAGE, MINILORE_ARCHIVE, MINILORE_VERSION, imagePlan } from './minilore-image.mjs';

const read = f => fs.readFileSync(new URL('../../deploy/install/' + f, import.meta.url), 'utf8');

test('имя образа в пакете — без реестра', () => {
  assert.equal(MINILORE_IMAGE, 'minilore-srv:' + MINILORE_VERSION);
  assert.ok(!MINILORE_IMAGE.includes('/'), 'в имени не должно быть ни реестра, ни пространства имён');
});

test('install.sh, .env.example и compose знают ровно это имя и путь архива', () => {
  for (const f of ['install.sh', '.env.example', 'docker-compose.install.yml']) {
    const t = read(f);
    assert.ok(t.includes(MINILORE_IMAGE), `${f}: нет имени образа ${MINILORE_IMAGE}`);
    assert.ok(!/git\.seidrstudio\.pro/.test(t), `${f}: в пакете наш реестр — чужим людям он недоступен`);
  }
  assert.ok(read('install.sh').includes(MINILORE_ARCHIVE), 'install.sh не знает путь архива образа в пакете');
});

test('план сборки: притянуть из реестра трубы, переименовать в локальное имя, сохранить и подписать', () => {
  const p = imagePlan({ out: '/tmp/out', source: 'registry.example/minilore:0.4.19' });
  assert.deepEqual(p.map(s => s.id), ['pull', 'tag', 'save', 'sha256']);
  assert.deepEqual(p[1].args, ['tag', 'registry.example/minilore:0.4.19', MINILORE_IMAGE], 'переименование в имя пакета');
  assert.ok(p[2].args.join(' ').endsWith(MINILORE_ARCHIVE + ' ' + MINILORE_IMAGE), 'сохраняется именно образ пакета');
});

test('без адреса реестра шагов pull и tag нет: берём образ, который уже на машине сборки', () => {
  assert.deepEqual(imagePlan({ out: '/tmp/out', source: '' }).map(s => s.id), ['save', 'sha256']);
});
