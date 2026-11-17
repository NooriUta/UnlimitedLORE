// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Универсальный установщик: первый экран и подключение агента.
// Слова владелицы 17.11.2026: «на первом экране выбор что ставить: лор, лор и минилор, и есть ли kc и секреты — их
// предложить скачать, если используются, и инструкция по настройке»; «ты реинсталлишь»; «доделывай установщик и туда
// же volva»; ранее 16–17.11: «просить каждый mcp писать harness … константой», «и машину», «запиши сразу к себе Claude».
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, planSetup, clientIdFor, mcpEntry, applyMcpEntry, checkChoice } from './setup.mjs';

test('компоненты: LORE обязателен, miniLORE и Völva — по выбору', () => {
  assert.deepEqual(COMPONENTS.map(c => c.id), ['lore', 'minilore', 'volva']);
  assert.equal(COMPONENTS.find(c => c.id === 'lore').required, true);
  assert.deepEqual(checkChoice({ components: ['minilore'], kc: 'own', secrets: 'own', mode: 'new' }), ['без LORE ставить нечего: LORE входит всегда']);
  assert.deepEqual(checkChoice({ components: ['lore'], kc: 'maybe', secrets: 'own', mode: 'new' }), ['Keycloak: own или none']);
  assert.deepEqual(checkChoice({ components: ['lore', 'volva'], kc: 'own', secrets: 'none', mode: 'migrate' }), []);
});

test('план: нет своего Keycloak и секретов — шаги «скачать» с официальными ссылками и инструкцией идут первыми', () => {
  const p = planSetup({ components: ['lore'], kc: 'none', secrets: 'none', mode: 'new' });
  const ids = p.map(s => s.id);
  assert.deepEqual(ids.slice(0, 2), ['get-keycloak', 'get-secrets']);
  for (const s of p.slice(0, 2)) {
    assert.ok(s.links.length > 0 && s.links.every(l => /^https:\/\//.test(l.url)), s.id + ': официальная ссылка');
    assert.ok(s.howto.length >= 3, s.id + ': инструкция по шагам');
  }
  assert.ok(ids.includes('kc-realm-clients'), 'на новой установке установщик сам заводит область и клиенты');
  assert.ok(ids.includes('install-lore'), 'ставит LORE');
});

test('план: свой Keycloak — не скачиваем, но область и клиенты на новой установке заводятся', () => {
  const ids = planSetup({ components: ['lore'], kc: 'own', secrets: 'own', mode: 'new' }).map(s => s.id);
  assert.ok(!ids.includes('get-keycloak') && !ids.includes('get-secrets'));
  assert.ok(ids.includes('kc-realm-clients'));
});

test('план переноса: вместо установки — шаги переноса 0–5, область не заводится (она уже есть)', () => {
  const ids = planSetup({ components: ['lore'], kc: 'own', secrets: 'own', mode: 'migrate' }).map(s => s.id);
  assert.ok(ids.includes('migrate') && !ids.includes('install-lore') && !ids.includes('kc-realm-clients'));
});

test('miniLORE и Völva добавляют свои шаги; у Völva — настройка встройки ключами ES256', () => {
  const p = planSetup({ components: ['lore', 'minilore', 'volva'], kc: 'own', secrets: 'own', mode: 'new' });
  const v = p.find(s => s.id === 'volva-embed');
  assert.ok(p.find(s => s.id === 'minilore'));
  assert.ok(v);
  for (const k of ['LORE_VOLVA_EMBED_SITE_URL', 'LORE_VOLVA_EMBED_ISSUER', 'LORE_VOLVA_EMBED_ES256_PRIVATE_KEY', 'LORE_VOLVA_EMBED_ES256_PUBLIC_KEY'])
    assert.ok(v.env.includes(k), 'Völva: ' + k);
});

test('клиент Keycloak по harness: Claude Code — lore-mcp-full, остальные — lore-mcp-full_<harness без -code>', () => {
  assert.equal(clientIdFor('claude-code'), 'lore-mcp-full');
  assert.equal(clientIdFor('kimi-code'), 'lore-mcp-full_kimi');
  assert.equal(clientIdFor('dsh'), 'lore-mcp-full_dsh');
});

test('строка MCP: константы harness и машины, клиент по harness; секрет — не значение, а пометка «из хранилища»', () => {
  const e = mcpEntry({ harness: 'claude-code', machineId: 'lorcetus', backendUrl: 'http://lore:9100', issuer: 'https://kc/realms/omilore', serverPath: 'C:/AIDA/UnlimitedLORE-mcp/mcp-server/dist/index.js' });
  assert.equal(e.env.LORE_HARNESS, 'claude-code');
  assert.equal(e.env.LORE_MACHINE_ID, 'lorcetus');
  assert.equal(e.env.LORE_MCP_CLIENT_ID, 'lore-mcp-full');
  assert.equal(e.env.LORE_MCP_CLIENT_SECRET, undefined, 'секрет в строку не кладётся');
  assert.throws(() => mcpEntry({ harness: '', machineId: 'x' }), /harness/);
  assert.throws(() => mcpEntry({ harness: 'claude-code', machineId: '' }), /машин/);
});

test('запись в настройки Claude: только сервер aida-lore, прежний секрет сохраняется, остальное нетронуто', () => {
  const before = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' }, 'aida-lore': { command: 'node', args: ['old.js'], env: { LORE_MCP_CLIENT_SECRET: 'S3', LORE_SEER_ROLE: 'full' } } } }, null, 2);
  const e = mcpEntry({ harness: 'claude-code', machineId: 'lorcetus', backendUrl: 'http://b', issuer: 'https://i', serverPath: 'new.js' });
  const after = JSON.parse(applyMcpEntry(before, e));
  assert.equal(after.theme, 'dark');
  assert.deepEqual(after.mcpServers.other, { command: 'x' });
  const a = after.mcpServers['aida-lore'];
  assert.equal(a.env.LORE_MCP_CLIENT_SECRET, 'S3', 'секрет не потерян');
  assert.equal(a.env.LORE_SEER_ROLE, 'full', 'прежние переменные сохраняются');
  assert.equal(a.env.LORE_HARNESS, 'claude-code');
  assert.deepEqual(a.args, ['new.js']);
  assert.throws(() => applyMcpEntry('{не json', e), /не JSON/);
});

test('miniLORE (её ответ 17.11): разовая настройка области и регистрация машины — клиент link, machine_new, секция [auth]', async () => {
  const { linkAuthToml } = await import('./setup.mjs');
  const p = planSetup({ components: ['lore', 'minilore'], kc: 'own', secrets: 'own', mode: 'new' });
  const realm = p.find(s => s.id === 'minilore-realm'), reg = p.find(s => s.id === 'minilore-machine');
  assert.ok(realm && reg, 'два шага miniLORE');
  const txt = realm.howto.join(' ');
  for (const k of ['minilore-srv', 'mobilepoc-app', 'lore-backend-minilore-reader', 'lore-reader-minilore', 'seer_roles']) assert.ok(txt.includes(k), 'область: ' + k);
  const r = reg.howto.join(' ');
  for (const k of ['minilore-link-', 'machine_new', 'config.toml']) assert.ok(r.includes(k), 'регистрация: ' + k);
  const t = linkAuthToml({ issuer: 'https://kc/realms/omilore', machineId: 'lorcetus', secret: 'S' });
  assert.match(t, /^\[auth\]\nissuer = "https:\/\/kc\/realms\/omilore"\nclient_id = "minilore-link-lorcetus"\nclient_secret = "S"\n$/);
  assert.throws(() => linkAuthToml({ issuer: 'x', machineId: '' }), /машин/);
});

test('фрагмент для link: [server], [machine] и [auth] — код машины совпадает с machine_new (ответ miniLORE 17.11)', async () => {
  const { linkConfigToml } = await import('./setup.mjs');
  const t = linkConfigToml({ serverUrl: 'https://minilore2.example', issuer: 'https://kc/realms/omilore', machineId: 'lorcetus', secret: 'S' });
  assert.equal(t, '[server]\nurl = "https://minilore2.example"\n\n[machine]\nid = "lorcetus"\n\n[auth]\nissuer = "https://kc/realms/omilore"\nclient_id = "minilore-link-lorcetus"\nclient_secret = "S"\n');
  assert.throws(() => linkConfigToml({ serverUrl: '', issuer: 'x', machineId: 'm', secret: 's' }), /адрес сервера/);
});
