#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Сборка установщика переноса в один файл.
// Выход: build/lore-migrate.mjs — весь конвейер, карта, правила и словарь статусов в одном файле; запускается
// `node lore-migrate.mjs` на любой операционке, репозиторий рядом не нужен. Исполняемые файлы под Windows
// и Linux собираются из него следующим шагом (ему нужен пакет postject).
// Сборщик esbuild берётся из уже установленных пакетов репозитория; путь можно задать ESBUILD_DIR.
// Запуск: node scripts/model-migration/build-installer.mjs [--out каталог]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'build'));

function findEsbuild() {
  const places = [process.env.ESBUILD_DIR, path.join(ROOT, 'mcp-server'), path.join(ROOT, 'web-next'), ROOT].filter(Boolean);
  for (const p of places) {
    try { return createRequire(pathToFileURL(path.join(p, 'x.js')))('esbuild'); } catch { /* ищем дальше */ }
  }
  throw new Error('сборщик esbuild не найден; задайте ESBUILD_DIR — каталог, где он установлен. Искали: ' + places.join(', '));
}

const esbuild = findEsbuild();
fs.mkdirSync(OUT, { recursive: true });
const outfile = path.join(OUT, 'lore-migrate.mjs');
const res = await esbuild.build({
  entryPoints: [path.join(HERE, 'cli.mjs')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile,
  banner: { js: '// lore-migrate — установщик переноса LORE. Собран из scripts/model-migration; руками не править.' },
  define: { 'process.env.LORE_MIGRATE_MAIN': '"1"' },
  logLevel: 'warning', metafile: true,
});
const inputs = Object.keys(res.metafile.inputs);
console.log(`собрано: ${outfile} · ${fs.statSync(outfile).size} байт · исходных файлов ${inputs.length} (из них конфигурации .json — ${inputs.filter(f => f.endsWith('.json')).length})`);
