// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · командный режим установки: `lore-migrate install-bundle --out <каталог> [--force]`
// выкладывает вшитый пакет deploy/install (install.sh, docker-compose.install.yml, .env.example, README.md) — то же, что
// кнопка «План установки» окна, но без окна (SPEC-LORE-INSTALLER-PIPELINE: труба проверяет командный режим).
// Повод — эмуляция на ryzenai 21.11.2026: в архиве исходников пакета .env.example нет намеренно (сторож секретов), и
// install.sh из архива падал «cannot stat .env.example». Пароли не пишутся: в .env.example заглушки CHANGE_ME, их
// генерирует install.sh. Баз команда не касается — файла доступа не требует.
import fs from 'node:fs';
import path from 'node:path';
import { INSTALL_BUNDLE } from './resources.mjs';

/** Выкладка пакета в каталог; уже выложенный не перезаписывается без force. Возвращает имена файлов. */
export function writeInstallBundle(dir, { force = false, execPath = process.execPath } = {}) {
  const out = path.resolve(dir);
  if (!force && fs.existsSync(path.join(out, 'install.sh')))
    throw new Error(`пакет установки уже есть в ${out} — не перезаписываю; заново — с ключом --force`);
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  for (const [name, text] of Object.entries(INSTALL_BUNDLE.files)) {
    const mode = name.endsWith('.sh') ? 0o755 : name === '.env.example' ? 0o600 : 0o644;
    fs.writeFileSync(path.join(out, name), text, { mode });
    files.push(name);
  }
  // MIG-01: свежая установка собирает базу из модели этим же исполняемым файлом (lore-migrate init-empty) — install.sh
  // находит его по пути рядом. Запущен не сам установщик (node + .mjs) — путь не пишется: install.sh попросит LORE_MIGRATE_BIN.
  if (/^lore-migrate/.test(path.basename(String(execPath || '')))) fs.writeFileSync(path.join(out, '.lore-migrate-path'), String(execPath) + '\n');
  return { dir: out, files };
}

const LAUNCHED = process.argv[1] === 'install-bundle';
if (LAUNCHED) {
  const i = process.argv.indexOf('--out');
  const dir = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 'lore-install';
  try {
    const r = writeInstallBundle(dir, { force: process.argv.includes('--force') });
    console.log(`пакет установки выложен в ${r.dir}: ${r.files.join(', ')}`);
    console.log(`дальше: bash ${path.join(r.dir, 'install.sh')} --dir <каталог установки> [--build-from-source] (см. README.md)`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
