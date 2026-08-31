import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile, writeFile, access } from 'node:fs/promises';
import { lorePost, loreSlice } from '../backend.js';

/**
 * Загрузка и выгрузка правил CLAUDE между локальным файлом и LORE.
 *
 * ЗАЧЕМ. Решение владельца 29.08.2026: `CLAUDE.md` убран из репозитория
 * UnlimitedLORE — ветка `main` зеркалируется в публичный GitHub, и внутренние
 * правила (адреса стенда, порядок доступа, имена секретов, предавторизации)
 * уезжали туда вместе с кодом. Правила переехали в LORE.
 *
 * Но переезд без инструментов оставляет дыру: правила есть, а положить их туда
 * и достать обратно нечем. Раньше это делалось вручную — прочитать файл,
 * вставить тело в `doc_new`, не забыть kind и родителя. Ручной перенос текста
 * между двумя местами всегда заканчивается расхождением: одно из мест правят,
 * второе забывают. Эти два инструмента убирают ручной шаг.
 *
 * ИМЕНОВАНИЕ — соглашение, а не выдумка на месте: родитель `claude_rules`,
 * машина `claude_rules_global`, проект `claude_rules_<slug>`. Проверено по
 * корпусу 29.08.2026 — восемь доков уже лежат именно так.
 */

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const err = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
});

const PARENT_DOC = 'claude_rules';

/** Правила пишутся по-русски и лежат в русском теле — как все восемь существующих доков. */
type DocRow = { doc_id?: string; title?: string; content_md_ru?: string | null; content_md_en?: string | null };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function registerClaudeRules(server: McpServer): void {
  server.tool(
    'claude_rules_push',
    'Load a local CLAUDE.md into LORE as a claude-rules doc (upsert). Reads the file from disk ' +
      'and stores its body, so the text is never re-typed by hand. Use doc_id "claude_rules_global" ' +
      'for the machine-wide rules and "claude_rules_<project>" for a repository. ' +
      'The doc is filed under the "claude_rules" parent and shows up in the LORE admin panel ' +
      '(Справочники → Правила CLAUDE).',
    {
      path: z.string().describe('Absolute path to the CLAUDE.md to upload, e.g. "C:/AIDA/UnlimitedLORE/CLAUDE.md"'),
      doc_id: z.string().describe('Target doc id: "claude_rules_global" or "claude_rules_<project>"'),
      title: z.string().optional().describe('Required the first time a doc is created; omit to keep the existing title'),
      sort_order: z.number().int().optional().describe('Position among sibling rule docs in the panel'),
    },
    async ({ path, doc_id, title, sort_order }) => {
      try {
        // Читаем ДО записи: несуществующий путь должен дать внятный отказ, а не
        // затереть док пустым телом. Пустые правила выглядят как «правил нет».
        const body = await readFile(path, 'utf8');
        if (!body.trim()) {
          return err(new Error(`файл ${path} пуст — загрузка отменена: пустой док правил неотличим от их отсутствия`));
        }
        const res = await lorePost('/lore/doc', {
          doc_id,
          title: title ?? null,
          kind: 'claude-rules',
          parent_doc_id: PARENT_DOC,
          content_md_ru: body,
          sort_order: sort_order ?? null,
        });
        return json({ ...(res as object), bytes: Buffer.byteLength(body, 'utf8'), from: path });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'claude_rules_pull',
    'Fetch a claude-rules doc from LORE. With `path` it writes the Markdown to that file ' +
      '(this is how a fresh session gets the project rules now that CLAUDE.md is no longer in the ' +
      'repository); without `path` it just returns the text. ' +
      'Use query_slice({slice:"docs",params:{kind:"claude-rules"}}) to see what rule docs exist.',
    {
      doc_id: z.string().describe('Doc id, e.g. "claude_rules_unlimitedlore" or "claude_rules_global"'),
      path: z.string().optional().describe('Where to write the file; omit to return the text instead'),
      overwrite: z.boolean().optional().describe('Allow replacing an existing file (default false)'),
    },
    async ({ doc_id, path, overwrite }) => {
      try {
        const rows = (await loreSlice('doc_by_id', { id: doc_id })) as DocRow[];
        if (!Array.isArray(rows) || rows.length === 0) {
          return err(new Error(`док ${doc_id} не найден — проверьте id через query_slice docs kind=claude-rules`));
        }
        const doc = rows[0];
        const body = doc.content_md_ru ?? doc.content_md_en ?? '';
        if (!body.trim()) {
          // Пустое тело — это НЕ «правил нет», это сломанный док. Записать такое
          // в файл значило бы молча стереть рабочие правила на диске.
          return err(new Error(`док ${doc_id} есть, но тело пустое — на диск не пишу, иначе затру рабочие правила`));
        }
        if (!path) return json({ doc_id, title: doc.title, content_md: body });

        if (!overwrite && (await exists(path))) {
          return err(new Error(
            `${path} уже существует. Перезапись правил — потеря локальных правок, которые могли не уехать в LORE. ` +
            `Передайте overwrite:true, если это осознанно.`));
        }
        await writeFile(path, body, 'utf8');
        return json({ doc_id, written: path, bytes: Buffer.byteLength(body, 'utf8') });
      } catch (e) {
        return err(e);
      }
    },
  );
}
