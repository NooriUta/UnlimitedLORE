// AL-13 (R1): идемпотентный провижининг realm omilore — две оси RBAC.
// Секреты и админ-пароль НЕ печатаются.
const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

// Читает .env репозитория (gitignored) — как ARCADEDB_ROOT_PASSWORD и прочие
// секреты проекта. Задаётся ОДИН раз, дальше скрипт запускается без аргументов.
function loadDotEnv() {
  const path = require('path').join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const KC = {
  host: process.env.KC_ADMIN_HOST || 'localhost',
  port: Number(process.env.KC_ADMIN_PORT || 18180),
  base: process.env.KC_ADMIN_BASE || '/kc',
};
// Порядок: env процесса → .env репозитория → bootstrap-пара контейнера (fallback).
let ADMIN_USER = process.env.KC_ADMIN_USER, ADMIN_PASS = process.env.KC_ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  try {
    const env = execSync('docker inspect aida-root-keycloak-1 --format "{{range .Config.Env}}{{println .}}{{end}}"').toString();
    ADMIN_USER = ADMIN_USER || ((env.match(/KC_BOOTSTRAP_ADMIN_USERNAME=(.*)/) || [])[1] || '').trim();
    ADMIN_PASS = ADMIN_PASS || ((env.match(/KC_BOOTSTRAP_ADMIN_PASSWORD=(.*)/) || [])[1] || '').trim();
  } catch { /* контейнер не найден — упадём на понятной проверке ниже */ }
}
if (!ADMIN_USER || !ADMIN_PASS) {
  console.log('Нет KC-админ-кредов. Впишите в .env репозитория (gitignored):');
  console.log('  KC_ADMIN_USER=<логин админа Keycloak>');
  console.log('  KC_ADMIN_PASS=<пароль>');
  console.log('Затем: node backend/keycloak/kc-provision-agents.js');
  process.exit(1);
}

function req(method, path, body, token, form) {
  return new Promise((res, rej) => {
    const data = body ? (form ? body : JSON.stringify(body)) : null;
    const r = http.request({
      host: KC.host, port: KC.port, path: KC.base + path, method,
      headers: Object.assign(
        { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {},
        token ? { Authorization: 'Bearer ' + token } : {},
      ),
    }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ code: x.statusCode, body: d })); });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

// ВОСЕМЬ профилей — ровно те, что лежат в mcp-server/agent-profiles/*.json.
// product-analyst отсутствовал здесь с момента появления (v1.0.53): профиль был
// описан и роздан агентам, но клиента в KC под него не создавалось. Пока auth был
// выключен, это ничего не значило; после включения такой агент не получил бы токен
// вовсе. Заодно он единственный владелец продуктового слоя (pain/gain/job/vp) —
// без него эти объекты остались бы без владельца и в матрице AgentScopeFilter.
const PROFILES = ['full', 'architect', 'developer', 'tester', 'pm', 'analyst', 'marketer', 'product-analyst'];

(async () => {
  // 1. admin token (master realm)
  const tok = await req('POST', '/realms/master/protocol/openid-connect/token',
    `grant_type=password&client_id=admin-cli&username=${encodeURIComponent(ADMIN_USER)}&password=${encodeURIComponent(ADMIN_PASS)}`, null, true);
  if (tok.code !== 200) { console.log('ADMIN TOKEN FAIL', tok.code); return; }
  const T = JSON.parse(tok.body).access_token;
  console.log('admin token: OK');

  // 2. realm snapshot
  const clientsR = await req('GET', '/admin/realms/omilore/clients?max=200', null, T);
  const clients = JSON.parse(clientsR.body);
  const byId = Object.fromEntries(clients.map(c => [c.clientId, c]));
  console.log('realm clients:', clients.map(c => c.clientId).join(', '));

  async function ensureClient(clientId, extra) {
    if (byId[clientId]) { console.log('  = client exists:', clientId); return byId[clientId].id; }
    const c = await req('POST', '/admin/realms/omilore/clients', Object.assign({
      clientId, enabled: true, protocol: 'openid-connect',
      publicClient: false, serviceAccountsEnabled: true,
      standardFlowEnabled: false, directAccessGrantsEnabled: false,
    }, extra || {}), T);
    if (c.code !== 201) { console.log('  x create', clientId, c.code, c.body.slice(0, 120)); return null; }
    const list = await req('GET', `/admin/realms/omilore/clients?clientId=${encodeURIComponent(clientId)}`, null, T);
    const id = JSON.parse(list.body)[0].id;
    console.log('  + client created:', clientId);
    return id;
  }

  // 3. агентные клиенты: client-роль agent-<p> + назначение своему SA + маппер agent_scope
  for (const p of PROFILES) {
    const cid = 'lore-mcp-' + p;
    const id = await ensureClient(cid);
    if (!id) continue;
    // client role
    const roles = await req('GET', `/admin/realms/omilore/clients/${id}/roles`, null, T);
    const roleName = 'agent-' + p;
    if (!JSON.parse(roles.body).some(r => r.name === roleName)) {
      await req('POST', `/admin/realms/omilore/clients/${id}/roles`, { name: roleName, description: 'Агентная роль профиля ' + p + ' (SPEC-RBAC-OMILORE-AGENTS)' }, T);
      console.log('    + role', roleName);
    }
    const roleObj = JSON.parse((await req('GET', `/admin/realms/omilore/clients/${id}/roles/${roleName}`, null, T)).body);
    // assign to own service account
    const sa = JSON.parse((await req('GET', `/admin/realms/omilore/clients/${id}/service-account-user`, null, T)).body);
    const cur = JSON.parse((await req('GET', `/admin/realms/omilore/users/${sa.id}/role-mappings/clients/${id}`, null, T)).body || '[]');
    if (!cur.some(r => r.name === roleName)) {
      await req('POST', `/admin/realms/omilore/users/${sa.id}/role-mappings/clients/${id}`, [roleObj], T);
      console.log('    + SA gets', roleName);
    }
    // protocol mapper → claim agent_scope (client roles of THIS client)
    const mappers = JSON.parse((await req('GET', `/admin/realms/omilore/clients/${id}/protocol-mappers/models`, null, T)).body || '[]');
    if (!mappers.some(m => m.name === 'agent_scope')) {
      await req('POST', `/admin/realms/omilore/clients/${id}/protocol-mappers/models`, {
        name: 'agent_scope', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-client-role-mapper',
        config: {
          'usermodel.clientRoleMapping.clientId': cid,
          'claim.name': 'agent_scope', 'jsonType.label': 'String', multivalued: 'true',
          'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false',
        },
      }, T);
      console.log('    + mapper agent_scope');
    }
  }

  // 4. lore-admin: SA + realm-management view-users/manage-users
  const adminId = await ensureClient('lore-admin');
  if (adminId) {
    const sa = JSON.parse((await req('GET', `/admin/realms/omilore/clients/${adminId}/service-account-user`, null, T)).body);
    const rmList = JSON.parse((await req('GET', `/admin/realms/omilore/clients?clientId=realm-management`, null, T)).body);
    if (rmList.length) {
      const rmId = rmList[0].id;
      // view/manage-users — вкладка «Пользователи»; view-clients — список агентных
      // клиентов (/lore/kc/agents); manage-clients — ротация их секретов.
      const want = ['view-users', 'manage-users', 'view-realm', 'view-clients', 'manage-clients'];
      const avail = JSON.parse((await req('GET', `/admin/realms/omilore/users/${sa.id}/role-mappings/clients/${rmId}/available`, null, T)).body || '[]');
      const grant = avail.filter(r => want.includes(r.name));
      if (grant.length) {
        await req('POST', `/admin/realms/omilore/users/${sa.id}/role-mappings/clients/${rmId}`, grant, T);
        console.log('  + lore-admin SA gets:', grant.map(r => r.name).join(', '));
      } else console.log('  = lore-admin realm-management roles already set (or none available)');
    } else console.log('  x realm-management client not found');
  }

  // 5. итоговый снапшот
  const after = JSON.parse((await req('GET', '/admin/realms/omilore/clients?max=200', null, T)).body);
  console.log('итог clients:', after.map(c => c.clientId).sort().join(', '));
})().catch(e => console.log('ERR', e.message));
