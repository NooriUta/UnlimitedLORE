// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Шаг 0 установщика: вход через Keycloak и проверка владельца.
// Слова владелицы 16.11.2026: «в установщике в начале дать указать kc сервер и проверить что логин того кто
// и lore владеет»; способ — «оба»: (1) в токене Keycloak есть роль владельца, (2) в базе-источнике у этой
// учётки (KnowUser.kc_sub = sub) роль owner на проекте этой установки. Пускает, только если сошлись обе.
// Вход — authorization code + PKCE, публичный клиент: секретов у установщика нет. Токен приходит прямо
// от Keycloak по TLS на обмен кодом, поэтому его полезная нагрузка читается без отдельной проверки подписи.
import crypto from 'node:crypto';

/** Настройки входа из файла доступа. Без адреса, области, клиента или проекта-владельца вход не настроен. */
export function kcConfig(env) {
  const c = {
    url: (env.MIG_KC_URL || '').trim(), realm: (env.MIG_KC_REALM || '').trim(), client: (env.MIG_KC_CLIENT || '').trim(),
    project: (env.MIG_OWNER_PROJECT || '').trim(), role: (env.MIG_OWNER_ROLE || 'superadmin').trim(),
  };
  c.configured = Boolean(c.url && c.realm && c.client && c.project);
  return c;
}

export function pkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

const oidc = (kc, tail) => `${kc.url.replace(/\/+$/, '')}/realms/${encodeURIComponent(kc.realm)}/protocol/openid-connect/${tail}`;

export function authUrl(kc, redirect, state, challenge) {
  const u = new URL(oidc(kc, 'auth'));
  u.search = new URLSearchParams({ client_id: kc.client, response_type: 'code', scope: 'openid', redirect_uri: redirect,
    state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return u.toString();
}

/** Обмен кода на токен у Keycloak. Тело ответа в ошибку не идёт: в нём может быть эхо запроса. */
export async function exchange(kc, code, redirect, verifier) {
  const res = await fetch(oidc(kc, 'token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: kc.client, code, redirect_uri: redirect, code_verifier: verifier }),
    signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Keycloak не выдал токен: ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

export function tokenClaims(token) {
  const part = String(token).split('.')[1];
  let p;
  try { p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw new Error('ответ Keycloak — не токен'); }
  if (!p || typeof p !== 'object' || !p.sub) throw new Error('ответ Keycloak — не токен');
  return { sub: p.sub, login: p.preferred_username || p.sub, roles: (p.realm_access && p.realm_access.roles) || [] };
}

/** Владелец ли учётка проекта этой установки — по базе-источнику (только чтение). */
export async function ownerInDb(db, sub, project) {
  const rows = await db.src('SELECT count(*) AS n FROM HAS_PROJECT_ROLE WHERE role = :role AND @out.kc_sub = :sub AND @in.slug = :project',
    { role: 'owner', sub, project });
  return (rows[0] && rows[0].n) > 0;
}

/** Итог шага 0. dbOwner: true / false / null («не смогли проверить» — не «владелец»). */
export function verdict(me, role, dbOwner, project) {
  const reasons = [];
  if (!me.roles.includes(role)) reasons.push(`в токене Keycloak нет роли владельца «${role}» у ${me.login}`);
  if (dbOwner === null) reasons.push(`роль владельца в базе не проверена: база не ответила`);
  else if (!dbOwner) reasons.push(`в базе установки у ${me.login} нет роли владельца проекта ${project}`);
  return { ok: reasons.length === 0, reasons };
}
