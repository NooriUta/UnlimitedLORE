// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Справка в окне установщика — из README пакета, одним источником.
// Слово владелицы 20.11.2026: «не просто md, он должен быть виден в визарде»; «я про установщик настройку окружения
// и все остальное». Сторож: раздел шага в окне = раздел README; ни один раздел README не потерян для окна.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HELP_STEPS, readmeSections, helpFor, mdToHtml, helpHtml } from './install-help.mjs';
import { INSTALL_BUNDLE } from './resources.mjs';
import { pageHtml } from './ui.mjs';

const README = fs.readFileSync(new URL('../../deploy/install/README.md', import.meta.url), 'utf8');
const LLM = /^Локальная LLM/;

test('шаги справки окна — Старт, Keycloak, Völva, Forgejo, LLM, Файлы, miniLORE, Секреты, Проверка', () => {
  assert.deepEqual(HELP_STEPS.map(s => s.id), ['start', 'keycloak', 'volva', 'forgejo', 'llm', 'files', 'minilore', 'secrets', 'check']);
  assert.deepEqual(HELP_STEPS.map(s => s.title), ['Старт', 'Keycloak', 'Völva', 'Forgejo', 'LLM', 'Файлы', 'miniLORE', 'Секреты', 'Проверка']);
});

test('разделы README по заголовкам ##: «## » внутри блока кода — не заголовок', () => {
  const s = readmeSections('# T\n\nвступление\n\n## А\n\nтекст а\n\n```bash\n## не заголовок\n```\n\n## Б\n\nтекст б\n');
  assert.deepEqual(s.map(x => x.heading), ['А', 'Б']);
  assert.match(s[0].body, /## не заголовок/);
  assert.equal(s[1].body, 'текст б');
});

test('каждый раздел README виден в окне ровно на одном шаге — ничего не потеряно', () => {
  const where = new Map();
  for (const st of HELP_STEPS) for (const sec of helpFor(README, st.id).sections) {
    assert.ok(!where.has(sec.heading), `«${sec.heading}» попал и в ${where.get(sec.heading)}, и в ${st.id}`);
    where.set(sec.heading, st.id);
  }
  for (const sec of readmeSections(README)) assert.ok(where.has(sec.heading), `раздел README «${sec.heading}» не виден ни на одном шаге окна`);
});

test('у каждого шага разделы README есть (LLM — «Локальная LLM…» из #1663); пропажа раздела в окне названа явно', () => {
  assert.ok(helpFor(README, 'llm').sections.some(s => LLM.test(s.heading)), 'шаг LLM: нет раздела «Локальная LLM»');
  const gone = helpHtml(README.replace(/^## Völva/m, '## Вёльва'));
  assert.match(gone, /В README пакета нет раздела «Völva»/, 'пропавший раздел — честное «раздела нет», а не пустой блок');
  for (const st of HELP_STEPS) {
    const h = helpFor(README, st.id);
    assert.ok(h.sections.length > 0, st.id + ': нет разделов README');
    assert.deepEqual(h.missing, [], st.id + ': не найдены разделы ' + h.missing.join(', '));
  }
});

test('сторож: блок шага в окне = разделы README этого шага (тот же текст, отрисованный)', () => {
  const page = pageHtml();
  for (const st of HELP_STEPS) {
    assert.match(page, new RegExp(`<details class="guide help" id="help-${st.id}"`), st.id + ': нет блока в окне');
    for (const sec of helpFor(INSTALL_BUNDLE.files['README.md'], st.id).sections) {
      assert.ok(page.includes(mdToHtml(sec.body)), `${st.id}: «${sec.heading}» в окне разошёлся с README`);
    }
  }
});

test('окно читает ту же копию README, что лежит в пакете (вшитая = deploy/install/README.md)', () => {
  assert.equal(INSTALL_BUNDLE.files['README.md'], README, 'копия README разошлась: node scripts/model-migration/install-bundle-sync.mjs');
});

test('Секреты: таблица «Секреты рантайма» на шаге «Секреты» — имена и как сменить; полей для значений нет', () => {
  const h = helpHtml(README);
  const block = h.slice(h.indexOf('id="help-secrets"'), h.indexOf('</details>', h.indexOf('id="help-secrets"')));
  assert.match(block, /<table/);
  for (const k of ['ARCADEDB_ROOT_PASSWORD', 'S3_SECRET_KEY', 'FORGEJO_MCP_API_KEY', 'LORE_VOLVA_EMBED_ES256_PRIVATE_KEY']) assert.match(block, new RegExp(k));
  assert.match(block, /как сменить/);
  assert.doesNotMatch(block, /<input|<textarea|<form/, 'справка не принимает значения секретов');
});

test('Старт: настройка окружения и «Собрать самому» видны в окне', () => {
  const names = helpFor(README, 'start').sections.map(s => s.heading);
  assert.ok(names.some(n => /^Настройка окружения/.test(n)), 'нет раздела «Настройка окружения»');
  assert.ok(names.some(n => /^Собрать самому/.test(n)), 'нет раздела «Собрать самому»');
});

test('отрисовка markdown: HTML экранируется, код, таблица, списки', () => {
  assert.equal(mdToHtml('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.match(mdToHtml('`a<b`'), /<code>a&lt;b<\/code>/);
  assert.match(mdToHtml('**жирно** и [ссылка](https://x.org/a)'), /<b>жирно<\/b> и <a href="https:\/\/x.org\/a" target="_blank" rel="noopener">ссылка<\/a>/);
  assert.doesNotMatch(mdToHtml('[x](javascript:alert(1))'), /href="javascript/);
  assert.equal(mdToHtml('**`A_B`** и `**не жирно**`'), '<p><b><code>A_B</code></b> и <code>**не жирно**</code></p>', 'жирный код — как в «Чего в этом профиле нет»');
  const t = mdToHtml('| а | б |\n|---|---|\n| 1 | `2` |');
  assert.match(t, /<th>а<\/th><th>б<\/th>/);
  assert.match(t, /<td data-th="б"><code>2<\/code><\/td>/, 'у ячейки — подпись колонки для телефона');
  assert.match(mdToHtml('- x\n- y'), /<ul><li>x<\/li><li>y<\/li><\/ul>/);
  assert.match(mdToHtml('1. x\n2. y'), /<ol><li>x<\/li><li>y<\/li><\/ol>/);
  assert.match(mdToHtml('```bash\necho <a>\n```'), /<pre class="mono">echo &lt;a&gt;<\/pre>/);
  assert.match(mdToHtml('### Под'), /<h4>Под<\/h4>/);
});
