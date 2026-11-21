// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Новая установка: область и клиенты Keycloak — план запросов к admin API.
// Слово владелицы 17.11.2026 «ты реинсталлишь»: на НОВОЙ установке область, клиенты и роли заводит установщик. Общий
// Keycloak нашей инфраструктуры этим не трогается — для него действует правило «меняет только человек».
// Роли — как читает бэкенд LORE: realm-роли superadmin / admin / viewer в claim seer_roles (SeerRoleFromTokenFilter).
//
// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.1, решения владелицы 21.11.2026): учётки MCP — по ролям из модели
// (shared/model/lore-model.json, раздел agent_profiles). Учётки Claude Code заводятся для всех ролей по порядку модели
// (lore-mcp-<роль>; они же держат клиентскую роль agent-<роль>), у другого harness — главная роль и младшие по выбору
// (lore-mcp-<роль>_<harness>); роль выше главной harness не заводится. Каждая учётка — как у LoreKcAgentClient
// (PL-MCP-CLIENT-MAPPERS): оба маппера (seer_roles и agent_scope), клиентская роль agent-<роль>, realm-роль admin у
// сервисной учётки. Без agent_scope учётка только читает, на запись — 403.
// «Свои уже есть» (слово владелицы 21.11 «везде KC секреты спрашивай»): своя область, свои имена клиентов и свои
// секреты — тогда LORE ничего не заводит, а только проверяет токен по их паре (checkOwnClients).
import loreModel from '../../shared/model/lore-model.json' with { type: 'json' };

const REALM = /^[a-z][a-z0-9_-]{1,40}$/;
const HARNESS = /^[a-z][a-z0-9-]{0,31}$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SEER_ROLES = ['superadmin', 'admin', 'viewer'];
/** Realm-роль сервисной учётки главной full; остальным хватает agent-<роль> и default-roles-<область> (KC даёт сам). */
export const AGENT_REALM_ROLE = 'admin';
/** У кого из ролей сервисная учётка несёт realm-роль admin: только full (ранбук, сверено в админке 21.11). */
export const FULL_ONLY_ADMIN = 'full';

const AP = loreModel.agent_profiles;

const seerRolesMapper = () => ({
  name: 'seer_roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper',
  config: { 'claim.name': 'seer_roles', multivalued: 'true', 'jsonType.label': 'String', 'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' },
});
const agentScopeMapper = owner => ({
  name: 'agent_scope', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-client-role-mapper',
  config: { 'usermodel.clientRoleMapping.clientId': owner, 'claim.name': 'agent_scope', multivalued: 'true', 'jsonType.label': 'String', 'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false' },
});

// ── Роли из модели ────────────────────────────────────────────────────────

/** Коды ролей по рангу модели. */
export function roleOrder(model = AP) {
  return [...model.profiles].sort((a, b) => a.rank - b.rank).map(p => p.code);
}

function ancestors(model, code) {
  const seen = new Set(), todo = [...(model.profiles.find(p => p.code === code)?.parents || [])];
  while (todo.length) { const c = todo.pop(); if (seen.has(c)) continue; seen.add(c); todo.push(...(model.profiles.find(p => p.code === c)?.parents || [])); }
  return seen;
}

/** «Роль a не выше b»: a == b или b — предок a (тот же закон, что LoreModelAgentProfiles.notAbove). */
export function notAbove(a, b, model = AP) {
  const known = c => model.profiles.some(p => p.code === c);
  return known(a) && known(b) && (a === b || ancestors(model, a).has(b));
}

/** harness установщика (claude, kimi, kimi-code …) → запись модели {key, main, suffix}; нет в модели — null. */
export function harnessOf(h, model = AP) {
  const short = String(h || '').replace(/-code$/, '');
  for (const [key, v] of Object.entries(model.harness)) if (key.replace(/-code$/, '') === short) return { key, main: v.main, suffix: v.suffix };
  return null;
}

/** Ключ секрета: LORE_MCP_CLIENT_SECRET_<РОЛЬ>[_<HARNESS>] заглавными, «-» → «_». */
export function secretKeyOf(role, suffix = '') {
  return ('LORE_MCP_CLIENT_SECRET_' + role + (suffix ? '_' + suffix : '')).toUpperCase().replace(/-/g, '_');
}

/**
 * Учётки MCP: Claude Code — все роли модели (они же владельцы ролей agent-<роль>); другой harness — главная и
 * младшие по выбору extraRoles[harness]. names — свои имена клиентов вместо умолчания (умолчание → своё).
 */
export function mcpAccounts({ harnesses = [], extraRoles = {}, names = {}, model = AP } = {}) {
  const name = id => names[id] || id;
  const out = [];
  for (const role of roleOrder(model)) out.push({ role, harness: 'claude-code', clientId: name('lore-mcp-' + role), secretKey: secretKeyOf(role) });
  for (const h of harnesses) {
    if (!HARNESS.test(h)) throw new Error('harness — код справочника (claude, kimi, qwen …): ' + h);
    const hm = harnessOf(h, model);
    if (!hm) throw new Error(`у harness «${h}» в модели нет главной роли (agent_profiles.harness) — учётки для него не заводятся`);
    if (!hm.suffix) continue; // Claude Code уже заведён целиком
    const roles = [hm.main, ...(extraRoles[h] || []).filter(r => r !== hm.main)];
    for (const role of roles) {
      if (!notAbove(role, hm.main, model)) throw new Error(`роль «${role}» выше главной роли harness «${h}» («${hm.main}») — не заводится`);
      const def = 'lore-mcp-' + role + '_' + hm.suffix;
      out.push({ role, harness: hm.key, clientId: name(def), secretKey: secretKeyOf(role, hm.suffix) });
    }
  }
  for (const a of out) a.owner = a.clientId; // роль agent-<роль> — у своего клиента (ранбук RUNBOOK-CORE-KC-INFISICAL-LOREHOST)
  for (const a of out) if (!CLIENT_ID.test(a.clientId)) throw new Error('имя клиента: латиница, цифры, «.», «_», «-»: ' + a.clientId);
  return out;
}

// ── План новой установки ─────────────────────────────────────────────────

function mcpClientBody(a) {
  return {
    clientId: a.clientId, name: 'LORE MCP — ' + a.clientId, protocol: 'openid-connect', publicClient: false,
    standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: true, implicitFlowEnabled: false,
    protocolMappers: [seerRolesMapper(), agentScopeMapper(a.owner)],
  };
}

/** Шаги прав учётки: роль agent-<роль> у владельца (один раз), realm-роль и клиентская роль сервисной учётки. */
function grantSteps(r, a, ownerRoleMade) {
  const steps = [];
  const roleName = 'agent-' + a.role;
  if (!ownerRoleMade.has(a.owner)) {
    ownerRoleMade.add(a.owner);
    steps.push({ id: 'clientrole:' + a.owner + ':' + roleName, method: 'POST', path: `/admin/realms/${r}/clients/{{client:${a.owner}}}/roles`, body: { name: roleName, description: 'Агентная роль профиля ' + a.role } });
  }
  // realm-роль admin — только у главной full (lore-mcp-full, lore-mcp-full_kimi): ранбук RUNBOOK-CORE-KC-INFISICAL-LOREHOST.
  if (a.role === FULL_ONLY_ADMIN) steps.push({ id: 'sa-realm:' + a.clientId, method: 'POST', path: `/admin/realms/${r}/users/{{sa:${a.clientId}}}/role-mappings/realm`, body: [{ $ref: 'realmRole:' + AGENT_REALM_ROLE }] });
  steps.push({ id: 'sa-client:' + a.clientId, method: 'POST', path: `/admin/realms/${r}/users/{{sa:${a.clientId}}}/role-mappings/clients/{{client:${a.owner}}}`, body: [{ $ref: 'clientRole:' + a.owner + '/' + roleName }] });
  return steps;
}

/**
 * План запросов: [{id, method, path, body, secretKey?}] — по порядку, повтор безопасен (409 «уже есть»).
 * ownRealm — область своя, не заводить; names — свои имена клиентов (lore-app и lore-mcp-*).
 */
export function realmPlan({ realm, webOrigin, harnesses = [], extraRoles = {}, names = {}, ownRealm = false }) {
  if (!REALM.test(realm || '')) throw new Error('имя области: строчные латинские буквы, цифры, «-» и «_», с буквы');
  let origin;
  try { origin = new URL(webOrigin); } catch { throw new Error('адрес веба LORE — http(s)://хост[:порт]'); }
  if (!/^https?:$/.test(origin.protocol) || (origin.pathname !== '/' && origin.pathname !== '') || origin.search) throw new Error('адрес веба LORE — только http(s)://хост[:порт], без пути');
  for (const h of harnesses) if (!HARNESS.test(h)) throw new Error('harness — код справочника (claude, kimi, qwen …): ' + h);
  const base = origin.origin;
  const r = encodeURIComponent(realm);
  const steps = [];
  if (!ownRealm) steps.push({ id: 'realm', method: 'POST', path: '/admin/realms', body: { realm, enabled: true } });
  for (const name of SEER_ROLES) steps.push({ id: 'role:' + name, method: 'POST', path: `/admin/realms/${r}/roles`, body: { name } });
  const web = names['lore-app'] || 'lore-app';
  steps.push({ id: 'client:' + web, method: 'POST', path: `/admin/realms/${r}/clients`, body: {
    clientId: web, name: 'LORE — веб', protocol: 'openid-connect', publicClient: true,
    standardFlowEnabled: true, directAccessGrantsEnabled: false, serviceAccountsEnabled: false, implicitFlowEnabled: false,
    redirectUris: [base + '/*'], webOrigins: [base], attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': '+' },
    protocolMappers: [seerRolesMapper()],
  } });
  const made = new Set();
  for (const a of mcpAccounts({ harnesses, extraRoles, names })) {
    steps.push({ id: 'client:' + a.clientId, method: 'POST', path: `/admin/realms/${r}/clients`, body: mcpClientBody(a), secretKey: a.secretKey });
    steps.push(...grantSteps(r, a, made));
  }
  return steps;
}

// ── Доводка уже установленных (только добавлять) ──────────────────────────

/**
 * Состояние учёток в области: clientId → {exists, mappers:[claim], ownRoles:[имена ролей клиента],
 * saRealm:[realm-роли сервисной учётки], saClient:{владелец:[роли]}}. call(method, path) → {status, body}.
 */
export async function readRealmState(call, realm, accounts) {
  const r = encodeURIComponent(realm), state = {};
  const j = x => { try { return JSON.parse(x.body || 'null'); } catch { return null; } };
  const ids = {};
  const idOf = async cid => {
    if (cid in ids) return ids[cid];
    const l = j(await call('GET', `/admin/realms/${r}/clients?clientId=${encodeURIComponent(cid)}`));
    return (ids[cid] = Array.isArray(l) && l[0] ? l[0] : null);
  };
  for (const a of accounts) {
    const c = await idOf(a.clientId);
    if (!c) { state[a.clientId] = { exists: false }; continue; }
    const owner = await idOf(a.owner);
    const ownRoles = j(await call('GET', `/admin/realms/${r}/clients/${c.id}/roles`)) || [];
    const sa = j(await call('GET', `/admin/realms/${r}/clients/${c.id}/service-account-user`));
    const rm = sa && sa.id ? j(await call('GET', `/admin/realms/${r}/users/${sa.id}/role-mappings`)) : null;
    const saClient = {};
    for (const [k, v] of Object.entries((rm && rm.clientMappings) || {})) saClient[k] = (v.mappings || []).map(x => x.name);
    state[a.clientId] = {
      exists: true,
      mappers: (c.protocolMappers || []).map(m => m.config && m.config['claim.name']).filter(Boolean),
      ownRoles: ownRoles.map(x => x.name),
      ownerRoles: owner && owner.id !== c.id ? (j(await call('GET', `/admin/realms/${r}/clients/${owner.id}/roles`)) || []).map(x => x.name) : ownRoles.map(x => x.name),
      saRealm: ((rm && rm.realmMappings) || []).map(x => x.name),
      saClient,
    };
  }
  return state;
}

/**
 * Доводка области: недостающие учётки — целиком, у существующих — недостающие мапперы, роль agent-<роль> у владельца,
 * роли сервисной учётки. Ничего не удаляет, секретов не перевыпускает. Всё на месте — пустой план.
 */
export function topUpPlan({ realm, accounts, state }) {
  const r = encodeURIComponent(realm), steps = [], made = new Set();
  for (const a of accounts) {
    const s = state[a.clientId];
    if (!s || !s.exists) {
      steps.push({ id: 'client:' + a.clientId, method: 'POST', path: `/admin/realms/${r}/clients`, body: mcpClientBody(a), secretKey: a.secretKey });
      const ownerState = state[a.owner];
      const ownerHasRole = ownerState && ownerState.exists && (ownerState.ownRoles || []).includes('agent-' + a.role);
      if (ownerHasRole) made.add(a.owner);
      steps.push(...grantSteps(r, a, made));
      continue;
    }
    if (!s.mappers.includes('seer_roles'))
      steps.push({ id: 'fix-mapper:' + a.clientId + ':seer_roles', method: 'POST', path: `/admin/realms/${r}/clients/{{client:${a.clientId}}}/protocol-mappers/models`, body: seerRolesMapper() });
    if (!s.mappers.includes('agent_scope'))
      steps.push({ id: 'fix-mapper:' + a.clientId + ':agent_scope', method: 'POST', path: `/admin/realms/${r}/clients/{{client:${a.clientId}}}/protocol-mappers/models`, body: agentScopeMapper(a.owner) });
    const roleName = 'agent-' + a.role;
    if (!(s.ownerRoles || []).includes(roleName) && !made.has(a.owner)) {
      made.add(a.owner);
      steps.push({ id: 'fix-clientrole:' + a.owner + ':' + roleName, method: 'POST', path: `/admin/realms/${r}/clients/{{client:${a.owner}}}/roles`, body: { name: roleName, description: 'Агентная роль профиля ' + a.role } });
    }
    if (a.role === FULL_ONLY_ADMIN && !s.saRealm.includes(AGENT_REALM_ROLE))
      steps.push({ id: 'fix-sa-realm:' + a.clientId, method: 'POST', path: `/admin/realms/${r}/users/{{sa:${a.clientId}}}/role-mappings/realm`, body: [{ $ref: 'realmRole:' + AGENT_REALM_ROLE }] });
    if (!(s.saClient[a.owner] || []).includes(roleName))
      steps.push({ id: 'fix-sa-client:' + a.clientId, method: 'POST', path: `/admin/realms/${r}/users/{{sa:${a.clientId}}}/role-mappings/clients/{{client:${a.owner}}}`, body: [{ $ref: 'clientRole:' + a.owner + '/' + roleName }] });
  }
  return steps;
}

// ── Исполнение ───────────────────────────────────────────────────────────

/** Адрес области (issuer, …/realms/<имя>) → адрес Keycloak и имя области. */
export function issuerParts(issuer) {
  const m = /^(https?:\/\/[^?#]+?)\/realms\/([^/?#]+)\/?$/.exec(String(issuer || '').trim());
  if (!m) throw new Error('адрес области Keycloak — вида https://keycloak/realms/<имя>');
  return { kcUrl: m[1], realm: decodeURIComponent(m[2]) };
}

async function adminLogin(kcUrl, adminUser, adminPassword) {
  const tok = await fetch(kcUrl + '/realms/master/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUser, password: adminPassword }), signal: AbortSignal.timeout(15000) })
    .then(async r => ({ status: r.status, body: await r.text() }), e => ({ error: e.cause?.code || e.message }));
  if (tok.error || tok.status !== 200) return { fail: { id: 'admin-login', ...stepVerdict(tok.status === 400 ? { ...tok, status: 401 } : tok) } };
  return { auth: { Authorization: 'Bearer ' + JSON.parse(tok.body).access_token, 'Content-Type': 'application/json' } };
}

/** Вызов admin API с токеном администратора: {status, body} или {error}. */
export function adminCall(kcUrl, auth) {
  return (method, path, body) => fetch(kcUrl + path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    .then(async x => ({ status: x.status, body: await x.text() }), e => ({ error: e.cause?.code || e.message }));
}

/** Подстановки плана: {{client:X}} → id клиента, {{sa:X}} → id сервисной учётки; $ref ролей → представление роли. */
async function resolve(call, realm, s) {
  const r = encodeURIComponent(realm);
  const j = x => { try { return JSON.parse(x.body || 'null'); } catch { return null; } };
  const clientId = async cid => { const l = j(await call('GET', `/admin/realms/${r}/clients?clientId=${encodeURIComponent(cid)}`)); return Array.isArray(l) && l[0] ? l[0].id : null; };
  let path = s.path;
  for (const m of [...s.path.matchAll(/\{\{(client|sa):([^}]+)\}\}/g)]) {
    const cid = await clientId(m[2]);
    if (!cid) throw new Error('клиента ' + m[2] + ' нет в области');
    let v = cid;
    if (m[1] === 'sa') { const u = j(await call('GET', `/admin/realms/${r}/clients/${cid}/service-account-user`)); if (!u || !u.id) throw new Error('у ' + m[2] + ' нет сервисной учётки'); v = u.id; }
    path = path.replace(m[0], v);
  }
  let body = s.body;
  if (Array.isArray(body) && body.some(x => x && x.$ref)) {
    body = [];
    for (const x of s.body) {
      const [kind, ref] = x.$ref.split(/:(.*)/s);
      if (kind === 'realmRole') { const role = j(await call('GET', `/admin/realms/${r}/roles/${encodeURIComponent(ref)}`)); if (!role) throw new Error('realm-роли ' + ref + ' нет'); body.push(role); }
      else { const [owner, name] = ref.split('/'); const id = await clientId(owner); const role = id && j(await call('GET', `/admin/realms/${r}/clients/${id}/roles/${encodeURIComponent(name)}`)); if (!role) throw new Error('клиентской роли ' + ref + ' нет'); body.push(role); }
    }
  }
  return { path, body };
}

/**
 * Исполнение плана: токен администратора (область master, клиент admin-cli) по логину и паролю, которые человек ввёл
 * в окне; пароль живёт только в этом вызове. Затем шаги по порядку. Секреты — только клиентов, заведённых ЭТИМ
 * прогоном (существующим не перевыпускаются и не читаются), ключами LORE_MCP_CLIENT_SECRET_<РОЛЬ>[_<HARNESS>] —
 * в writeSecrets (файл 600 или Infisical); на экран не выводятся.
 */
export async function applyRealm({ kcUrl, adminUser, adminPassword, steps, writeSecrets, realm }) {
  const login = await adminLogin(kcUrl, adminUser, adminPassword);
  if (login.fail) return { results: [login.fail] };
  const call = adminCall(kcUrl, login.auth);
  const realmName = realm || (steps.find(x => x.id === 'realm')?.body.realm) || /\/admin\/realms\/([^/]+)\//.exec(steps[0]?.path || '')?.[1];
  const results = [], created = [];
  for (const s of steps) {
    let v;
    try {
      const { path, body } = await resolve(call, decodeURIComponent(realmName), s);
      v = stepVerdict(await call(s.method, path, body));
    } catch (e) { v = { state: 'fail', reason: e.message }; }
    results.push({ id: s.id, ...v });
    if (v.state === 'fail' || v.state === 'unchecked') return { results };
    if (v.state === 'created' && s.secretKey) created.push(s);
  }
  const r = encodeURIComponent(decodeURIComponent(realmName)), secrets = {};
  for (const s of created) {
    const list = await fetch(`${kcUrl}/admin/realms/${r}/clients?clientId=${encodeURIComponent(s.body.clientId)}`, { headers: login.auth }).then(x => x.json());
    const id = list && list[0] && list[0].id;
    if (!id) { results.push({ id: 'secret:' + s.body.clientId, state: 'fail', reason: 'клиент не найден после заведения' }); continue; }
    const sec = await fetch(`${kcUrl}/admin/realms/${r}/clients/${id}/client-secret`, { headers: login.auth }).then(x => x.json());
    secrets[s.secretKey] = sec.value;
  }
  let file = null;
  if (Object.keys(secrets).length) {
    try { file = await writeSecrets(secrets); results.push({ id: 'secrets', state: 'created', reason: 'секреты клиентов MCP записаны: ' + file + '; на экран не выводятся' }); }
    catch (e) { results.push({ id: 'secrets', state: 'fail', reason: 'секреты не записаны: ' + e.message }); }
  }
  return { results, file };
}

/** Доводка установленной области: прочитать состояние, построить план доводки; apply — выполнить. */
export async function topUpRealm({ kcUrl, adminUser, adminPassword, realm, accounts, apply, writeSecrets }) {
  const login = await adminLogin(kcUrl, adminUser, adminPassword);
  if (login.fail) return { results: [login.fail] };
  const state = await readRealmState(adminCall(kcUrl, login.auth), realm, accounts);
  const steps = topUpPlan({ realm, accounts, state });
  if (!apply) return { plan: steps.map(x => ({ id: x.id, method: x.method, path: x.path })) };
  return applyRealm({ kcUrl, adminUser, adminPassword, steps, writeSecrets, realm });
}

/**
 * «Свои клиенты и секреты уже есть»: LORE ничего не заводит и секретов не пишет — только берёт токен по паре
 * clientId/секрет из переменной secretVar (их окружение или хранилище) и смотрит agent_scope и seer_roles.
 * Ни одного запроса к admin API. Возвращает [{clientId, role, secretVar, state, reason}].
 */
export async function checkOwnClients({ issuer, accounts, env = process.env, fetchImpl = fetch }) {
  const out = [];
  for (const a of accounts) {
    const row = { clientId: a.clientId, role: a.role, secretVar: a.secretVar || a.secretKey };
    const secret = env[row.secretVar];
    if (!secret) { out.push({ ...row, state: 'unchecked', reason: 'переменной ' + row.secretVar + ' нет в окружении — проверить не смогли' }); continue; }
    let r;
    try {
      const x = await fetchImpl(String(issuer).replace(/\/$/, '') + '/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: a.clientId, client_secret: secret }), signal: AbortSignal.timeout(15000) });
      r = { status: x.status, body: await x.text() };
    } catch (e) { out.push({ ...row, state: 'unchecked', reason: 'Keycloak не ответил: ' + (e.cause?.code || e.message) }); continue; }
    if (r.status !== 200) { out.push({ ...row, state: 'fail', reason: 'токен не выдан: Keycloak ответил ' + r.status }); continue; }
    out.push({ ...row, ...tokenCheck(JSON.parse(r.body).access_token, a.role) });
  }
  return out;
}

/** Что в токене: agent_scope = ожидаемая роль и есть seer_roles (как LoreKcAgentClient.tokenCheck). Сам токен не возвращается. */
export function tokenCheck(jwt, role) {
  let claims;
  try { claims = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')); } catch { return { state: 'fail', reason: 'токен не разобран' }; }
  const raw = claims.agent_scope, vals = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(v => String(v).replace(/"/g, '').trim().replace(/^agent-/, '')).filter(Boolean);
  const scope = [...new Set(vals)];
  if (!scope.length) return { state: 'fail', reason: 'в токене нет agent_scope — учётка только читает (нужны маппер agent_scope и роль agent-' + role + ')' };
  if (scope.length !== 1 || scope[0] !== role) return { state: 'fail', reason: 'agent_scope ' + scope.join(',') + ', ждали ' + role };
  const roles = claims.seer_roles;
  if (!(Array.isArray(roles) ? roles.length : roles)) return { state: 'fail', reason: 'в токене нет seer_roles — запись получит 403 (нужен маппер seer_roles и realm-роль сервисной учётки)' };
  return { state: 'ok', reason: 'токен выдан, agent_scope ' + role + ', seer_roles есть' };
}

const KC_MODES = ['ask', 'new', 'own-realm', 'topup', 'own'];
const pairs = s => Object.fromEntries(String(s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
  const i = x.indexOf('=');
  if (i < 1) throw new Error('ожидалось «имя=значение»: ' + x);
  return [x.slice(0, i).trim(), x.slice(i + 1).trim()];
}));

/**
 * Поля окна установщика → выбор по Keycloak: mode (что уже есть; по умолчанию — спросить), свои имена клиентов,
 * младшие роли harness, свои переменные секретов (роль=ПЕРЕМЕННАЯ), и учётки по этим выборам.
 */
export function kcForm(b) {
  const mode = b.kcMode || 'ask';
  if (!KC_MODES.includes(mode)) throw new Error('режим Keycloak: ' + KC_MODES.join(' | '));
  const harnesses = b.harness ? [b.harness] : [];
  const extra = String(b.kcExtra || '').split(',').map(x => x.trim()).filter(Boolean);
  const extraRoles = b.harness && extra.length ? { [b.harness]: extra } : {};
  const names = pairs(b.kcNames), secretVars = pairs(b.kcSecretVars);
  for (const v of Object.values(secretVars)) if (!/^[A-Z][A-Z0-9_]*$/.test(v)) throw new Error('имя переменной секрета — заглавные латинские буквы, цифры, «_»: ' + v);
  return { mode, harnesses, extraRoles, names, secretVars, accounts: mcpAccounts({ harnesses, extraRoles, names }) };
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
