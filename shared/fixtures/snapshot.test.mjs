// SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES — серверная часть: скрипт снятия живых
// ответов сервера в shared/fixtures. Чистые части скрипта (snapshot-core.mjs);
// сеть не нужна. Запуск: node --test shared/fixtures/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_BASE, parseArgs, baseError, headersFor, fillPath, pickValue,
  planTargets, fixtureFile, serialize, secretLeak, buildIndex,
} from './snapshot-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('по умолчанию — локальный бэкенд, не прод', () => {
  const o = parseArgs([], {});
  assert.equal(o.base, DEFAULT_BASE);
  assert.match(new URL(o.base).hostname, /^(127\.0\.0\.1|localhost)$/);
  assert.equal(o.token, null, 'без токена в окружении токена нет');
  assert.equal(baseError(o), null);
});

test('адрес — из параметра или окружения; токен — только из окружения', () => {
  const env = { LORE_FIXTURES_BASE: 'http://localhost:8081', LORE_FIXTURES_TOKEN: 'T-env' };
  assert.equal(parseArgs([], env).base, 'http://localhost:8081');
  assert.equal(parseArgs(['--base', 'http://127.0.0.1:9100/'], env).base, 'http://127.0.0.1:9100',
    'параметр сильнее окружения, хвостовой слэш снят');
  assert.equal(parseArgs([], env).token, 'T-env');
  assert.throws(() => parseArgs(['--token', 'X'], {}), /LORE_FIXTURES_TOKEN/,
    'токен в командной строке виден в списке процессов и истории шелла — отказ');
});

test('не локальный адрес — только явным --allow-remote', () => {
  const remote = parseArgs(['--base', 'http://192.168.3.131:2480'], {});
  assert.match(baseError(remote) ?? '', /--allow-remote/);
  assert.equal(baseError(parseArgs(['--base', 'http://192.168.3.131:4410', '--allow-remote'], {})), null);
  assert.match(baseError(parseArgs(['--base', 'ftp://localhost'], {})) ?? '', /http/);
});

test('заголовки: токен — Bearer, без токена — dev-роль', () => {
  assert.deepEqual(headersFor({ token: 'T', role: 'admin' }), { Accept: 'application/json', Authorization: 'Bearer T' });
  assert.deepEqual(headersFor({ token: null, role: 'admin' }), { Accept: 'application/json', 'X-Seer-Role': 'admin' });
});

test('подстановка: путь записи кодируется по сегментам, слэш жив, решётка кодируется; запрос — целиком', () => {
  assert.equal(fillPath('/lore/record/task/{task_uid}', { task_uid: 'SPRINT_X/CO-11' }), '/lore/record/task/SPRINT_X/CO-11');
  assert.equal(fillPath('/lore/record/release/{r}', { r: 'NooriUta/UnlimitedLORE#v1.17.4' }),
    '/lore/record/release/NooriUta/UnlimitedLORE%23v1.17.4');
  assert.equal(fillPath('/lore/slice/tasks_of_sprint?sprint_id={s}&limit=5', { s: 'SPRINT A/B' }),
    '/lore/slice/tasks_of_sprint?sprint_id=SPRINT%20A%2FB&limit=5');
  assert.throws(() => fillPath('/lore/record/adr/{adr_id}', {}), /adr_id/);
});

test('значение для подстановки — из первой строки уже снятого среза', () => {
  assert.equal(pickValue({ rows: [{ adr_id: 'ADR-1' }, { adr_id: 'ADR-2' }] }, 'adr_id'), 'ADR-1');
  assert.equal(pickValue({ rows: [] }, 'adr_id'), null, 'пустой срез — нечего подставить, а не undefined в пути');
  assert.equal(pickValue({ error: 'X' }, 'adr_id'), null);
});

test('манифест: имена уникальны и безопасны, подстановки ссылаются на снятое раньше', () => {
  const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
  const plan = planTargets(manifest, { only: null });
  const names = plan.map(t => t.name);
  assert.ok(names.includes('model'), '/lore/model в наборе');
  assert.ok(plan.some(t => t.path.startsWith('/lore/record/')), 'паспорт записи в наборе');
  assert.ok(plan.some(t => t.path.startsWith('/lore/slice/')), 'срезы в наборе');
  assert.equal(new Set(names).size, names.length);
  assert.throws(() => planTargets({ targets: [{ name: 'a', path: '/lore/record/adr/{x}' }],
    picks: { x: { from: 'b', field: 'adr_id' } } }, { only: null }), /b/);
  assert.throws(() => planTargets({ targets: [{ name: '../evil', path: '/lore/model' }], picks: {} }, { only: null }), /name/);
  assert.throws(() => planTargets({ targets: [{ name: 'x', path: 'http://elsewhere/lore/model' }], picks: {} }, { only: null }), /path/);
  const only = planTargets(manifest, { only: ['model'] });
  assert.deepEqual(only.map(t => t.name), ['model']);
});

test('файл фикстуры — имя.json, тело как пришло, стабильный отступ', () => {
  assert.equal(fixtureFile('record-adr'), 'record-adr.json');
  assert.equal(serialize({ b: 1, a: [1] }), '{\n  "b": 1,\n  "a": [\n    1\n  ]\n}\n');
});

test('секрет в снятом ответе — отказ записи', () => {
  assert.equal(secretLeak('{"rows":[]}', 'tok-123'), null);
  assert.match(secretLeak('{"echo":"tok-123"}', 'tok-123') ?? '', /токен/);
  assert.match(secretLeak('{"h":"Bearer abc.def"}', null) ?? '', /Bearer/);
  assert.match(secretLeak('{"jwt":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"}', null) ?? '', /JWT/);
});

test('индекс: что снято и с каким кодом, без адреса и токена', () => {
  const idx = buildIndex([{ name: 'model', path: '/lore/model', status: 200, file: 'model.json' }],
    { base: 'http://127.0.0.1:9100', token: 'SECRET' }, '2026-11-10T00:00:00Z');
  const text = JSON.stringify(idx);
  assert.equal(idx.fixtures[0].file, 'model.json');
  assert.equal(idx.source, 'local');
  assert.ok(!text.includes('SECRET') && !text.includes('9100'), text);
});

test('скрипт не читает файлов, кроме манифеста, и не знает имён секретов', () => {
  for (const f of ['snapshot.mjs', 'snapshot-core.mjs']) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.doesNotMatch(src, /\.env\b|infisical|credential|\.netrc|\.npmrc/i, f);
    const reads = [...src.matchAll(/readFileSync\(([^)]*)\)/g)].map(m => m[1]);
    for (const r of reads) assert.match(r, /manifest/, `${f}: чтение не манифеста — ${r}`);
  }
});
