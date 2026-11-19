import { readFile, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, relative, resolve } from 'node:path';

// Тело документа из локального файла (doc_new, entity_upsert type=doc; решение владелицы 19.11.2026,
// вариант «а»). Агенту не нужно тащить многосоткилобайтный текст через аргумент инструмента: он
// передаёт путь, MCP читает файл сам.
//
// Безопасность:
//  - читаются только файлы внутри корней LORE_MCP_FILE_ROOTS (через path.delimiter: «;» на Windows,
//    «:» на POSIX), по умолчанию — рабочая папка процесса MCP;
//  - сверка идёт после realpath и пути, и корня — симлинк/junction за корень не уводит;
//  - предел 20 МБ проверяется до чтения;
//  - содержимое файла не пишется ни в журнал, ни в текст ошибок — только путь и размер;
//  - в режиме по адресу хоста (LORE_MCP_TRANSPORT=http) файлы клиента серверу недоступны —
//    отказ, ничего не читается (иначе прочли бы файл сервера по пути клиента).

export const MAX_BODY_FILE_BYTES = 20 * 1024 * 1024;

/** Поля тела, у которых есть *_file-двойник. */
export const DOC_BODY_FIELDS = ['content_html', 'content_md_ru', 'content_md_en'] as const;

export const FILE_SUFFIX = '_file';

export const HOSTED_FILE_REFUSAL =
  'в режиме по адресу хоста файл клиента недоступен — передайте содержимое полем или используйте локальный MCP';

/** Описание *_file-параметра для схемы (одно на все, чтобы не разъехались). */
export function bodyFileDescription(field: string): string {
  return `Absolute path to a UTF-8 file whose content is sent as ${field} (read by the MCP server process on ITS ` +
    `machine). Allowed only inside LORE_MCP_FILE_ROOTS (separated by ";" on Windows, ":" elsewhere; default — ` +
    `the MCP process working directory), checked after realpath (symlinks cannot escape), max 20 MB. ` +
    `Mutually exclusive with ${field}. NOT available when the MCP runs on the LORE host (LORE_MCP_TRANSPORT=http): ` +
    `the server cannot see client files — pass ${field} inline or use a local MCP.`;
}

class BodyFileError extends Error {}

function fileRoots(env: NodeJS.ProcessEnv): string[] {
  const raw = (env.LORE_MCP_FILE_ROOTS ?? '').split(delimiter).map(s => s.trim()).filter(Boolean);
  return raw.length ? raw.map(r => resolve(r)) : [process.cwd()];
}

const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

function inside(root: string, file: string): boolean {
  const rel = relative(norm(root), norm(file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

async function readBodyFile(param: string, path: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (!isAbsolute(path)) throw new BodyFileError(`${param}: нужен абсолютный путь, получено «${path}»`);
  let real: string;
  try { real = await realpath(path); } catch (e) {
    throw new BodyFileError(`${param}: файл «${path}» не найден или недоступен (${(e as NodeJS.ErrnoException).code ?? 'ошибка'})`);
  }
  const roots: string[] = [];
  for (const r of fileRoots(env)) {
    try { roots.push(await realpath(r)); } catch { /* несуществующий корень ничего не разрешает */ }
  }
  if (!roots.some(r => inside(r, real))) {
    throw new BodyFileError(`${param}: «${path}» вне разрешённых корней LORE_MCP_FILE_ROOTS ` +
      `(${roots.length ? roots.join(delimiter) : 'ни одного существующего'}) — положите файл в корень или добавьте корень в LORE_MCP_FILE_ROOTS`);
  }
  const st = await stat(real);
  if (!st.isFile()) throw new BodyFileError(`${param}: «${path}» — не обычный файл`);
  if (st.size > MAX_BODY_FILE_BYTES) {
    throw new BodyFileError(`${param}: файл «${path}» — ${st.size} байт, предел 20 МБ (${MAX_BODY_FILE_BYTES} байт)`);
  }
  const buf = await readFile(real);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {
    throw new BodyFileError(`${param}: файл «${path}» не в UTF-8 — пересохраните его в UTF-8`);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Подставляет содержимое *_file-полей в их поля тела. Возвращает новые поля (без *_file) или текст
 * отказа. Если ни одного *_file нет — поля возвращаются как есть.
 */
export async function resolveBodyFiles(
  fields: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown> | string> {
  const asked = DOC_BODY_FIELDS.filter(f => fields[f + FILE_SUFFIX] !== undefined && fields[f + FILE_SUFFIX] !== null);
  if (asked.length === 0) {
    // null-значения *_file тоже не уходят в бэкенд.
    const out = { ...fields };
    for (const f of DOC_BODY_FIELDS) delete out[f + FILE_SUFFIX];
    return out;
  }
  for (const f of asked) {
    if (fields[f] !== undefined && fields[f] !== null) {
      return `нельзя передать ${f} и ${f}${FILE_SUFFIX} одновременно — оставьте одно из двух`;
    }
    if (typeof fields[f + FILE_SUFFIX] !== 'string') return `${f}${FILE_SUFFIX}: ожидается строка-путь`;
  }
  if ((env.LORE_MCP_TRANSPORT ?? '').trim().toLowerCase() === 'http') {
    return `${asked.map(f => f + FILE_SUFFIX).join(', ')}: ${HOSTED_FILE_REFUSAL}`;
  }
  const out = { ...fields };
  try {
    for (const f of asked) {
      out[f] = await readBodyFile(f + FILE_SUFFIX, fields[f + FILE_SUFFIX] as string, env);
    }
  } catch (e) {
    if (e instanceof BodyFileError) return e.message;
    return `${asked.map(f => f + FILE_SUFFIX).join(', ')}: не удалось прочитать файл (${(e as NodeJS.ErrnoException).code ?? 'ошибка'})`;
  }
  for (const f of DOC_BODY_FIELDS) delete out[f + FILE_SUFFIX];
  return out;
}
