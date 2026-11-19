// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Новая установка: область и клиенты Keycloak — план запросов к admin API.
// Слово владелицы 17.11.2026 «ты реинсталлишь»: на НОВОЙ установке область, клиенты и роли заводит установщик. Общий
// Keycloak нашей инфраструктуры этим не трогается — для него действует правило «меняет только человек».
// Роли — как читает бэкенд LORE: realm-роли superadmin / admin / viewer в claim seer_roles (SeerRoleFromTokenFilter).
// Клиент веба — lore-app (публичный, PKCE S256); клиенты MCP — lore-mcp-full и lore-mcp-full_<harness> (clientIdFor).
import { clientIdFor } from './setup.mjs';

const REALM = /^[a-z][a-z0-9_-]{1,40}$/;
const HARNESS = /^[a-z][a-z0-9-]{0,31}$/;
export const SEER_ROLES = ['superadmin', 'admin', 'viewer'];

const seerRolesMapper = () => ({
  name: 'seer_roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper',
  config: { 'claim.name': 'seer_roles', multivalued: 'true', 'jsonType.label': 'String', 'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' },
});

/** План запросов: [{id, method, path, body}] — по порядку, повтор безопасен (409 «уже есть»). */
export function realmPlan({ realm, webOrigin, harnesses = [] }) {
  if (!REALM.test(realm || '')) throw new Error('имя области: строчные латинские буквы, цифры, «-» и «_», с буквы');
  let origin;
  try { origin = new URL(webOrigin); } catch { throw new Error('адрес веба LORE — http(s)://хост[:порт]'); }
  if (!/^https?:$/.test(origin.protocol) || (origin.pathname !== '/' && origin.pathname !== '') || origin.search) throw new Error('адрес веба LORE — только http(s)://хост[:порт], без пути');
  for (const h of harnesses) if (!HARNESS.test(h)) throw new Error('harness — код справочника (claude, kimi, qwen …): ' + h);
  const base = origin.origin;
  const r = encodeURIComponent(realm);
  const steps = [{ id: 'realm', method: 'POST', path: '/admin/realms', body: { realm, enabled: true } }];
  for (const name of SEER_ROLES) steps.push({ id: 'role:' + name, method: 'POST', path: `/admin/realms/${r}/roles`, body: { name } });
  steps.push({ id: 'client:lore-app', method: 'POST', path: `/admin/realms/${r}/clients`, body: {
    clientId: 'lore-app', name: 'LORE — веб', protocol: 'openid-connect', publicClient: true,
    standardFlowEnabled: true, directAccessGrantsEnabled: false, serviceAccountsEnabled: false, implicitFlowEnabled: false,
    redirectUris: [base + '/*'], webOrigins: [base], attributes: { 'pkce.code.challenge.method': 'S256' },
    protocolMappers: [seerRolesMapper()],
  } });
  const mcp = [...new Set(['lore-mcp-full', ...harnesses.map(clientIdFor)])];
  for (const clientId of mcp) steps.push({ id: 'client:' + clientId, method: 'POST', path: `/admin/realms/${r}/clients`, body: {
    clientId, name: 'LORE MCP — ' + clientId, protocol: 'openid-connect', publicClient: false,
    standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: true, implicitFlowEnabled: false,
    protocolMappers: [seerRolesMapper()],
  } });
  return steps;
}

/** Адрес области (issuer, …/realms/<имя>) → адрес Keycloak и имя области. */
export function issuerParts(issuer) {
  const m = /^(https?:\/\/[^?#]+?)\/realms\/([^/?#]+)\/?$/.exec(String(issuer || '').trim());
  if (!m) throw new Error('адрес области Keycloak — вида https://keycloak/realms/<имя>');
  return { kcUrl: m[1], realm: decodeURIComponent(m[2]) };
}

/**
 * Исполнение плана: токен администратора (область master, клиент admin-cli) по логину и паролю, которые человек ввёл
 * в окне; пароль живёт только в этом вызове. Затем шаги по порядку; секреты клиентов MCP — в файл secretsFile (права 600),
 * на экран не выводятся. Возвращает [{id, state, reason}] и путь файла секретов.
 */
export async function applyRealm({ kcUrl, adminUser, adminPassword, steps, writeSecrets }) {
  const tok = await fetch(kcUrl + '/realms/master/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUser, password: adminPassword }), signal: AbortSignal.timeout(15000) })
    .then(async r => ({ status: r.status, body: await r.text() }), e => ({ error: e.cause?.code || e.message }));
  if (tok.error || tok.status !== 200) return { results: [{ id: 'admin-login', ...stepVerdict(tok.status === 400 ? { ...tok, status: 401 } : tok) }] };
  const auth = { Authorization: 'Bearer ' + JSON.parse(tok.body).access_token, 'Content-Type': 'application/json' };
  const results = [];
  for (const s of steps) {
    const r = await fetch(kcUrl + s.path, { method: s.method, headers: auth, body: JSON.stringify(s.body), signal: AbortSignal.timeout(15000) })
      .then(async x => ({ status: x.status, body: await x.text() }), e => ({ error: e.cause?.code || e.message }));
    const v = stepVerdict(r);
    results.push({ id: s.id, ...v });
    if (v.state === 'fail' || v.state === 'unchecked') return { results };
  }
  // секреты конфиденциальных клиентов: id клиента → client-secret
  const realm = steps[0].body.realm, secrets = {};
  for (const s of steps.filter(x => x.id.startsWith('client:') && x.body.publicClient === false)) {
    const list = await fetch(`${kcUrl}/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(s.body.clientId)}`, { headers: auth }).then(x => x.json());
    const id = list && list[0] && list[0].id;
    if (!id) { results.push({ id: 'secret:' + s.body.clientId, state: 'fail', reason: 'клиент не найден после заведения' }); continue; }
    const sec = await fetch(`${kcUrl}/admin/realms/${encodeURIComponent(realm)}/clients/${id}/client-secret`, { headers: auth }).then(x => x.json());
    secrets[s.body.clientId] = sec.value;
  }
  const file = Object.keys(secrets).length ? writeSecrets(secrets) : null;
  if (file) results.push({ id: 'secrets', state: 'created', reason: 'секреты клиентов MCP записаны в ' + file + ' (права 600); на экран не выводятся' });
  return { results, file };
}

/** Разбор ответа Keycloak на шаг плана. */
export function stepVerdict(r) {
  if (!r || r.error) return { state: 'unchecked', reason: 'Keycloak не ответил: ' + (r && r.error || 'нет ответа') };
  if (r.status === 201 || r.status === 204) return { state: 'created', reason: 'заведено' };
  if (r.status === 409) return { state: 'exists', reason: 'уже есть — не трогаю' };
  if (r.status === 401) return { state: 'fail', reason: 'вход администратора Keycloak не принят — проверьте логин и пароль администратора' };
  if (r.status === 403) return { state: 'fail', reason: 'у учётки нет прав администратора области master' };
  let msg = '';
  try { const j = JSON.parse(r.body || ''); msg = j.errorMessage || j.error_description || j.error || ''; } catch { msg = String(r.body || '').slice(0, 200); }
  return { state: 'fail', reason: 'Keycloak ответил ' + r.status + (msg ? ': ' + msg : '') };
}
