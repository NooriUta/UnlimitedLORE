// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · командный режим установки (SPEC-LORE-INSTALLER-PIPELINE: «окно установщика труба
// не нажимает — проверяет командный режим»). Пакет установки (install.sh, compose, .env.example, README) вшит в
// исполняемый файл, но на диск его выкладывало только окно; в архиве исходников .env.example нет намеренно (сторож
// секретов source-archive), и install.sh из архива падал «cannot stat .env.example» — найдено эмуляцией на ryzenai 21.11.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeInstallBundle } from './install-bundle-write.mjs';
import { INSTALL_BUNDLE } from './resources.mjs';
import { parseArgs, COMMANDS } from './cli.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));

test('выкладывает все файлы пакета установки, .env.example — как вшит', () => {
  const d = path.join(tmp(), 'lore-install');
  const r = writeInstallBundle(d);
  assert.deepEqual(r.files.sort(), Object.keys(INSTALL_BUNDLE.files).sort());
  for (const n of Object.keys(INSTALL_BUNDLE.files)) assert.equal(fs.readFileSync(path.join(d, n), 'utf8'), INSTALL_BUNDLE.files[n], n);
  assert.ok(r.files.includes('.env.example') && r.files.includes('install.sh'));
});

// MIG-01: свежая установка собирает базу из модели этим же исполняемым файлом — install.sh находит его по пути рядом.
test('путь к исполняемому файлу установщика — рядом с install.sh, только если запущен сам установщик', () => {
  const d = tmp();
  writeInstallBundle(d, { execPath: '/opt/pkg/lore-migrate-1.18.0-rc.x-linux-x64' });
  assert.equal(fs.readFileSync(path.join(d, '.lore-migrate-path'), 'utf8').trim(), '/opt/pkg/lore-migrate-1.18.0-rc.x-linux-x64');
  const d2 = tmp();
  writeInstallBundle(d2, { execPath: '/usr/bin/node' });
  assert.equal(fs.existsSync(path.join(d2, '.lore-migrate-path')), false, 'node — не установщик, путь не пишется');
});

test('уже выложенный пакет не перезаписывается молча; --force — перезапись', () => {
  const d = tmp();
  writeInstallBundle(d);
  assert.throws(() => writeInstallBundle(d), /уже есть.*--force/);
  assert.doesNotThrow(() => writeInstallBundle(d, { force: true }));
});

test('команда install-bundle — без файла доступа (баз не касается), первой по шагам', () => {
  const saved = process.env.MIG_ENV_FILE;
  delete process.env.MIG_ENV_FILE;
  try {
    const a = parseArgs(['install-bundle', '--out', 'x']);
    assert.equal(a.error, undefined);
    assert.equal(a.command.name, 'install-bundle');
    assert.deepEqual(a.rest, ['--out', 'x']);
  } finally { if (saved !== undefined) process.env.MIG_ENV_FILE = saved; }
  assert.equal(COMMANDS[0].name, 'install-bundle');
  assert.equal(COMMANDS[0].write, false);
});
