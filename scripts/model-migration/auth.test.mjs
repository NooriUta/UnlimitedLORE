// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — шаг 0 установщика: вход через Keycloak и проверка владельца.
// Слова владелицы 16.11.2026: «в установщике в начале дать указать kc сервер и проверить что логин того кто
// и lore владеет»; способ проверки — «оба» (роль в токене и роль владельца в базе); «делай».
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pkce, authUrl, tokenClaims, verdict, kcConfig } from './auth.mjs';

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = claims => `${b64u({ alg: 'RS256' })}.${b64u(claims)}.sig`;

test('PKCE: проверочный код и его хэш S256', () => {
  const p = pkce();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(p.challenge, crypto.createHash('sha256').update(p.verifier).digest('base64url'));
});

test('адрес входа: область, клиент, возврат на 127.0.0.1, код + PKCE, состояние', () => {
  const u = new URL(authUrl({ url: 'https://kc.example/kc/', realm: 'omilore', client: 'lore-migrate' }, 'http://127.0.0.1:2511/auth/callback', 'st8', 'chal'));
  assert.equal(u.origin + u.pathname, 'https://kc.example/kc/realms/omilore/protocol/openid-connect/auth');
  assert.equal(u.searchParams.get('client_id'), 'lore-migrate');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), 'chal');
  assert.equal(u.searchParams.get('state'), 'st8');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:2511/auth/callback');
});

test('из токена — логин, sub и роли области', () => {
  const c = tokenClaims(jwt({ sub: 's-1', preferred_username: 'omiloreadmin', realm_access: { roles: ['superadmin', 'x'] } }));
  assert.deepEqual(c, { sub: 's-1', login: 'omiloreadmin', roles: ['superadmin', 'x'] });
  assert.throws(() => tokenClaims('не.токен'), /токен/);
});

test('пускает, только если сошлись обе проверки; несошедшаяся названа', () => {
  const me = { sub: 's-1', login: 'omiloreadmin', roles: ['superadmin'] };
  assert.deepEqual(verdict(me, 'superadmin', true, 'NooriUta/UnlimitedLORE'), { ok: true, reasons: [] });
  const noRole = verdict({ ...me, roles: [] }, 'superadmin', true, 'P');
  assert.equal(noRole.ok, false);
  assert.match(noRole.reasons.join(' '), /Keycloak.*superadmin/);
  const notOwner = verdict(me, 'superadmin', false, 'NooriUta/UnlimitedLORE');
  assert.equal(notOwner.ok, false);
  assert.match(notOwner.reasons.join(' '), /базе.*владел.*NooriUta\/UnlimitedLORE/);
  assert.equal(verdict({ ...me, roles: [] }, 'superadmin', false, 'P').reasons.length, 2);
  const unknown = verdict(me, 'superadmin', null, 'P');
  assert.equal(unknown.ok, false, '«не смогли проверить» — не «владелец»');
  assert.match(unknown.reasons.join(' '), /не проверена/);
});

test('настройки входа из файла доступа: без адреса Keycloak вход не настроен — так и сказано', () => {
  assert.equal(kcConfig({}).configured, false);
  const c = kcConfig({ MIG_KC_URL: 'https://kc/kc', MIG_KC_REALM: 'omilore', MIG_KC_CLIENT: 'lore-migrate', MIG_OWNER_PROJECT: 'NooriUta/UnlimitedLORE' });
  assert.equal(c.configured, true);
  assert.equal(c.role, 'superadmin', 'роль владельца по умолчанию — как в LORE (BYPASS_REALM_ROLES)');
  assert.equal(kcConfig({ MIG_KC_URL: 'u', MIG_KC_REALM: 'r', MIG_KC_CLIENT: 'c' }).configured, false, 'без проекта-владельца проверку по базе не сделать');
});
