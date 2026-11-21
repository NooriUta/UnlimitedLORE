// Проверка kit «глазами потребителя» (SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY).
//
// То, что потребитель делает на самом деле: архив пакета (npm pack) → установка в ЧИСТУЮ
// временную папку → импорт. Три утверждения, каждое с положительным контролем:
//  1. в архиве только dist (нет исходников, тестов, демо-HTML), а входы манифеста в нём есть;
//  2. после установки в node_modules нет тестовых зависимостей kit (vitest, jsdom, typescript…),
//     а рабочие peer-зависимости — есть (иначе «нет лишнего» доказывало бы пустую установку);
//  3. входы открываются в Node без сборщика и отдают ожидаемые имена.
// Сеть нужна для peer-зависимостей (react, react-dom, @iconify/react) — из настроенного реестра npm.
//
// Запуск: `npm run consumer-check` в kit/. Код выхода 0 — все три утверждения верны.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args.map(a => (process.platform === 'win32' && /[\s^]/.test(a) ? JSON.stringify(a) : a)), { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
const fail = msg => { console.error(`consumer-check: ПРОВАЛ — ${msg}`); process.exitCode = 1; };

const work = mkdtempSync(join(tmpdir(), 'kit-consumer-'));
try {
  // 1. Архив.
  // Сборка отдельно, архив — без скриптов: вывод prepack смешался бы с JSON-ответом npm pack.
  execFileSync(process.execPath, [join(root, 'scripts', 'build-package.mjs')], { cwd: root, stdio: 'inherit' });
  const packed = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', work], root));
  const files = packed[0].files.map(f => f.path.replace(/\\/g, '/'));
  const tgz = join(work, packed[0].filename);
  console.log(`архив: ${packed[0].filename}, файлов ${files.length}, ${(packed[0].size / 1024).toFixed(0)} КБ`);
  const stray = files.filter(f => f !== 'package.json' && !/^(README|LICENSE)/i.test(f) && !f.startsWith('dist/'));
  if (stray.length) fail(`в архиве не только dist: ${stray.slice(0, 5).join(', ')}`);
  if (files.some(f => /\.test\.(t|j)sx?$/.test(f))) fail('в архиве есть тесты');
  for (const [entry, t] of Object.entries(pkg.exports)) {
    const target = (t.import ?? t.default).replace(/^\.\//, '');
    if (target.includes('*')) continue;
    if (!files.includes(target)) fail(`вход ${entry} → ${target}: файла нет в архиве`);
  }

  // 2. Установка в чистую папку.
  const app = join(work, 'app');
  execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(app)})`]);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'kit-consumer', version: '0.0.0', private: true, type: 'module' }, null, 2));
  // Корневой вход статически тянет разметку (marked, dompurify, katex, mermaid, bpmn-js): у потребителя
  // эти peer «необязательные» по манифесту, но для входа «.» нужны — ставим их, как поставил бы он.
  const peers = pkg.peerDependencies ?? {};
  const forRoot = ['dompurify', 'marked', 'katex', 'mermaid', 'bpmn-js', '@mermaid-js/layout-elk'].map(n => n + '@' + peers[n]);
  run(['install', tgz, ...forRoot, '--no-audit', '--no-fund', '--ignore-scripts'], app);
  const nm = join(app, 'node_modules');
  const installed = new Set(readdirSync(nm).flatMap(n => (n.startsWith('@') ? readdirSync(join(nm, n)).map(s => `${n}/${s}`) : [n])));
  console.log(`установлено пакетов верхнего уровня: ${installed.size}`);
  if (!installed.has('@seidr/kit')) fail('kit не установился');
  if (!installed.has('react')) fail('положительный контроль: peer react не установлен — проверка «нет лишнего» ничего бы не доказала');
  const devOnly = Object.keys(pkg.devDependencies ?? {}).filter(d => !(d in peers));
  // Утечка — только то, что тянет САМ kit. Тот же пакет может прийти транзитивно от peer
  // (например, @types/d3-force — от mermaid); это не тестовая зависимость kit.
  // Прямая (не peer) зависимость kit: строка «<пакет>@"…" from @seidr/kit» в npm explain.
  const viaKit = d => {
    let out = '';
    try { out = run(['explain', d], app); } catch { return false; }
    const esc = d.replace(/[.*+?^${}()|[\]\\/]/g, ch => `\\${ch}`);
    return new RegExp(`^\\s*${esc}@"[^"]*" from @seidr/kit@`, 'm').test(out);
  };
  // Второй, независимый признак: в манифесте установленного kit нет dependencies вовсе.
  const kitManifest = JSON.parse(readFileSync(join(nm, '@seidr', 'kit', 'package.json'), 'utf8'));
  const deps = Object.keys(kitManifest.dependencies ?? {});
  if (deps.length) fail(`у установленного kit есть dependencies: ${deps.join(', ')}`);
  const transit = devOnly.filter(d => installed.has(d) && !viaKit(d));
  if (transit.length) console.log(`есть транзитивно от peer, не от kit: ${transit.join(', ')}`);
  const leaked = devOnly.filter(d => installed.has(d) && viaKit(d));
  if (leaked.length) fail(`у потребителя тестовые зависимости kit: ${leaked.join(', ')}`);
  else console.log(`тестовых зависимостей нет (проверено ${devOnly.length}: ${devOnly.join(', ')})`);

  // 3. Импорт входов без сборщика. Корневой вход и core статически тянут bpmn-js, а bpmn-js сам
  // пишет импорты без расширений и в голом Node не открывается — у потребителя их открывает
  // сборщик (vite и т. п.). Поэтому здесь: style-guard и graph — импортом в Node; «.» и core —
  // разрешением адреса (вход находится, ведёт в dist, рядом типы).
  const probe = `
    import { existsSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    import { sep } from 'node:path';
    const guard = await import('@seidr/kit/style-guard');
    const graph = await import('@seidr/kit/graph');
    if (!Object.keys(guard).length || !Object.keys(graph).length) { console.error('входы пустые'); process.exit(1); }
    for (const e of ['@seidr/kit', '@seidr/kit/core', '@seidr/kit/record', '@seidr/kit/content', '@seidr/kit/auth', '@seidr/kit/styles/seidr.css']) {
      const f = fileURLToPath(import.meta.resolve(e));
      if (!f.split(sep).includes('dist') || !existsSync(f)) { console.error(e + ' → ' + f); process.exit(1); }
      if (f.endsWith('.js') && !existsSync(f.slice(0, -3) + '.d.ts')) { console.error(e + ': нет типов'); process.exit(1); }
    }
    console.log('импорт: style-guard (' + Object.keys(guard).length + ' имён), graph (' + Object.keys(graph).length + ') — ок; входы ., core, record, content, auth, css ведут в dist с типами');
  `;
  writeFileSync(join(app, 'probe.mjs'), probe);
  try {
    console.log(execFileSync(process.execPath, ['probe.mjs'], { cwd: app, encoding: 'utf8' }).trim());
  } catch (e) {
    fail(`импорт не открылся: ${(e.stderr || e.message).toString().split('\n').slice(0, 6).join(' | ')}`);
  }
  if (!existsSync(join(nm, '@seidr', 'kit', 'dist', 'src', 'index.d.ts'))) fail('типов нет: dist/src/index.d.ts');
} finally {
  if (process.env.KIT_CONSUMER_KEEP !== '1') rmSync(work, { recursive: true, force: true });
  else console.log(`папка потребителя оставлена: ${work}`);
}
if (!process.exitCode) console.log('consumer-check: ок');
