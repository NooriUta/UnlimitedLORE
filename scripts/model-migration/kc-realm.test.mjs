// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Новая установка: область и клиенты Keycloak заводит установщик (слово владелицы
// 17.11.2026 «ты реинсталлишь»). Здесь — план запросов к admin API и его разбор; исполнение — с логином администратора
// Keycloak, который вводит человек в окне установщика.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realmPlan, stepVerdict } from './kc-realm.mjs';

const plan = () => realmPlan({ realm: 'lore', webOrigin: 'https://lore.example.org', harnesses: ['claude', 'kimi'] });

test('порядок: область → роли → клиент веба → клиенты MCP по harness', () => {
  const p = plan();
  assert.deepEqual(p.map(s => s.id), ['realm', 'role:superadmin', 'role:admin', 'role:viewer', 'client:lore-app', 'client:lore-mcp-full', 'client:lore-mcp-full_kimi']);
  assert.equal(p[0].method, 'POST');
  assert.equal(p[0].path, '/admin/realms');
  assert.deepEqual(p[0].body, { realm: 'lore', enabled: true });
});

test('клиент веба: публичный, вход с PKCE S256, адреса — только своего веба, роли в claim seer_roles (как читает бэкенд)', () => {
  const web = plan().find(s => s.id === 'client:lore-app').body;
  assert.equal(web.publicClient, true);
  assert.equal(web.standardFlowEnabled, true);
  assert.equal(web.directAccessGrantsEnabled, false);
  assert.equal(web.attributes['pkce.code.challenge.method'], 'S256');
  assert.deepEqual(web.redirectUris, ['https://lore.example.org/*']);
  assert.deepEqual(web.webOrigins, ['https://lore.example.org']);
  const m = web.protocolMappers.find(x => x.config['claim.name'] === 'seer_roles');
  assert.ok(m && m.protocolMapper === 'oidc-usermodel-realm-role-mapper' && m.config.multivalued === 'true');
});

test('клиенты MCP: конфиденциальные, только учётка сервиса (client_credentials), без входа пользователя; имя по harness', () => {
  for (const id of ['client:lore-mcp-full', 'client:lore-mcp-full_kimi']) {
    const c = plan().find(s => s.id === id).body;
    assert.equal(c.publicClient, false);
    assert.equal(c.serviceAccountsEnabled, true);
    assert.equal(c.standardFlowEnabled, false);
    assert.equal(c.directAccessGrantsEnabled, false);
  }
});

test('ввод проверяется до запросов: имя области, адрес веба, коды harness', () => {
  assert.throws(() => realmPlan({ realm: 'bad realm', webOrigin: 'https://x', harnesses: [] }), /област/);
  assert.throws(() => realmPlan({ realm: 'lore', webOrigin: 'ftp://x', harnesses: [] }), /адрес/);
  assert.throws(() => realmPlan({ realm: 'lore', webOrigin: 'https://x/path', harnesses: [] }), /адрес/);
  assert.throws(() => realmPlan({ realm: 'lore', webOrigin: 'https://x', harnesses: ['Claude Code'] }), /harness/);
});

test('ответ Keycloak: 201 — заведено; 409 — уже есть (повтор не ошибка); 401/403 — нет прав; иное — с текстом', () => {
  assert.equal(stepVerdict({ status: 201 }).state, 'created');
  assert.equal(stepVerdict({ status: 204 }).state, 'created');
  assert.equal(stepVerdict({ status: 409 }).state, 'exists');
  assert.match(stepVerdict({ status: 401 }).reason, /администратор/);
  assert.equal(stepVerdict({ status: 403 }).state, 'fail');
  assert.match(stepVerdict({ status: 400, body: '{"errorMessage":"Invalid redirect"}' }).reason, /Invalid redirect/);
  assert.equal(stepVerdict({ error: 'ECONNREFUSED' }).state, 'unchecked');
});

test('адрес области (issuer) → адрес Keycloak и имя области; без /realms/<имя> — отказ', async () => {
  const { issuerParts } = await import('./kc-realm.mjs');
  assert.deepEqual(issuerParts('https://kc.example.org/realms/lore'), { kcUrl: 'https://kc.example.org', realm: 'lore' });
  assert.deepEqual(issuerParts('https://odal.example.org/kc/realms/omilore/'), { kcUrl: 'https://odal.example.org/kc', realm: 'omilore' });
  assert.throws(() => issuerParts('https://kc.example.org/'), /realms/);
});

test('исполнение на поддельном Keycloak: токен администратора, шаги по порядку, повтор — «уже есть», секреты — только в файл', async () => {
  const http = await import('node:http');
  const { applyRealm } = await import('./kc-realm.mjs');
  const seen = [];
  const existing = new Set(['role:admin']); // одна роль уже есть — 409
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      seen.push(req.method + ' ' + req.url + (req.headers.authorization ? ' [auth]' : ''));
      if (req.url === '/realms/master/protocol/openid-connect/token') {
        const ok = new URLSearchParams(b).get('password') === 'верный';
        res.writeHead(ok ? 200 : 401); return res.end(ok ? JSON.stringify({ access_token: 't' }) : '{}');
      }
      if (req.method === 'POST' && req.url.endsWith('/roles') && existing.has('role:' + JSON.parse(b).name)) { res.writeHead(409); return res.end('{}'); }
      if (req.method === 'POST') { res.writeHead(201); return res.end(); }
      if (req.url.includes('/clients?clientId=')) { res.writeHead(200); return res.end(JSON.stringify([{ id: 'id-' + new URL(req.url, 'http://x').searchParams.get('clientId') }])); }
      if (req.url.endsWith('/client-secret')) { res.writeHead(200); return res.end(JSON.stringify({ value: 'секрет-' + req.url.split('/clients/')[1].split('/')[0] })); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const kcUrl = 'http://127.0.0.1:' + srv.address().port;
  try {
    const bad = await applyRealm({ kcUrl, adminUser: 'admin', adminPassword: 'не тот', steps: realmPlan({ realm: 'lore', webOrigin: 'https://w', harnesses: [] }), writeSecrets: () => 'x' });
    assert.equal(bad.results[0].state, 'fail');
    assert.match(bad.results[0].reason, /администратор/);
    let written = null;
    const ok = await applyRealm({ kcUrl, adminUser: 'admin', adminPassword: 'верный', steps: realmPlan({ realm: 'lore', webOrigin: 'https://w', harnesses: ['kimi'] }), writeSecrets: s => { written = s; return '/tmp/kc-clients.env'; } });
    assert.deepEqual(ok.results.map(r => r.state), ['created', 'created', 'exists', 'created', 'created', 'created', 'created', 'created']);
    assert.deepEqual(written, { 'lore-mcp-full': 'секрет-id-lore-mcp-full', 'lore-mcp-full_kimi': 'секрет-id-lore-mcp-full_kimi' });
    assert.ok(!JSON.stringify(ok.results).includes('секрет-'), 'значения секретов в результат не попадают');
    assert.ok(seen.filter(x => x.startsWith('POST /admin')).every(x => x.endsWith('[auth]')), 'все запросы admin API — с токеном');
  } finally { srv.close(); }
});
