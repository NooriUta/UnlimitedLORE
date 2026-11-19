// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Проверки связи установщика: ключ Völva в /lore/embed/jwks и ответ /lore/whoami.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { volvaKeys } from './setup.mjs';
import { jwksVerdict, whoamiVerdict } from './setup-check.mjs';

function jwkOf(spkiB64) {
  const j = crypto.createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' }).export({ format: 'jwk' });
  return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid: 'k1', alg: 'ES256', use: 'sig' };
}

test('jwks: ключ установки найден — ok', () => {
  const k = volvaKeys();
  const v = jwksVerdict({ status: 200, body: JSON.stringify({ keys: [jwkOf(k.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY)] }) }, k.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY);
  assert.equal(v.state, 'ok');
});

test('jwks: пустой список — LORE не знает ключа, а не «всё хорошо»', () => {
  const v = jwksVerdict({ status: 200, body: '{"keys":[]}' }, volvaKeys().LORE_VOLVA_EMBED_ES256_PUBLIC_KEY);
  assert.equal(v.state, 'fail');
  assert.match(v.reason, /LORE_VOLVA_EMBED_ES256/);
});

test('jwks: чужой ключ — не совпадает с ключом установки', () => {
  const a = volvaKeys(), b = volvaKeys();
  const v = jwksVerdict({ status: 200, body: JSON.stringify({ keys: [jwkOf(a.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY)] }) }, b.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY);
  assert.equal(v.state, 'fail');
  assert.match(v.reason, /другой ключ/);
});

test('jwks: недоступен — «не смогли проверить», не «пусто»', () => {
  assert.equal(jwksVerdict({ error: 'ECONNREFUSED' }).state, 'unchecked');
  assert.equal(jwksVerdict({ status: 502, body: 'bad gateway' }).state, 'unchecked');
});

test('whoami: агент опознан и машина совпала — ok', () => {
  const v = whoamiVerdict({ status: 200, body: JSON.stringify({ auth_enabled: true, kind: 'agent', client_id: 'lore-mcp-full', identity: { state: 'known' }, machine: 'lorcetus' }) }, { machineId: 'LorCetus' });
  assert.equal(v.state, 'ok');
});

test('whoami: личность неизвестна графу — fail с причиной сервера', () => {
  const v = whoamiVerdict({ status: 200, body: JSON.stringify({ auth_enabled: true, kind: 'agent', identity: { state: 'unknown', reason: 'клиент не заявлен' } }) }, {});
  assert.equal(v.state, 'fail');
  assert.match(v.reason, /клиент не заявлен/);
});

test('whoami: вход выключен — предупреждение, роль не проверяется', () => {
  const v = whoamiVerdict({ status: 200, body: JSON.stringify({ auth_enabled: false, kind: 'unverified' }) }, {});
  assert.equal(v.state, 'warn');
});

test('whoami: 401 без токена — LORE жив, вход включён; проверка агента — после подключения', () => {
  const v = whoamiVerdict({ status: 401, body: '' }, {});
  assert.equal(v.state, 'warn');
  assert.match(v.reason, /вход включён/);
});

test('whoami: машина в ответе другая — fail', () => {
  const v = whoamiVerdict({ status: 200, body: JSON.stringify({ auth_enabled: true, kind: 'agent', identity: { state: 'known' }, machine: 'legion' }) }, { machineId: 'lorcetus' });
  assert.equal(v.state, 'fail');
  assert.match(v.reason, /legion/);
});
