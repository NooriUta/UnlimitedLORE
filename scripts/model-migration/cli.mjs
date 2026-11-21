#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Установщик переноса — одна точка входа.
// Слова владелицы 16.11.2026: установщик «должен быть независимым и не зависеть от операционки»; сборки —
// под Windows и под Linux. Команды идут в порядке шагов процесса; каждая — прежний сценарий конвейера,
// запущенный с теми же ключами. Файл доступа и файл решений передаются путём, а не лежат в репозитории.
//
// Запуск: lore-migrate <команда> --env <файл доступа> [--decisions <файл решений>] [ключи команды]
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '0.1.0';
// Порядок — порядок шагов переноса. write: команда пишет в новую базу (источник не пишет ни одна).
export const COMMANDS = [
  // MIG-04: шаг 0 — выложить вшитый пакет установки (install.sh, compose, .env.example); баз не касается (noEnv).
  { name: 'install-bundle', module: () => import('./install-bundle-write.mjs'), write: false, noEnv: true, about: 'выложить пакет установки LORE (install.sh, compose, .env.example, README) в каталог --out [--force] — командный режим, без окна' },
  { name: 'connect', module: () => import('./probe.mjs'), write: false, about: 'проверить подключение: сервер отвечает, источник читается, есть ли новая база (--create-dst — создать пустую)' },
  // MIG-01: свежая установка — пустая база из модели тем же путём, что перенос, без источника (решения не нужны: записей нет).
  { name: 'init-empty', module: () => import('./init-empty.mjs'), write: true, noDecisions: true, about: 'пустая база LORE из модели для свежей установки: схема из модели, связи, справочники; источник не читается (нужны только MIG_DST_*)' },
  { name: 'census', module: () => import('./edge-census.mjs'), write: false, about: 'перепись связей источника (--out файл.json)' },
  { name: 'orphans', module: () => import('./orphan-census.mjs'), write: false, about: 'перепись потеряшек: записи без обязательной связи (--out файл.json)' },
  { name: 'statuses', module: () => import('./status-check.mjs'), write: false, about: 'проверка статусов и справочников: что свелось само, что ждёт решения; код выхода 1, пока есть строка без решения (--out диалог.json)' },
  { name: 'dry-run', module: () => import('./dry-run.mjs'), write: false, about: 'пробный расчёт без записи: что не привелось, что удержано, поля вне карты (--out отчёт.json)' },
  { name: 'transfer', module: () => import('./transfer.mjs'), write: true, about: 'перенос записей с историей в новую базу и сверка (--out отчёт.json); не начинается, пока есть статусы без решения или продукты без вида (--allow-pending — обход для пробы)' },
  { name: 'edges', module: () => import('./transfer-edges.mjs'), write: true, about: 'перенос связей в новую базу и сверка; после transfer (--out отчёт.json)' },
  { name: 'ui', module: () => import('./ui.mjs'), write: false, about: 'интерфейс переноса в браузере на 127.0.0.1 (--port 2499): диалог по данным этой установки, решения пишутся в файл --decisions; --proposals <файл> — предложенные коды подсказкой «предложено» (в решения — только по «принять»)' },
  // MD-05: после замены базы и старта бэкенда — дотянуть данные PR из Forgejo (делает сервер, здесь ни баз, ни секретов).
  { name: 'pr-backfill', module: () => import('./pr-backfill.mjs'), write: false, noEnv: true, about: 'дотянуть данные PR (заголовок, адрес, состояние, дата мержа) из Forgejo через бэкенд: --url <адрес бэкенда> [--limit N] [--dry-run] [--out отчёт.json]; токен super-admin — в LORE_TOKEN; чужие репо — пропуск с причиной, повтор — 0 изменений' },
  { name: 'dst-fingerprint', module: () => import('./dst-fingerprint.mjs'), write: false, about: 'отпечаток содержимого новой базы — сверка двух переносов: одинаковые настройки и источник → одинаковый отпечаток (--out файл.json)' },
];

export function help() {
  const w = Math.max(...COMMANDS.map(c => c.name.length));
  return [
    `lore-migrate ${VERSION} — перенос базы LORE на новую модель`,
    '',
    'Запуск: lore-migrate <команда> --env <файл доступа> [--decisions <файл решений>] [ключи команды]',
    '',
    'Команды по шагам:',
    ...COMMANDS.map(c => `  ${c.name.padEnd(w)}  ${c.write ? '[пишет в новую базу] ' : ''}${c.about}`),
    '',
    'Файл доступа: строки КЛЮЧ=значение — MIG_DB_URL, MIG_SRC_DB, MIG_SRC_USER, MIG_SRC_PASSWORD,',
    '  MIG_DST_DB, MIG_DST_USER, MIG_DST_PASSWORD; необязательный MIG_DST_URL — сервер приёмника, если он другой.',
    '  Значения учёток нигде не печатаются.',
    'Источник только читается. Новая база не может быть рабочей и не может совпадать с источником.',
  ].join('\n');
}

/** Разбор строки запуска: команда, пути к файлам доступа и решений, остальные ключи — команде как есть. */
export function parseArgs(argv) {
  const rest = [];
  let command = null, env = null, decisions = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env' || a === '--decisions') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `после ${a} нужен путь к файлу` };
      if (a === '--env') env = path.resolve(v); else decisions = path.resolve(v);
    } else if (command === null && !a.startsWith('-')) command = a;
    else rest.push(a);
  }
  if (command === null) return rest.includes('--version') ? { version: true } : { help: true };
  if (command === 'help') return { help: true };
  const known = COMMANDS.find(c => c.name === command);
  if (!known) return { error: `команды «${command}» нет; есть: ${COMMANDS.map(c => c.name).join(', ')}` };
  if (!known.noEnv && !env && !process.env.MIG_ENV_FILE) return { error: 'не указан файл доступа: --env <файл>' };
  // MIG-01 (проба MDL-08, 20.11.2026): шаг связей без файла решений молча шёл «без решений» — вид продукта,
  // перегруппировка, задачи без спринта не применялись, а сверка говорила «без вида 17». Пишущая команда без него не идёт.
  if (known.write && !known.noDecisions && !decisions && !process.env.MIG_DECISIONS_FILE) return { error: `команда «${known.name}» пишет в новую базу по решениям человека (статусы, вид продукта, перегруппировка, задачи без спринта): нужен --decisions <файл решений>` };
  return { command: known, env, decisions, rest };
}

/** Файл решений указан, но его нет — ошибка с путём (loadDecisions без файла молча отдал бы «решений нет»). */
export function checkDecisionsFile(file) {
  return file && !fs.existsSync(file) ? `файла решений нет: ${file}` : null;
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  if (a.version) { console.log(VERSION); return 0; }
  if (a.help) { console.log(help()); return 0; }
  if (a.error) { console.error(a.error + '\n\n' + help()); return 2; }
  const noFile = a.command.write ? checkDecisionsFile(a.decisions || process.env.MIG_DECISIONS_FILE) : null;
  if (noFile) { console.error(noFile); return 2; }
  if (a.env) process.env.MIG_ENV_FILE = a.env;
  if (a.decisions) process.env.MIG_DECISIONS_FILE = a.decisions;
  // Сценарии читают свои ключи из строки запуска — подставляем её так, будто сценарий запущен напрямую.
  process.argv = [process.argv[0], a.command.name, ...a.rest];
  await a.command.module();
  return process.exitCode ?? 0;
}

const direct = process.argv[1] && /(^|[\\/])(cli\.mjs|lore-migrate[^\\/]*)$/.test(process.argv[1]);
if (direct || process.env.LORE_MIGRATE_MAIN === '1') {
  main().then(code => { process.exitCode = code; }, e => { console.error('ошибка: ' + e.message); process.exitCode = 1; });
}
