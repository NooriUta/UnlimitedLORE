#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Сборка MSI установщика LORE для Windows (ставится без сети).
// Это сборочный инструмент, а не код установщика: он запускает tar и WiX и к пользователю не едет.
// Вход: архив Node.js LTS win-x64 (.zip с nodejs.org, сверенный по SHASUMS256) и WiX 5 (wix.dll из пакета nuget «wix»,
// запускается через dotnet; нужен .NET 6+ runtime, SDK не нужен).
// Запуск: node build-msi.mjs --node-zip <zip> --wix-dll <wix.dll> --version <1.2.3 | 0.0.0-preview.sha> [--build <номер>] [--out каталог]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Версия MSI — только числа major.minor.build (major, minor ≤ 255, build ≤ 65535). Предварительная — 0.0.<номер сборки>. */
export function msiVersion(version, build) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(version || ''));
  if (!m) throw new Error('версия не по образцу 1.2.3[-метка]: ' + version);
  let [, a, b, c] = m.map(Number);
  if (m[4]) {
    if (!Number.isInteger(build) || build < 1) throw new Error('предварительной сборке нужен номер сборки (--build) для версии MSI');
    a = 0; b = 0; c = build;
  }
  if (a > 255 || b > 255 || c > 65535) throw new Error('версия MSI: major и minor до 255, build до 65535 — ' + [a, b, c].join('.'));
  return [a, b, c].join('.');
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const nodeZip = arg('--node-zip'), wixDll = arg('--wix-dll'), version = arg('--version');
  const out = path.resolve(arg('--out') || path.join(HERE, '..', '..', 'build'));
  if (!nodeZip || !fs.existsSync(nodeZip)) throw new Error('нет архива Node.js: --node-zip');
  if (!wixDll || !fs.existsSync(wixDll)) throw new Error('нет WiX: --wix-dll');
  const msiVer = msiVersion(version, Number(arg('--build')));
  const stage = path.join(out, 'msi-stage'), nodeDir = path.join(stage, 'node');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(nodeDir, { recursive: true });

  // 1) установщик одним файлом (.mjs) — та же сборка, что выкладывается в kkRepo
  execFileSync(process.execPath, [path.join(HERE, 'build-installer.mjs'), '--out', stage], { stdio: 'inherit' });
  // Пускач — с концами строк CRLF: cmd на LF-строках ломается на блоках в скобках, а git на чекауте их не гарантирует.
  for (const f of ['lore-installer.cmd', 'lore-migrate.env.example'])
    fs.writeFileSync(path.join(stage, f), fs.readFileSync(path.join(HERE, 'windows', f), 'utf8').replace(/\r?\n/g, '\r\n'));

  // 2) node.exe и LICENSE из архива Node.js
  const top = path.basename(nodeZip).replace(/\.zip$/, '');
  // Windows: системный bsdtar. GNU tar из Git Bash принимает «C:» за удалённый хост («Cannot connect to C: resolve failed»).
  const sysTar = process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  const tarBin = sysTar && fs.existsSync(sysTar) ? sysTar : 'tar';
  execFileSync(tarBin, ['-xf', nodeZip, '-C', nodeDir, '--strip-components=1', `${top}/node.exe`, `${top}/LICENSE`], { stdio: 'inherit' });

  // 3) MSI
  const msi = path.join(out, `lore-installer-${version}-win-x64.msi`);
  execFileSync('dotnet', [wixDll, 'build', path.join(HERE, 'windows', 'Product.wxs'), '-arch', 'x64',
    '-d', `Version=${msiVer}`, '-d', `Src=${stage}`, '-d', `NodeSrc=${nodeDir}`, '-o', msi],
  { stdio: 'inherit', env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' } });
  console.log(`MSI: ${msi} · ${Math.round(fs.statSync(msi).size / 1048576)} МБ · версия MSI ${msiVer} · Node ${top}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ошибка: ' + e.message); process.exitCode = 1; });
}
