// SPRINT_LORE_MD_ARCHIVE/MDA-03 — project_export: выгрузка проекта LORE в локальную папку
// (папка .md под Obsidian, раскладка MDA-01). Сервер собирает архив (GET
// /lore/export/project/{owner}/{repo}?format=json — те же файлы, что в zip), инструмент
// раскладывает их на диск.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loreGet } from '../backend.js';

/**
 * Разложить файлы архива в `dir`.
 * - Непустая папка без `overwrite` — отказ: молчаливая перезапись чужих файлов хуже ошибки.
 * - С `overwrite` перезаписывается только верхняя папка архива (`LORE/<owner>__<repo>/`) —
 *   граница владения из MDA-01; свои заметки человека рядом не трогаются.
 * - Путь из ответа, выходящий за `dir`, — отказ (ответ сервера — данные, а не команда).
 */
export function writeVault(dir: string, files: Record<string, string>, overwrite: boolean): { written: number; root: string | null } {
  const base = resolve(dir);
  const targets = Object.keys(files).sort().map((p) => {
    if (isAbsolute(p) || p.startsWith('/') || p.startsWith('\\')) throw new Error(`путь «${p}» вне папки назначения — отказ`);
    const abs = resolve(base, p);
    const rel = relative(base, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`путь «${p}» вне папки назначения — отказ`);
    return { p, abs };
  });
  const roots = new Set(Object.keys(files).map((p) => p.split('/').slice(0, 2).join('/')));
  const root = roots.size === 1 ? [...roots][0] : null;

  if (existsSync(base) && readdirSync(base).length > 0) {
    if (!overwrite) throw new Error(`папка ${base} не пуста — укажите overwrite:true, чтобы перезаписать выгрузку`);
    for (const r of roots) {
      if (!r.startsWith('LORE/')) continue;
      rmSync(join(base, ...r.split('/')), { recursive: true, force: true });
    }
  }
  for (const { p, abs } of targets) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, files[p], 'utf8');
  }
  return { written: targets.length, root: root ? root.split('/').join(sep) : null };
}

interface ExportJson {
  project: string;
  root: string;
  counts: Record<string, number>;
  unreadable: Record<string, string>;
  hidden_by_rights: number;
  files: Record<string, string>;
}

export function registerProjectExport(server: McpServer, json: (v: unknown) => unknown, err: (e: unknown) => unknown): void {
  server.tool(
    'project_export',
    'Export a LORE project to a local folder as Obsidian-compatible Markdown (SPRINT_LORE_MD_ARCHIVE, GET /lore/export/project). ' +
      'Layout: <dir>/LORE/<owner>__<repo>/<type folder>/<ID>.md, tasks in tasks/<SPRINT_ID>/, links [[ID|type:ID]], current state only. ' +
      'A non-empty dir is refused unless overwrite:true; with overwrite only the LORE/<owner>__<repo>/ folder is replaced — your own notes next to it stay. ' +
      'READ the answer: unreadable{type: reason} means that type was NOT read (it is not empty); hidden_by_rights counts bodies hidden by your project rights. ' +
      'A project where you have no role → 403 PROJECT_FORBIDDEN; unknown project → 404.',
    {
      project: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).describe('git_project slug, e.g. "NooriUta/UnlimitedLORE"'),
      dir: z.string().min(1).describe('absolute path of the local folder to write into'),
      overwrite: z.boolean().optional().describe('replace a previous export in a non-empty folder (default false)'),
    },
    async ({ project, dir, overwrite }) => {
      try {
        const [owner, repo] = project.split('/');
        const res = (await loreGet(`/lore/export/project/${owner}/${repo}`, { format: 'json' })) as ExportJson;
        const w = writeVault(dir, res.files ?? {}, overwrite === true);
        return json({
          ok: true,
          path: w.root ? join(resolve(dir), w.root) : resolve(dir),
          files: w.written,
          counts: res.counts,
          unreadable: res.unreadable,
          hidden_by_rights: res.hidden_by_rights,
        });
      } catch (e) {
        return err(e);
      }
    },
  );
}
