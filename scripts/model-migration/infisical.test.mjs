// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.1) · секреты учёток MCP — в Infisical по выбору (заглушка HTTP).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { infisicalConfig, upsertSecrets } from './infisical.mjs';

test('не настроено — null: установщик пишет секреты в файл 600, а не молча никуда', () => {
  assert.equal(infisicalConfig({}), null);
  assert.equal(infisicalConfig({ LORE_MCP_SECRETS_INFISICAL_URL: 'https://s' }), null);
  const c = infisicalConfig({ LORE_MCP_SECRETS_INFISICAL_URL: 'https://s', LORE_MCP_SECRETS_INFISICAL_PROJECT_ID: 'p', LORE_MCP_SECRETS_INFISICAL_CLIENT_ID: 'i', LORE_MCP_SECRETS_INFISICAL_CLIENT_SECRET: 'x' });
  assert.equal(c.environment, 'prod');
  assert.equal(c.path, '/');
});

test('universal-auth → PATCH; нет секрета (404) → POST; значения в ответ не попадают', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    seen.push(init.method + ' ' + u.pathname + (init.headers.Authorization ? ' [auth]' : ''));
    if (u.pathname === '/api/v1/auth/universal-auth/login') return { status: 200, text: async () => JSON.stringify({ accessToken: 'tok' }) };
    const b = JSON.parse(init.body);
    assert.deepEqual(Object.keys(b).sort(), ['environment', 'projectId', 'secretPath', 'secretValue']);
    if (init.method === 'PATCH' && u.pathname.endsWith('/LORE_MCP_CLIENT_SECRET_TESTER')) return { status: 404, text: async () => '' };
    return { status: 200, text: async () => '{}' };
  };
  const cfg = { url: 'https://secrets.example', projectId: 'p1', environment: 'prod', path: '/', clientId: 'id', clientSecret: 's' };
  const out = await upsertSecrets(cfg, { LORE_MCP_CLIENT_SECRET_FULL: 'v1', LORE_MCP_CLIENT_SECRET_TESTER: 'v2' }, fetchImpl);
  assert.deepEqual(out.map(r => r.state), ['written', 'written']);
  assert.deepEqual(seen, [
    'POST /api/v1/auth/universal-auth/login',
    'PATCH /api/v4/secrets/LORE_MCP_CLIENT_SECRET_FULL [auth]',
    'PATCH /api/v4/secrets/LORE_MCP_CLIENT_SECRET_TESTER [auth]',
    'POST /api/v4/secrets/LORE_MCP_CLIENT_SECRET_TESTER [auth]',
  ]);
  assert.ok(!JSON.stringify(out).includes('v1') && !JSON.stringify(out).includes('v2'));
});

test('вход не принят / нет ответа — каждый ключ «failed» со словами', async () => {
  const cfg = { url: 'https://s', projectId: 'p', environment: 'prod', path: '/', clientId: 'i', clientSecret: 'x' };
  const out = await upsertSecrets(cfg, { K: 'v' }, async () => ({ status: 401, text: async () => '' }));
  assert.equal(out[0].state, 'failed');
  assert.match(out[0].reason, /вход/);
  const down = await upsertSecrets(cfg, { K: 'v' }, async () => { throw new Error('ECONNREFUSED'); });
  assert.match(down[0].reason, /не ответил/);
});
