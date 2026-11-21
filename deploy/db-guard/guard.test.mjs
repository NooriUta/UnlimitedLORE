// SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 · Сторож входов в ArcadeDB: разбор заголовка, агрегация за минуту,
// тревога на root вне известных источников, «секрета нет ни в записи, ни в журнале».
// Запуск: node --test deploy/db-guard/*.test.mjs (без сети наружу и без зависимостей).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  principalOf, routeOf, firstPerMinute, rootAlarm, parseSources, recordOf, insertCommand, writerAuthProblem,
} from './lib.mjs';
import { startGuard } from './guard.mjs';

const b64 = s => Buffer.from(s, 'utf8').toString('base64');

// ── Разбор заголовка ────────────────────────────────────────────────────────────────────────────────
test('Basic root:<пароль> → root, пароля в ответе нет', () => {
  const p = principalOf('Basic ' + b64('root:S3cr3t-pass'));
  assert.equal(p, 'root');
});

test('Bearer → apitoken:<имя> по отпечатку из настройки; секрета нет', () => {
  const names = new Map([['sha256:' + 'x', 'ignored']]);
  const tok = 'AT-very-secret-token-value';
  const fp = principalOf.fingerprint(tok);
  assert.match(fp, /^sha256:[0-9a-f]{16}$/);
  assert.ok(!fp.includes(tok));
  names.set(fp, 'lore-bench');
  assert.equal(principalOf('Bearer ' + tok, names), 'apitoken:lore-bench');
  assert.equal(principalOf('Bearer other-token', names), 'apitoken:(unknown)');
});

test('нет заголовка, мусор, пароль с двоеточием', () => {
  assert.equal(principalOf(undefined), '(none)');
  assert.equal(principalOf(''), '(none)');
  assert.equal(principalOf('Basic %%%'), '(unparsed)');
  assert.equal(principalOf('Digest abc'), '(unparsed)');
  assert.equal(principalOf('Basic ' + b64('lore:a:b:c')), 'lore');
  assert.equal(principalOf('basic ' + b64('root:x')), 'root', 'схема без учёта регистра');
});

// ── Маршрут: база и путь без запроса и без текста SQL ───────────────────────────────────────────────
test('база и путь: строка запроса и текст SQL в пути не попадают в запись', () => {
  assert.deepEqual(routeOf('/api/v1/command/system_aida_lore'), { database: 'system_aida_lore', path: '/api/v1/command/system_aida_lore' });
  assert.deepEqual(routeOf('/api/v1/query/lore/sql/select%20password%20from%20x?token=abc'), { database: 'lore', path: '/api/v1/query/lore/sql' });
  assert.deepEqual(routeOf('/api/v1/server?x=1'), { database: '', path: '/api/v1/server' });
  assert.deepEqual(routeOf('/api/v1/ready'), { database: '', path: '/api/v1/ready' });
  assert.equal(routeOf('/' + 'a'.repeat(500)).path.length <= 120, true);
});

// ── Агрегация «первый вход user×источник за минуту» ─────────────────────────────────────────────────
test('агрегация: первый запрос пары за минуту пишется, повтор в ту же минуту — нет, новая минута — снова да', () => {
  const agg = firstPerMinute();
  const t0 = Date.UTC(2026, 10, 19, 10, 0, 5);
  assert.equal(agg('root', '172.18.0.4', t0), true);
  assert.equal(agg('root', '172.18.0.4', t0 + 30_000), false);
  assert.equal(agg('lore', '172.18.0.4', t0 + 30_000), true, 'другой пользователь — своя пара');
  assert.equal(agg('root', '172.18.0.9', t0 + 30_000), true, 'другой источник — своя пара');
  assert.equal(agg('root', '172.18.0.4', t0 + 55_000), true, 'новая календарная минута');
  assert.equal(agg('root', '172.18.0.4', t0 + 56_000), false);
});

test('агрегация не копит память: старые минуты вычищаются', () => {
  const agg = firstPerMinute();
  const t0 = Date.UTC(2026, 10, 19, 10, 0, 0);
  for (let i = 0; i < 1000; i++) agg('u' + i, 'ip', t0);
  agg('x', 'ip', t0 + 120_000);
  assert.ok(agg.size() <= 1, 'осталась только текущая минута, а было ' + agg.size());
});

// ── Тревога ─────────────────────────────────────────────────────────────────────────────────────────
test('тревога: root вне списка известных источников — событие; в списке — нет; не root — нет', () => {
  const known = parseSources('lore-backend, 10.0.0.0/8, 192.168.3.131');
  assert.equal(rootAlarm({ user: 'root', src_ip: '172.18.0.4', src_container: 'lore-backend' }, known), null);
  assert.equal(rootAlarm({ user: 'root', src_ip: '10.1.2.3', src_container: '' }, known), null);
  assert.equal(rootAlarm({ user: 'root', src_ip: '192.168.3.131', src_container: '' }, known), null);
  assert.equal(rootAlarm({ user: 'lore', src_ip: '8.8.8.8', src_container: '' }, known), null);
  const ev = rootAlarm({ ts: 1, user: 'root', src_ip: '192.168.3.50', src_container: 'stranger', database: 'lore', path: '/api/v1/command/lore' }, known);
  assert.equal(ev.kind, 'root_outside_known_sources');
  assert.equal(ev.src_ip, '192.168.3.50');
  assert.equal(ev.src_container, 'stranger');
});

test('пустой список источников: любой root — тревога', () => {
  assert.ok(rootAlarm({ user: 'root', src_ip: '127.0.0.1', src_container: '' }, parseSources('')));
});

// ── Запись ──────────────────────────────────────────────────────────────────────────────────────────
test('запись — столбцы ряда AuditDbLogin из модели и параметрами, не текстом', () => {
  const r = recordOf({ ts: 5, user: 'root', src_ip: '::ffff:172.18.0.4', src_container: 'lore-backend', database: 'lore', method: 'POST', path: '/api/v1/command/lore', status: 200 });
  assert.deepEqual(Object.keys(r), ['ts', 'user', 'src_ip', 'src_container', 'database', 'method', 'path', 'status']);
  assert.equal(r.src_ip, '172.18.0.4', 'IPv4 в IPv6-обёртке разворачивается');
  const c = insertCommand(r);
  assert.equal(c.language, 'sql');
  assert.equal(c.command, 'INSERT INTO AuditDbLogin SET ts = :ts, user = :user, src_ip = :src_ip, src_container = :src_container, database = :database, method = :method, path = :path, status = :status');
  assert.deepEqual(c.params, r);
});

test('сторож пишет не под root: Basic root — отказ старта, токен — да', () => {
  assert.match(writerAuthProblem('Basic ' + b64('root:x')), /root/);
  assert.equal(writerAuthProblem('Bearer abc'), null);
  assert.match(writerAuthProblem(''), /токен/);
  assert.equal(writerAuthProblem('Basic ' + b64('root:x'), { rehearsal: true }), null, 'на копии для репетиции — можно');
});

// ── Сторож целиком: секрета нет ни в записи, ни в журнале ───────────────────────────────────────────
function upstream() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(req.url.startsWith('/api/v1/server') ? 403 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: [{ ok: 1 }] }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })));
}

function call(port, path, auth, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: auth ? { authorization: auth } : {} }, res => {
      let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: t }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('сторож: прокси пропускает запрос с заголовком как есть, пишет имя и статус, секрета нет нигде', async () => {
  const up = await upstream();
  const records = [], alarms = [], journal = [];
  const PASS = 'R00t-Pa55-zz9', TOKEN = 'AT-guard-secret-77';
  const g = await startGuard({
    upstream: `http://127.0.0.1:${up.port}`, port: 0, host: '127.0.0.1',
    knownRootSources: parseSources('10.9.9.9'),
    tokenNames: new Map([[principalOf.fingerprint(TOKEN), 'lore-bench']]),
    write: async r => { records.push(r); },
    notify: async e => { alarms.push(e); },
    resolveContainer: async () => 'probe-box',
    log: (...a) => journal.push(a.join(' ')),
  });
  try {
    const r1 = await call(g.port, '/api/v1/command/lore?pw=' + PASS, 'Basic ' + b64('root:' + PASS), '{"command":"select 1"}');
    assert.equal(r1.status, 200);
    await call(g.port, '/api/v1/command/lore', 'Basic ' + b64('root:' + PASS), '{}'); // та же минута — без записи
    const r3 = await call(g.port, '/api/v1/server', 'Bearer ' + TOKEN);
    assert.equal(r3.status, 403, 'статус ответа базы доходит до клиента');
    await g.idle();

    assert.equal(up.seen[0].auth, 'Basic ' + b64('root:' + PASS), 'заголовок уходит в базу без изменений');
    assert.equal(up.seen.length, 3);

    assert.equal(records.length, 2, 'root за минуту — один раз, токен — отдельно');
    assert.equal(records[0].user, 'root');
    assert.equal(records[0].database, 'lore');
    assert.equal(records[0].path, '/api/v1/command/lore');
    assert.equal(records[0].src_container, 'probe-box');
    assert.equal(records[0].status, 200);
    assert.equal(records[1].user, 'apitoken:lore-bench');
    assert.equal(records[1].status, 403);

    assert.equal(alarms.length, 1, 'root из неизвестного источника — тревога');
    assert.equal(alarms[0].user, 'root');

    const everything = JSON.stringify({ records, alarms, journal });
    for (const secret of [PASS, TOKEN, b64('root:' + PASS)]) assert.ok(!everything.includes(secret), 'секрет просочился: ' + secret.slice(0, 3) + '…');
    assert.ok(journal.length > 0, 'журнал есть — проверка не пустая');
  } finally {
    await g.close();
    up.srv.close();
  }
});

test('сторож: база недоступна — клиент получает 502, запись идёт со статусом 502, запрос не висит', async () => {
  const records = [];
  const g = await startGuard({
    upstream: 'http://127.0.0.1:1', port: 0, host: '127.0.0.1', knownRootSources: parseSources(''),
    write: async r => { records.push(r); }, notify: async () => {}, resolveContainer: async () => '', log: () => {},
  });
  try {
    const r = await call(g.port, '/api/v1/ready', 'Basic ' + b64('lore:x'));
    assert.equal(r.status, 502);
    await g.idle();
    assert.equal(records[0].status, 502);
  } finally { await g.close(); }
});

test('сторож: запись в ряд упала — прокси продолжает работать, в журнале причина без секрета', async () => {
  const up = await upstream();
  const journal = [];
  const g = await startGuard({
    upstream: `http://127.0.0.1:${up.port}`, port: 0, host: '127.0.0.1', knownRootSources: parseSources('127.0.0.1'),
    write: async () => { throw new Error('HTTP 403 not allowed to create record'); }, notify: async () => {},
    resolveContainer: async () => '', log: (...a) => journal.push(a.join(' ')),
  });
  try {
    const r = await call(g.port, '/api/v1/command/lore', 'Basic ' + b64('root:Zz-secret'), '{}');
    assert.equal(r.status, 200);
    await g.idle();
    assert.ok(journal.some(l => l.includes('запись не удалась')), journal.join('\n'));
    assert.ok(!journal.join('\n').includes('Zz-secret'));
  } finally { await g.close(); up.srv.close(); }
});
