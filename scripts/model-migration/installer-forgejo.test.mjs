// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Forgejo и forgejo-mcp в универсальном установщике.
// Слова владелицы 20.11.2026: «и в инсталяторе проверь что бы был включен установка Forgejo если нет на шей версии и
// дистрибутив MCP forgejo или указаны настройки если у владельца есть»; затем: «так а инструкция какие секреты и где в
// инсталяторе прописана? (для рантайма, а не для нашей разработки)».
// Три варианта: install — поставить Forgejo нашей версии; own — свой Forgejo владельца (адрес, токен вводит он сам);
// none — без Forgejo, как было до сих пор (по умолчанию). В install и own в пакет входит forgejo-mcp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkChoice, planSetup, forgejoEnv, forgejoMcpEntry, installEnvText, FORGEJO_VERSION } from './setup.mjs';
import { INSTALL_BUNDLE } from './resources.mjs';

const DIR = new URL('../../deploy/install/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, DIR), 'utf8');
const base = { components: ['lore'], kc: 'own', secrets: 'own', mode: 'new' };

test('Forgejo: версия пакета — 17.0.2, та же, что на нашем стенде и проде (апгрейд 22.11.2026)', () => {
  assert.equal(FORGEJO_VERSION, '17.0.2');
  assert.ok(read('.env.example').split('\n').some(l => l.trim() === `FORGEJO_VERSION=${FORGEJO_VERSION}`),
    'в .env.example пакета версия Forgejo должна совпадать с FORGEJO_VERSION установщика');
  assert.ok(read('docker-compose.install.yml').includes(`codeberg.org/forgejo/forgejo:\${FORGEJO_VERSION:-${FORGEJO_VERSION}}`),
    'в compose пакета умолчание версии Forgejo должно совпадать с FORGEJO_VERSION установщика');
});

test('выбор Forgejo: install / own / none; не указан — none, как раньше', () => {
  assert.deepEqual(checkChoice(base), [], 'без поля forgejo выбор по-прежнему годен');
  for (const f of ['install', 'own', 'none']) assert.deepEqual(checkChoice({ ...base, forgejo: f }), [], f);
  assert.deepEqual(checkChoice({ ...base, forgejo: 'maybe' }), ['Forgejo: install, own или none']);
});

test('план: install — шаг установки Forgejo и forgejo-mcp; own — шаг «свой Forgejo» и forgejo-mcp; none — ни одного', () => {
  const ids = f => planSetup({ ...base, forgejo: f }).map(s => s.id);
  assert.ok(ids('install').includes('forgejo-install') && ids('install').includes('forgejo-mcp'));
  assert.ok(!ids('install').includes('forgejo-own'));
  assert.ok(ids('own').includes('forgejo-own') && ids('own').includes('forgejo-mcp'));
  assert.ok(!ids('own').includes('forgejo-install'));
  assert.ok(!ids('none').some(i => i.startsWith('forgejo')));
  assert.ok(!planSetup(base).map(s => s.id).some(i => i.startsWith('forgejo')), 'по умолчанию — без Forgejo');
  const own = planSetup({ ...base, forgejo: 'own' }).find(s => s.id === 'forgejo-own');
  assert.ok(own.env.includes('FORGEJO_API_TOKEN') && own.env.includes('FORGEJO_URL'));
  assert.match(own.howto.join(' '), /вписывает владелец/, 'токен вводит сам человек');
  const mcp = planSetup({ ...base, forgejo: 'install' }).find(s => s.id === 'forgejo-mcp');
  for (const k of ['FORGEJO_MCP_TOKEN', 'FORGEJO_MCP_API_KEY']) assert.ok(mcp.env.includes(k), 'forgejo-mcp: ' + k);
});

test('.env по варианту: профили compose, адрес Forgejo для forgejo-mcp и моста LORE; секретов нет', () => {
  assert.deepEqual(forgejoEnv({ forgejo: 'none' }), { COMPOSE_PROFILES: '', FORGEJO_URL: '', FORGEJO_BASE_OVERRIDE: '' });
  assert.deepEqual(forgejoEnv({}), { COMPOSE_PROFILES: '', FORGEJO_URL: '', FORGEJO_BASE_OVERRIDE: '' }, 'по умолчанию — none');
  assert.deepEqual(forgejoEnv({ forgejo: 'install' }),
    { COMPOSE_PROFILES: 'forgejo,forgejo-mcp', FORGEJO_URL: 'http://forgejo:3000', FORGEJO_BASE_OVERRIDE: 'http://forgejo:3000', FORGEJO_VERSION: '17.0.2' });
  assert.deepEqual(forgejoEnv({ forgejo: 'own', url: 'https://git.example.org/' }),
    { COMPOSE_PROFILES: 'forgejo-mcp', FORGEJO_URL: 'https://git.example.org', FORGEJO_BASE_OVERRIDE: '' });
  assert.throws(() => forgejoEnv({ forgejo: 'own', url: '' }), /адрес своего Forgejo/);
  assert.throws(() => forgejoEnv({ forgejo: 'own', url: 'ftp://x' }), /адрес своего Forgejo/);
  for (const f of ['install', 'own', 'none']) {
    const v = forgejoEnv({ forgejo: f, url: 'https://git.example.org' });
    assert.ok(!Object.keys(v).some(k => /TOKEN|SECRET|PASSWORD|API_KEY/.test(k)), f + ': секреты в .env через установщик не идут');
  }
});

test('сухой прогон: .env для трёх вариантов собирается из образца пакета', () => {
  const ex = INSTALL_BUNDLE.files['.env.example'];
  const t = f => installEnvText(ex, forgejoEnv({ forgejo: f, url: 'https://git.example.org' }));
  assert.match(t('none'), /^COMPOSE_PROFILES=$/m);
  assert.match(t('install'), /^COMPOSE_PROFILES=forgejo,forgejo-mcp$/m);
  assert.match(t('install'), /^FORGEJO_BASE_OVERRIDE=http:\/\/forgejo:3000$/m);
  assert.match(t('own'), /^COMPOSE_PROFILES=forgejo-mcp$/m);
  assert.match(t('own'), /^FORGEJO_URL=https:\/\/git\.example\.org$/m);
  for (const f of ['install', 'own', 'none']) {
    assert.match(t(f), /^FORGEJO_API_TOKEN=$/m, f + ': токен моста пуст — его вписывает владелец');
    assert.match(t(f), /^FORGEJO_MCP_TOKEN=$/m, f + ': токен forgejo-mcp пуст');
    assert.match(t(f), /^FORGEJO_MCP_API_KEY=CHANGE_ME$/m, f + ': ключ входа в forgejo-mcp сгенерирует install.sh');
  }
  assert.throws(() => installEnvText(ex, { FORGEJO_API_TOKEN: 't' }), /секрет/);
  assert.throws(() => installEnvText(ex, { FORGEJO_MCP_API_KEY: 'k' }), /секрет/);
});

test('compose: Forgejo и forgejo-mcp — под профилями (без выбора не стартуют), мост LORE получает токен и адрес', () => {
  const c = read('docker-compose.install.yml');
  assert.match(c, /\n  forgejo:\n    profiles: \["forgejo"\]/);
  assert.match(c, /\n  forgejo-mcp:\n    profiles: \["forgejo-mcp"\]/);
  assert.match(c, /FORGEJO_TOKEN=\$\{FORGEJO_MCP_TOKEN:-\}/, 'forgejo-mcp ходит своим токеном, не токеном моста');
  assert.match(c, /FORGEJO_MCP_API_KEY=\$\{FORGEJO_MCP_API_KEY:-\}/);
  assert.match(c, /- FORGEJO_API_TOKEN=\$\{FORGEJO_API_TOKEN:-\}/, 'мост LORE: токен из .env');
  assert.match(c, /- lore\.forgejo\.base-override=\$\{FORGEJO_BASE_OVERRIDE:-\}/, 'мост LORE: адрес Forgejo в сети compose');
  assert.match(c, /forgejo-data:\/forgejo-data:ro/, 'get_job_log читает логи Actions с тома Forgejo только на чтение');
  assert.ok(c.includes('context: ${FORGEJO_MCP_SRC:-./forgejo-mcp-src}'),'forgejo-mcp по умолчанию собирается из исходника пакета — сетевого умолчания нет');
});

test('строка MCP forgejo-mcp для агента: http, /mcp, ключ — ссылкой на переменную, не значением', () => {
  const e = forgejoMcpEntry({ url: 'http://127.0.0.1:4430/' });
  assert.deepEqual(e, { type: 'http', url: 'http://127.0.0.1:4430/mcp', headers: { Authorization: 'Bearer ${FORGEJO_MCP_API_KEY}' } });
  assert.throws(() => forgejoMcpEntry({ url: '' }), /адрес forgejo-mcp/);
});

// «Секреты рантайма» (владелица 20.11): перечень в README пакета сверяется с compose и .env.example в обе стороны,
// а у каждой строки — файл, где её читает рантайм, и имя там действительно есть.
const SECRET_RE = /\b[A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY)[A-Z0-9_]*\b/g;
function secretTable() {
  const md = read('README.md');
  const sec = md.split(/^## /m).find(s => s.startsWith('Секреты рантайма'));
  assert.ok(sec, 'в README нет раздела «Секреты рантайма»');
  const rows = sec.split('\n').filter(l => /^\| `[A-Z]/.test(l));
  return rows.map(l => {
    const cells = l.split('|').slice(1, -1).map(s => s.trim());
    return { names: [...cells[0].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(m => m[1]), files: [...cells[cells.length - 1].matchAll(/`([^`]+)`/g)].map(m => m[1]), cells };
  });
}
const codeLines = t => t.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

test('README «Секреты рантайма»: каждая переменная с SECRET/PASSWORD/TOKEN/KEY из compose и .env.example есть в таблице', () => {
  const names = new Set(secretTable().flatMap(r => r.names));
  const found = new Set([...codeLines(read('docker-compose.install.yml')).matchAll(SECRET_RE), ...codeLines(read('.env.example')).matchAll(SECRET_RE)].map(m => m[0]));
  const missing = [...found].filter(n => !names.has(n));
  assert.deepEqual(missing, [], 'нет в таблице README');
});

test('README «Секреты рантайма»: и наоборот — каждая строка таблицы читается в названном файле, колонок семь', () => {
  const rows = secretTable();
  assert.ok(rows.length >= 10, 'таблица на месте');
  const root = new URL('../../', import.meta.url);
  for (const r of rows) {
    assert.equal(r.cells.length, 7, r.names.join(',') + ': колонки — секрет · зачем · кто создаёт · где хранится · когда обязателен · как сменить · где читается');
    assert.ok(r.files.length > 0, r.names.join(',') + ': не указан файл, где читается');
    const text = r.files.map(f => fs.readFileSync(new URL(f, root), 'utf8')).join('\n');
    for (const n of r.names) assert.ok(text.includes(n), `${n}: нет в ${r.files.join(', ')}`);
  }
});
