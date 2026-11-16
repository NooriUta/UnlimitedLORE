#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Сборка установщика переноса в один файл.
// Выход: build/lore-migrate.mjs — весь конвейер, карта, правила и словарь статусов в одном файле; запускается
// `node lore-migrate.mjs` на любой операционке, репозиторий рядом не нужен.
// С ключом --exe — ещё и исполняемый файл для ТОЙ операционки, на которой идёт сборка (Windows — .exe,
// Linux — без расширения): Node внутри, ставить его на машину не нужно. Собран из самого Node (single
// executable application) и пакета postject; postject ищется как esbuild, путь можно задать POSTJECT_DIR.
// Под Linux собирать на Linux — так в файл попадает Node той же сборки, что пойдёт на машину.
// Сборщик esbuild берётся из уже установленных пакетов репозитория; путь можно задать ESBUILD_DIR.
// Запуск: node scripts/model-migration/build-installer.mjs [--out каталог] [--exe]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'build'));

function findPackage(name, envKey, resolveOnly = false) {
  const places = [process.env[envKey], path.join(ROOT, 'mcp-server'), path.join(ROOT, 'web-next'), ROOT].filter(Boolean);
  for (const p of places) {
    const req = createRequire(pathToFileURL(path.join(p, 'x.js')));
    try { return resolveOnly ? req.resolve(name) : req(name); } catch { /* ищем дальше */ }
  }
  throw new Error(`пакет ${name} не найден; задайте ${envKey} — каталог, где он установлен. Искали: ` + places.join(', '));
}

const esbuild = findPackage('esbuild', 'ESBUILD_DIR');
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

if (process.argv.includes('--exe')) {
  // Пускач внутри исполняемого файла: модуль установщика лежит ресурсом и импортируется из памяти.
  const stub = path.join(OUT, 'sea-stub.cjs');
  fs.writeFileSync(stub, [
    "const { getAsset } = require('node:sea');",
    "const code = getAsset('lore-migrate.mjs', 'utf8');",
    "import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')).catch(e => { console.error('ошибка: ' + e.message); process.exitCode = 1; });",
  ].join('\n') + '\n');
  const blob = path.join(OUT, 'sea-prep.blob'), cfg = path.join(OUT, 'sea-config.json');
  fs.writeFileSync(cfg, JSON.stringify({ main: stub, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, assets: { 'lore-migrate.mjs': outfile } }));
  execFileSync(process.execPath, ['--experimental-sea-config', cfg], { stdio: 'inherit' });
  const exe = path.join(OUT, 'lore-migrate' + (process.platform === 'win32' ? '.exe' : ''));
  fs.copyFileSync(process.execPath, exe);
  const postject = findPackage('postject/dist/cli.js', 'POSTJECT_DIR', true);
  const args = [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  for (const f of [stub, blob, cfg]) fs.rmSync(f);
  console.log(`исполняемый файл: ${exe} · ${Math.round(fs.statSync(exe).size / 1048576)} МБ · ${process.platform}-${process.arch} · Node ${process.version}`);
}
