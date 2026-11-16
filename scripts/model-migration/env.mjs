// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Доступ к базам переезда.
//
// Адрес, имена баз и учётки лежат в файле ВНЕ репозитория; путь к нему — в переменной MIG_ENV_FILE.
// Значения вписывает владелица. Код их читает и никуда не печатает: в ошибках и сводке — только имена
// ключей и слово «задан». Образец файла с пояснениями — в заметке задачи MIG-01.
//
// Сторожа: приёмник не может быть рабочей базой (system_aida_lore) и не может совпасть с источником —
// перенос пишет только в отдельную пустую базу.
import fs from 'node:fs';

export const KEYS = ['MIG_DB_URL', 'MIG_SRC_DB', 'MIG_SRC_USER', 'MIG_SRC_PASSWORD', 'MIG_DST_DB', 'MIG_DST_USER', 'MIG_DST_PASSWORD'];
const WORKING = new Set(['system_aida_lore']);
// Необязательный: приёмник на другом сервере (16.11.2026, приёмка на ryzenai: «базу относим в сторону»).
export const OPTIONAL = ['MIG_DST_URL'];
const norm = u => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
/** Адрес сервера приёмника: MIG_DST_URL, иначе тот же сервер, что у источника. */
export const dstUrl = env => (env.MIG_DST_URL && env.MIG_DST_URL.trim()) || env.MIG_DB_URL;

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function checkEnv(env) {
  const errs = KEYS.filter(k => !env[k]).map(k => `${k} не заполнен`);
  const src = (env.MIG_SRC_DB || '').toLowerCase(), dst = (env.MIG_DST_DB || '').toLowerCase();
  if (dst && WORKING.has(dst)) errs.push('MIG_DST_DB указывает на рабочую базу — перенос пишет только в отдельную пустую базу');
  if (dst && src && dst === src && norm(dstUrl(env)) === norm(env.MIG_DB_URL)) errs.push('MIG_DST_DB совпадает с MIG_SRC_DB на том же сервере — источник только читается');
  return errs;
}

/** Что задано — без значений секретов. */
export function summary(env) {
  return { ...Object.fromEntries(KEYS.map(k => [k, !env[k] ? 'пусто' : /PASSWORD/.test(k) ? 'задан' : env[k]])), MIG_DST_URL: env.MIG_DST_URL || 'тот же, что MIG_DB_URL' };
}

export function loadEnv(file = process.env.MIG_ENV_FILE) {
  if (!file) throw new Error('MIG_ENV_FILE не задан: путь к файлу доступа вне репозитория');
  if (!fs.existsSync(file)) throw new Error(`файл доступа не найден: ${file}`);
  const env = parseEnv(fs.readFileSync(file, 'utf8'));
  const errs = checkEnv(env);
  if (errs.length) throw new Error('файл доступа: ' + errs.join('; '));
  return env;
}

if (process.argv[1] && process.argv[1].endsWith('env.mjs')) {
  try { console.log(JSON.stringify(summary(loadEnv()), null, 2)); } catch (e) { console.error(e.message); process.exit(1); }
}
