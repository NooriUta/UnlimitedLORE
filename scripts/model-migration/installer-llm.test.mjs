// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Локальная LLM в установщике.
// Слова владелицы 20.11.2026: «и в инсталятор добавить описание подключения для векторного индекса локальной llm и для qg».
// Что читает рантайм (backend/src/main/resources/application.properties, llm/LocalChatProvider.java): адрес машины
// LORE_LLM_LOCAL_URL → quarkus.rest-client.lore-llm-local.url, модель LORE_LLM_LOCAL_MODEL, ключ (необязателен)
// LORE_LLM_LOCAL_API_KEY. Векторного индекса в коде нет — установщик его настроек не выдумывает.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkChoice, planSetup, llmEnv, installEnvText } from './setup.mjs';
import { INSTALL_BUNDLE } from './resources.mjs';

const DIR = new URL('../../deploy/install/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, DIR), 'utf8');
const base = { components: ['lore'], kc: 'own', secrets: 'own', mode: 'new' };

test('выбор LLM: none / local; не указан — none, как раньше', () => {
  assert.deepEqual(checkChoice(base), []);
  for (const l of ['none', 'local']) assert.deepEqual(checkChoice({ ...base, llm: l }), [], l);
  assert.deepEqual(checkChoice({ ...base, llm: 'anthropic' }), ['LLM: none или local']);
});

test('план: local — шаг «Локальная LLM» с переменными рантайма; none — шага нет', () => {
  assert.ok(!planSetup(base).some(s => s.id === 'llm-local'), 'по умолчанию — без модели');
  assert.ok(!planSetup({ ...base, llm: 'none' }).some(s => s.id === 'llm-local'));
  const s = planSetup({ ...base, llm: 'local' }).find(x => x.id === 'llm-local');
  assert.ok(s, 'шаг есть');
  assert.deepEqual(s.env, ['LORE_LLM_LOCAL_URL', 'LORE_LLM_LOCAL_MODEL', 'LORE_LLM_LOCAL_API_KEY']);
  const h = s.howto.join(' ');
  assert.match(h, /\/v1\/chat\/completions/, 'названо, на каком диалекте ходит LORE');
  assert.match(h, /после 1\.18/, 'векторный индекс честно назван будущим');
  assert.match(h, /budget_unset|budget_exhausted/, 'названо, что без потолка суждения нет');
});

test('.env по выбору: адрес и модель; хвост /v1 и слэши срезаются (клиент дописывает /v1 сам); ключа нет', () => {
  assert.deepEqual(llmEnv({}), { LORE_LLM_LOCAL_URL: '', LORE_LLM_LOCAL_MODEL: '' }, 'по умолчанию — none');
  assert.deepEqual(llmEnv({ llm: 'none', url: 'http://x:1', model: 'm' }), { LORE_LLM_LOCAL_URL: '', LORE_LLM_LOCAL_MODEL: '' });
  assert.deepEqual(llmEnv({ llm: 'local', url: 'http://192.168.3.50:8086/v1/', model: ' qwen3.5-4b ' }),
    { LORE_LLM_LOCAL_URL: 'http://192.168.3.50:8086', LORE_LLM_LOCAL_MODEL: 'qwen3.5-4b' });
  assert.deepEqual(llmEnv({ llm: 'local', url: 'http://host.docker.internal:11434', model: 'qwen3:4b' }),
    { LORE_LLM_LOCAL_URL: 'http://host.docker.internal:11434', LORE_LLM_LOCAL_MODEL: 'qwen3:4b' });
  assert.throws(() => llmEnv({ llm: 'local', url: '', model: 'm' }), /адрес сервера модели/);
  assert.throws(() => llmEnv({ llm: 'local', url: 'ftp://x', model: 'm' }), /адрес сервера модели/);
  assert.throws(() => llmEnv({ llm: 'local', url: 'http://x:1', model: '' }), /имя модели/);
  const v = llmEnv({ llm: 'local', url: 'http://x:1', model: 'm' });
  assert.ok(!Object.keys(v).some(k => /TOKEN|SECRET|PASSWORD|API_KEY/.test(k)), 'ключ модели через установщик не идёт');
  const t = installEnvText(INSTALL_BUNDLE.files['.env.example'], v);
  assert.match(t, /^LORE_LLM_LOCAL_URL=http:\/\/x:1$/m);
  assert.match(t, /^LORE_LLM_LOCAL_MODEL=m$/m);
  assert.match(t, /^LORE_LLM_LOCAL_API_KEY=$/m, 'ключ пуст — вписывает владелец, если раннер его требует');
});

test('compose: бэкенд получает адрес, модель и ключ локальной модели; пустое — как в коде', () => {
  const c = read('docker-compose.install.yml');
  assert.match(c, /- LORE_LLM_LOCAL_URL=\$\{LORE_LLM_LOCAL_URL:-http:\/\/localhost:11434\}/, 'умолчание то же, что в application.properties');
  assert.match(c, /- LORE_LLM_LOCAL_MODEL=\$\{LORE_LLM_LOCAL_MODEL:-\}/);
  assert.match(c, /- LORE_LLM_LOCAL_API_KEY=\$\{LORE_LLM_LOCAL_API_KEY:-\}/);
  assert.match(c, /host\.docker\.internal:host-gateway/, 'модель на той же машине достижима из контейнера');
});

test('имена переменных — те, что читает рантайм (application.properties)', () => {
  const props = fs.readFileSync(new URL('../../backend/src/main/resources/application.properties', import.meta.url), 'utf8');
  // ключ объявлен в properties только комментарием: его берёт @ConfigProperty lore.llm.local.api-key, а переменная
  // окружения LORE_LLM_LOCAL_API_KEY — то же имя по правилу MicroProfile Config (точки и дефисы → «_», верхний регистр)
  const provider = fs.readFileSync(new URL('../../backend/src/main/java/studio/seer/heimdall/lore/llm/LocalChatProvider.java', import.meta.url), 'utf8');
  assert.match(provider, /@ConfigProperty\(name = "lore\.llm\.local\.api-key"\)/);
  for (const k of ['LORE_LLM_LOCAL_URL', 'LORE_LLM_LOCAL_MODEL', 'LORE_LLM_LOCAL_API_KEY']) {
    assert.ok(props.includes('${' + k + ':'), k + ': нет в application.properties');
    assert.match(read('.env.example'), new RegExp('^' + k + '=$', 'm'), '.env.example: ' + k + ' пустая');
  }
  assert.ok(!/LORE_EMBEDDING|lore\.embedding/i.test(read('.env.example') + read('docker-compose.install.yml')),
    'настроек векторного индекса в коде нет — в пакете их тоже нет');
});

test('README: раздел про локальную LLM — что даёт, проверенные модели, как проверить, что без модели', () => {
  const md = read('README.md');
  const sec = md.split(/^## /m).find(s => s.startsWith('Локальная LLM'));
  assert.ok(sec, 'нет раздела «Локальная LLM»');
  for (const re of [/Qwen3-Embedding/, /1024/, /после 1\.18/, /\/v1\/models/, /budget_unset/, /search_similar|полнотекст/]) assert.match(sec, re);
});
