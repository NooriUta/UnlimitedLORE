// Сборка kit пакетом (SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY): dist/ = JS (ESM) + типы .d.ts.
//
// Без новых зависимостей: компилирует tsc (уже есть у kit), остальное — этот скрипт.
//  1. tsc -p tsconfig.build.json → dist/src, dist/demo (тесты не входят).
//  2. Относительные импорты без расширения дописываются: './x' → './x.js' или './x/index.js'.
//     Исходники пишутся для сборщика (moduleResolution: bundler), а собранный пакет должен
//     открываться и там, где расширение обязательно (Node, webpack с fullySpecified).
//  3. JSON-модули (словари, схемы) превращаются в .json.js с `export default`: импорт JSON без
//     атрибута `with { type: 'json' }` Node не открывает, а сборщики открывают оба вида.
//  4. CSS копируется как есть (вход ./styles/seidr.css).
// Детерминировано: обход каталогов сортирован, вывод не зависит от порядка файловой системы.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit', cwd: root });

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

// 3. JSON → модуль. tsc кладёт импортированные .json рядом (resolveJsonModule).
for (const f of walk(dist).filter(f => f.endsWith('.json'))) {
  writeFileSync(`${f}.js`, `export default ${readFileSync(f, 'utf8').trim()};\n`);
  writeFileSync(`${f}.d.ts`, `declare const data: Record<string, unknown>;\nexport default data;\n`);
  rmSync(f);
}

// 2. Относительные спецификаторы → с расширением.
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;
function fix(file, spec) {
  if (/\.(js|css|mjs)$/.test(spec)) return spec;
  const base = resolve(dirname(file), spec);
  if (spec.endsWith('.json')) return `${spec}.js`;
  if (existsSync(`${base}.js`) || existsSync(`${base}.d.ts`)) return `${spec}.js`;
  if (existsSync(join(base, 'index.js')) || existsSync(join(base, 'index.d.ts'))) return `${spec}/index.js`;
  throw new Error(`${relative(root, file)}: импорт «${spec}» не найден в dist`);
}
// Глубокий импорт из пакета без карты exports ('bpmn-js/lib/NavigatedViewer') — тоже с расширением,
// если такой файл в пакете есть: Node без него не откроет, сборщикам всё равно.
const DEEP = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])((?:@[^/'"]+\/)?[^./'"][^/'"]*\/[^'"]+)\2/g;
function fixDeep(spec) {
  if (/\.[cm]?js$|\.css$|\.json$/.test(spec)) return spec;
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  const pkgDir = join(root, 'node_modules', name);
  if (!existsSync(join(pkgDir, 'package.json'))) return spec;
  if (JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).exports) return spec;
  return existsSync(join(root, 'node_modules', `${spec}.js`)) ? `${spec}.js` : spec;
}
for (const f of walk(dist).filter(f => f.endsWith('.js') || f.endsWith('.d.ts'))) {
  const src = readFileSync(f, 'utf8');
  const next = src
    .replace(SPEC, (_m, pre, q, spec) => `${pre}${q}${fix(f, spec)}${q}`)
    .replace(DEEP, (_m, pre, q, spec) => `${pre}${q}${fixDeep(spec)}${q}`);
  if (next !== src) writeFileSync(f, next);
}

// 4. CSS.
for (const f of walk(join(root, 'src')).filter(f => f.endsWith('.css'))) {
  cpSync(f, join(dist, relative(root, f)));
}
console.log(`kit: dist собран (${walk(dist).length} файлов)`);
