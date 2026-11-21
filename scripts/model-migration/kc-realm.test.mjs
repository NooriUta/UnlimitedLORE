// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Новая установка: область и клиенты Keycloak заводит установщик (слово владелицы
// 17.11.2026 «ты реинсталлишь»). Здесь — план запросов к admin API и его разбор; исполнение — с логином администратора
// Keycloak, который вводит человек в окне установщика.
// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.1): учётки MCP по ролям модели и по harness, настройки клиентов —
// один в один с ранбуком RUNBOOK-CORE-KC-INFISICAL-LOREHOST; доводка установленной области; «свои клиенты уже есть».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realmPlan, stepVerdict, mcpAccounts, notAbove, secretKeyOf, topUpPlan, checkOwnClients, roleOrder } from './kc-realm.mjs';

const plan = () => realmPlan({ realm: 'lore', webOrigin: 'https://lore.example.org', harnesses: ['claude', 'kimi'] });
const ROLES = ['full', 'architect', 'pm', 'product-analyst', 'analyst', 'developer', 'marketer', 'tester'];

test('порядок ролей — из модели: full > architect > pm > (четыре) > tester; marketer под pm', () => {
  assert.deepEqual(roleOrder(), ROLES);
  assert.ok(notAbove('marketer', 'pm'));
  assert.ok(notAbove('tester', 'developer'));
  assert.ok(!notAbove('full', 'pm'));
  assert.ok(!notAbove('analyst', 'developer'));
});

test('порядок: область → роли → клиент веба → учётки MCP Claude Code по всем ролям → главная kimi', () => {
  const p = plan();
  const clients = p.filter(s => s.id.startsWith('client:')).map(s => s.id);
  assert.deepEqual(clients, ['client:lore-app', ...ROLES.map(r => 'client:lore-mcp-' + r), 'client:lore-mcp-full_kimi']);
  assert.deepEqual(p.slice(0, 5).map(s => s.id), ['realm', 'role:superadmin', 'role:admin', 'role:viewer', 'client:lore-app']);
  assert.equal(p[0].path, '/admin/realms');
  assert.deepEqual(p[0].body, { realm: 'lore', enabled: true });
});

test('клиент веба: публичный, вход с PKCE S256, адреса — только своего веба, выход — как вход, роли в claim seer_roles', () => {
  const web = plan().find(s => s.id === 'client:lore-app').body;
  assert.equal(web.publicClient, true);
  assert.equal(web.standardFlowEnabled, true);
  assert.equal(web.directAccessGrantsEnabled, false);
  assert.equal(web.attributes['pkce.code.challenge.method'], 'S256');
  assert.equal(web.attributes['post.logout.redirect.uris'], '+');
  assert.deepEqual(web.redirectUris, ['https://lore.example.org/*']);
  assert.deepEqual(web.webOrigins, ['https://lore.example.org']);
  const m = web.protocolMappers.find(x => x.config['claim.name'] === 'seer_roles');
  assert.ok(m && m.protocolMapper === 'oidc-usermodel-realm-role-mapper' && m.config.multivalued === 'true');
});

test('учётка MCP как в ранбуке: client auth и service accounts, оба маппера, своя роль agent-<роль>; admin — только у full', () => {
  const p = plan();
  for (const id of ['lore-mcp-full', 'lore-mcp-tester', 'lore-mcp-full_kimi']) {
    const c = p.find(s => s.id === 'client:' + id).body;
    assert.equal(c.publicClient, false);
    assert.equal(c.serviceAccountsEnabled, true);
    assert.equal(c.standardFlowEnabled, false);
    assert.equal(c.directAccessGrantsEnabled, false);
    const claims = c.protocolMappers.map(m => m.config['claim.name']);
    assert.deepEqual(claims.sort(), ['agent_scope', 'seer_roles'], id + ': оба маппера — без agent_scope учётка только читает');
    assert.equal(c.protocolMappers.find(m => m.config['claim.name'] === 'agent_scope').config['usermodel.clientRoleMapping.clientId'], id, 'роль — своего клиента');
  }
  assert.ok(p.some(s => s.id === 'clientrole:lore-mcp-tester:agent-tester'));
  assert.ok(p.some(s => s.id === 'clientrole:lore-mcp-full_kimi:agent-full'));
  assert.ok(p.some(s => s.id === 'sa-client:lore-mcp-tester'));
  assert.deepEqual(p.filter(s => s.id.startsWith('sa-realm:')).map(s => s.id), ['sa-realm:lore-mcp-full', 'sa-realm:lore-mcp-full_kimi'],
    'realm-роль admin — только у главной full');
});

test('другой harness: главная роль и младшие по выбору; выше главной — отказ; имя и ключ секрета по harness', () => {
  const a = mcpAccounts({ harnesses: ['kimi'], extraRoles: { kimi: ['tester', 'developer'] } }).filter(x => x.harness === 'kimi-code');
  assert.deepEqual(a.map(x => x.clientId), ['lore-mcp-full_kimi', 'lore-mcp-tester_kimi', 'lore-mcp-developer_kimi']);
  assert.deepEqual(a.map(x => x.secretKey), ['LORE_MCP_CLIENT_SECRET_FULL_KIMI', 'LORE_MCP_CLIENT_SECRET_TESTER_KIMI', 'LORE_MCP_CLIENT_SECRET_DEVELOPER_KIMI']);
  assert.equal(secretKeyOf('product-analyst'), 'LORE_MCP_CLIENT_SECRET_PRODUCT_ANALYST');
  assert.throws(() => mcpAccounts({ harnesses: ['qwen'] }), /главной роли/);
  assert.throws(() => mcpAccounts({ harnesses: ['kimi'], extraRoles: { kimi: ['ghost'] } }), /выше главной/);
});

test('свои имена клиентов: схема — только умолчание', () => {
  const p = realmPlan({ realm: 'lore', webOrigin: 'https://w.example', harnesses: [], names: { 'lore-app': 'my-web', 'lore-mcp-full': 'acme-agents' }, ownRealm: true });
  assert.ok(!p.some(s => s.id === 'realm'), 'своя область не заводится');
  assert.ok(p.some(s => s.id === 'client:my-web'));
  assert.ok(p.some(s => s.id === 'client:acme-agents'));
  assert.equal(p.find(s => s.id === 'client:acme-agents').secretKey, 'LORE_MCP_CLIENT_SECRET_FULL');
});

test('ввод проверяется до запросов: имя области, адрес веба, коды harness', () => {
  assert.throws(() => realmPlan({ realm: 'bad realm', webOrigin: 'https://x', harnesses: [] }), /област/);
  assert.throws(() => realmPlan({ realm: 'lore', webOrigin: 'ftp://x', harnesses: [] }), /адрес/);
  assert.throws(() => realmPlan({ realm: 'lore', webOrigin: 'https://x/path', harnesses: [] }), /адрес/);
  assert.throws(() => realmPlan({ realm: 'lore', webOrigin: 'https://x', harnesses: ['Claude Code'] }), /harness/);
});

test('доводка установленной области: клиент без agent_scope → шаги доводки; всё на месте → пусто; ничего не удаляет', () => {
  const accounts = mcpAccounts({ harnesses: [] }).filter(a => a.role === 'full' || a.role === 'tester');
  const ok = {
    'lore-mcp-full': { exists: true, mappers: ['seer_roles', 'agent_scope'], ownRoles: ['agent-full'], ownerRoles: ['agent-full'], saRealm: ['admin', 'default-roles-lore'], saClient: { 'lore-mcp-full': ['agent-full'] } },
    'lore-mcp-tester': { exists: true, mappers: ['seer_roles', 'agent_scope'], ownRoles: ['agent-tester'], ownerRoles: ['agent-tester'], saRealm: ['default-roles-lore'], saClient: { 'lore-mcp-tester': ['agent-tester'] } },
  };
  assert.deepEqual(topUpPlan({ realm: 'lore', accounts, state: ok }), [], 'повтор на доведённой области — пустой план');
  const old = { ...ok, 'lore-mcp-full': { exists: true, mappers: ['seer_roles'], ownRoles: [], ownerRoles: [], saRealm: ['default-roles-lore'], saClient: {} } };
  const steps = topUpPlan({ realm: 'lore', accounts, state: old });
  assert.deepEqual(steps.map(s => s.id), ['fix-mapper:lore-mcp-full:agent_scope', 'fix-clientrole:lore-mcp-full:agent-full', 'fix-sa-realm:lore-mcp-full', 'fix-sa-client:lore-mcp-full']);
  assert.ok(steps.every(s => s.method === 'POST'), 'только добавлять');
  const missing = topUpPlan({ realm: 'lore', accounts, state: { 'lore-mcp-full': ok['lore-mcp-full'] } });
  assert.deepEqual(missing.map(s => s.id), ['client:lore-mcp-tester', 'clientrole:lore-mcp-tester:agent-tester', 'sa-client:lore-mcp-tester'], 'недостающая младшая — заводится целиком');
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

const jwt = claims => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';

test('«свои клиенты и секреты уже есть»: ни одного запроса к admin API, только токен по их паре и проверка ролей', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.method + ' ' + url);
    const p = new URLSearchParams(init.body);
    if (p.get('client_secret') !== 'их-секрет') return { status: 401, text: async () => '{}' };
    const role = p.get('client_id') === 'acme-tester' ? 'tester' : 'full';
    const claims = p.get('client_id') === 'acme-readonly' ? { seer_roles: ['admin'] } : { agent_scope: ['agent-' + role], seer_roles: ['default-roles'] };
    return { status: 200, text: async () => JSON.stringify({ access_token: jwt(claims) }) };
  };
  const out = await checkOwnClients({
    issuer: 'https://kc.example/realms/acme', fetchImpl,
    env: { ACME_TESTER: 'их-секрет', ACME_RO: 'их-секрет', ACME_BAD: 'не тот' },
    accounts: [
      { clientId: 'acme-tester', role: 'tester', secretVar: 'ACME_TESTER' },
      { clientId: 'acme-readonly', role: 'full', secretVar: 'ACME_RO' },
      { clientId: 'acme-bad', role: 'full', secretVar: 'ACME_BAD' },
      { clientId: 'acme-none', role: 'full', secretVar: 'ACME_NONE' },
    ],
  });
  assert.deepEqual(out.map(r => r.state), ['ok', 'fail', 'fail', 'unchecked']);
  assert.match(out[1].reason, /agent_scope/);
  assert.match(out[3].reason, /не смогли/, 'нет переменной — «не проверили», а не «пусто»');
  assert.ok(seen.every(s => s.startsWith('POST https://kc.example/realms/acme/protocol/openid-connect/token')), 'только выдача токена: ' + seen);
  assert.ok(!JSON.stringify(out).includes('их-секрет'), 'секрет в ответ не попадает');
});

test('исполнение на поддельном Keycloak: токен администратора, подстановки id, шаги по порядку, секреты — только заведённых и ключами по ролям', async () => {
  const http = await import('node:http');
  const { applyRealm } = await import('./kc-realm.mjs');
  const seen = [];
  const existing = new Set(['role:admin', 'client:lore-mcp-architect']); // уже есть — 409
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      seen.push(req.method + ' ' + req.url + (req.headers.authorization ? ' [auth]' : ''));
      const u = new URL(req.url, 'http://x');
      if (req.url === '/realms/master/protocol/openid-connect/token') {
        const ok = new URLSearchParams(b).get('password') === 'верный';
        res.writeHead(ok ? 200 : 401); return res.end(ok ? JSON.stringify({ access_token: 't' }) : '{}');
      }
      if (req.method === 'POST' && req.url.endsWith('/roles') && !req.url.includes('/clients/') && existing.has('role:' + JSON.parse(b).name)) { res.writeHead(409); return res.end('{}'); }
      if (req.method === 'POST' && u.pathname.endsWith('/clients') && existing.has('client:' + JSON.parse(b).clientId)) { res.writeHead(409); return res.end('{}'); }
      if (req.method === 'POST') { res.writeHead(201); return res.end(); }
      if (u.searchParams.get('clientId')) { res.writeHead(200); return res.end(JSON.stringify([{ id: 'id-' + u.searchParams.get('clientId') }])); }
      if (req.url.endsWith('/service-account-user')) { res.writeHead(200); return res.end(JSON.stringify({ id: 'sa-' + req.url.split('/clients/')[1].split('/')[0] })); }
      if (req.url.endsWith('/client-secret')) { res.writeHead(200); return res.end(JSON.stringify({ value: 'секрет-' + req.url.split('/clients/')[1].split('/')[0] })); }
      if (/\/roles\/[^/]+$/.test(u.pathname)) { res.writeHead(200); return res.end(JSON.stringify({ id: 'r-' + u.pathname.split('/').pop(), name: decodeURIComponent(u.pathname.split('/').pop()) })); }
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
    assert.ok(ok.results.every(r => r.state !== 'fail'), JSON.stringify(ok.results.filter(r => r.state === 'fail')));
    assert.equal(ok.results.find(r => r.id === 'client:lore-mcp-architect').state, 'exists');
    assert.ok(!('LORE_MCP_CLIENT_SECRET_ARCHITECT' in written), 'существующему клиенту секрет не читается и не перевыпускается');
    assert.equal(written.LORE_MCP_CLIENT_SECRET_FULL, 'секрет-id-lore-mcp-full');
    assert.equal(written.LORE_MCP_CLIENT_SECRET_FULL_KIMI, 'секрет-id-lore-mcp-full_kimi');
    assert.ok(seen.includes('POST /admin/realms/lore/users/sa-id-lore-mcp-tester/role-mappings/clients/id-lore-mcp-tester [auth]'), 'подстановка id сервисной учётки и клиента');
    assert.ok(!JSON.stringify(ok.results).includes('секрет-'), 'значения секретов в результат не попадают');
    assert.ok(seen.filter(x => x.startsWith('POST /admin')).every(x => x.endsWith('[auth]')), 'все запросы admin API — с токеном');
  } finally { srv.close(); }
});

test('окно установщика: по умолчанию — спросить, что уже есть; свои имена, младшие роли и переменные секретов разбираются', async () => {
  const { kcForm } = await import('./kc-realm.mjs');
  assert.equal(kcForm({}).mode, 'ask', 'молча ничего не заводим');
  const f = kcForm({ kcMode: 'own', harness: 'kimi', kcExtra: 'tester', kcNames: 'lore-mcp-full_kimi=acme-kimi', kcSecretVars: 'full=ACME_FULL' });
  assert.deepEqual(f.extraRoles, { kimi: ['tester'] });
  assert.ok(f.accounts.some(a => a.clientId === 'acme-kimi' && a.role === 'full'));
  assert.equal(f.secretVars.full, 'ACME_FULL');
  assert.throws(() => kcForm({ kcMode: 'drop-all' }), /режим/);
  assert.throws(() => kcForm({ kcMode: 'own', kcSecretVars: 'full=bad var' }), /переменной/);
});
