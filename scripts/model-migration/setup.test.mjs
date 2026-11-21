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
  assert.equal(clientIdFor('claude'), 'lore-mcp-full', 'код miniLORE');
  assert.equal(clientIdFor('claude-code'), 'lore-mcp-full');
  assert.equal(clientIdFor('kimi'), 'lore-mcp-full_kimi');
  assert.equal(clientIdFor('kimi-code'), 'lore-mcp-full_kimi');
  assert.equal(clientIdFor('dsh'), 'lore-mcp-full_dsh');
});

test('строка MCP: константы harness и машины, клиент по harness; секрет — не значение, а пометка «из хранилища»', () => {
  const e = mcpEntry({ harness: 'claude-code', machineId: 'lorcetus', backendUrl: 'http://lore:9100', issuer: 'https://kc/realms/omilore', serverPath: 'C:/AIDA/UnlimitedLORE-mcp/mcp-server/dist/index.js' });
  assert.equal(e.env.LORE_HARNESS, 'claude-code');
  assert.equal(e.env.LORE_MACHINE_ID, 'lorcetus');
  assert.equal(e.env.LORE_MCP_CLIENT_ID, 'lore-mcp-full');
  assert.equal(e.env.LORE_MCP_CLIENT_SECRET, undefined, 'секрет в строку не кладётся');
  assert.equal(e.env.LORE_MCP_SECRET_VAR, 'LORE_MCP_CLIENT_SECRET_FULL', 'имя ключа секрета по роли и harness (OH-MCP-HOSTED-SWITCH)');
  assert.equal(mcpEntry({ harness: 'kimi', machineId: 'm', backendUrl: 'b', issuer: 'i', serverPath: 's' }).env.LORE_MCP_SECRET_VAR, 'LORE_MCP_CLIENT_SECRET_FULL_KIMI');
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

test('Völva: пара ES256 одной строкой base64 (PKCS#8 и SPKI, как читает VolvaEmbedEs256), подпись сходится', async () => {
  const { volvaKeys } = await import('./setup.mjs');
  const crypto = await import('node:crypto');
  const k = volvaKeys();
  assert.match(k.LORE_VOLVA_EMBED_ES256_PRIVATE_KEY, /^[A-Za-z0-9+/]+=*$/, 'одна строка base64, без PEM-рамок и переводов строк');
  assert.match(k.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY, /^[A-Za-z0-9+/]+=*$/);
  const priv = crypto.createPrivateKey({ key: Buffer.from(k.LORE_VOLVA_EMBED_ES256_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey({ key: Buffer.from(k.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
  assert.equal(pub.asymmetricKeyDetails.namedCurve, 'prime256v1', 'кривая P-256 (ES256)');
  const sig = crypto.sign('sha256', Buffer.from('встройка'), priv);
  assert.ok(crypto.verify('sha256', Buffer.from('встройка'), pub, sig), 'открытый ключ — пара закрытому');
  assert.notEqual(volvaKeys().LORE_VOLVA_EMBED_ES256_PRIVATE_KEY, k.LORE_VOLVA_EMBED_ES256_PRIVATE_KEY, 'каждый раз новая пара');
});

test('команда установки: каталог абсолютный, версия — тег vX.Y.Z или пусто, порт 1–65535; план — с --dry-run', async () => {
  const { installArgs } = await import('./setup.mjs');
  assert.deepEqual(installArgs({ dir: '/opt/lore', version: 'v1.18.0', port: '4400', dry: true }), ['--dir', '/opt/lore', '--version', 'v1.18.0', '--port', '4400', '--dry-run']);
  assert.deepEqual(installArgs({ dir: '/opt/lore', version: '', port: '', dry: false }), ['--dir', '/opt/lore']);
  assert.throws(() => installArgs({ dir: 'opt/lore' }), /абсолютный/);
  assert.throws(() => installArgs({ dir: '/opt/lore; rm -rf /' }), /каталог/);
  assert.throws(() => installArgs({ dir: '/opt/lore', version: 'latest' }), /версия/);
  assert.throws(() => installArgs({ dir: '/opt/lore', port: '70000' }), /порт/);
});

test('образы: готовые или собрать из исходников пакета (--build-from-source); версия тогда берётся из архива', async () => {
  const { installArgs } = await import('./setup.mjs');
  assert.deepEqual(installArgs({ dir: '/opt/lore', fromSource: true, dry: true }), ['--dir', '/opt/lore', '--build-from-source', '--dry-run']);
  assert.throws(() => installArgs({ dir: '/opt/lore', version: 'v1.18.0', fromSource: true }), /архив/);
  assert.deepEqual(checkChoice({ components: ['lore'], kc: 'own', secrets: 'own', mode: 'new', images: 'source' }), []);
  assert.deepEqual(checkChoice({ components: ['lore'], kc: 'own', secrets: 'own', mode: 'new', images: 'maybe' }), ['образы: ready (готовые) или source (собрать из исходников пакета)']);
  const step = planSetup({ components: ['lore'], kc: 'own', secrets: 'own', mode: 'new', images: 'source' }).find(s => s.id === 'install-lore');
  assert.ok(step.howto.some(h => /src\/lore-/.test(h) && /--build-from-source/.test(h)), 'план называет архив исходников и флаг');
});

test('встройка Völva: издатель — origin веба LORE своей среды, у Völva — тот же издатель и адрес JWKS (EMB-L6)', async () => {
  const { volvaEmbedEnv } = await import('./setup.mjs');
  const v = volvaEmbedEnv({ web: 'https://lore.example.org/', volva: 'https://volva.example.org/embed' });
  assert.deepEqual(v.lore, { LORE_VOLVA_ORIGIN: 'https://volva.example.org', LORE_VOLVA_EMBED_SITE_URL: 'https://volva.example.org/embed', LORE_VOLVA_EMBED_ISSUER: 'https://lore.example.org' });
  assert.deepEqual(v.volva, { MB_EMBEDDING_JWT_ISSUERS: 'https://lore.example.org', jwks: 'https://lore.example.org/lore/embed/jwks' });
  assert.throws(() => volvaEmbedEnv({ web: '', volva: 'https://v' }), /веба LORE/);
});
