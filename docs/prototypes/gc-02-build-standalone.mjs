// Сборка прототипа SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02 для открытия двойным щелчком (file://, без сервера).
//
//   node docs/prototypes/gc-02-build-standalone.mjs
//
// Шаг 1. Из канона модели shared/model/lore-model.json выписывает допустимые связи между типами
//        (relations каждого типа, приведённые к виду «откуда — rel — куда») в gc-02-graphs/model-relations.json.
//        Доска в режиме правки предлагает тип связи только из этого списка.
// Шаг 2. Встраивает все JSON из gc-02-graphs/ в страницу как window.__GC02_DATA и пишет
//        gc-02-graph-views.standalone.html. Страница сама берёт данные из __GC02_DATA, если они есть, иначе — fetch.
//
// Ловушка: вставка идёт String.replace с ФУНКЦИЕЙ-заменой — строка-замена трактует «$&», «$'», «$1» в данных
// как шаблоны и молча портит JS. «<» в данных экранируется в <, чтобы «</script>» в тексте записи не закрыл тег.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

// ── Шаг 1: связи модели ──────────────────────────────────────────────────────────────────────
const model = JSON.parse(readFileSync(join(repo, 'shared/model/lore-model.json'), 'utf8'));
const types = {};
for (const t of model.types) types[t.type] = t.label;
const seen = new Map();
for (const t of model.types) {
  for (const r of t.relations || []) {
    if (!r.rel || !r.targetType) continue;
    const [f, to] = r.dir === 'in' ? [r.targetType, t.type] : [t.type, r.targetType];
    const key = `${f} ${r.rel} ${to}`;
    // Подпись берём со стороны «откуда»: так связь читается «задача — Спринт», «решение — ADR».
    if (!seen.has(key) || r.dir !== 'in') seen.set(key, { f, rel: r.rel, t: to, label: r.label || r.rel });
  }
}
const relations = [...seen.values()].sort((a, b) => (a.f + a.rel + a.t).localeCompare(b.f + b.rel + b.t));
const relFile = join(here, 'gc-02-graphs', 'model-relations.json');
writeFileSync(relFile, JSON.stringify({
  source: 'shared/model/lore-model.json — types[].relations (dir in развёрнут в «откуда → куда»)',
  built_by: 'docs/prototypes/gc-02-build-standalone.mjs',
  model_format: model.format,
  types,
  relations,
}, null, 1) + '\n');
console.log(`model-relations.json: ${relations.length} связей, ${Object.keys(types).length} типов`);

// ── Шаг 2: standalone ────────────────────────────────────────────────────────────────────────
const src = readFileSync(join(here, 'gc-02-graph-views.html'), 'utf8');
const data = {};
for (const f of readdirSync(join(here, 'gc-02-graphs')).filter(f => f.endsWith('.json')).sort()) {
  data['gc-02-graphs/' + f] = JSON.parse(readFileSync(join(here, 'gc-02-graphs', f), 'utf8'));
}
const payload = JSON.stringify(data).replace(/</g, '\\u003c');
const marker = '<script type="importmap">';
if (!src.includes(marker)) throw new Error('в странице нет <script type="importmap"> — некуда встроить данные');
const out = src.replace(marker, () => `<script>window.__GC02_DATA=${payload};</script>\n${marker}`);
// Проверка, что вставка не испорчена: данные из страницы разбираются обратно и совпадают по числу файлов.
const back = JSON.parse(out.slice(out.indexOf('window.__GC02_DATA=') + 19, out.indexOf(';</script>', out.indexOf('window.__GC02_DATA='))));
if (Object.keys(back).length !== Object.keys(data).length) throw new Error('встроенные данные не совпали с исходными');
const dst = join(here, 'gc-02-graph-views.standalone.html');
writeFileSync(dst, out);
console.log(`${dst}: ${(Buffer.byteLength(out) / 1024).toFixed(0)} КБ, встроено файлов: ${Object.keys(data).length}`);
