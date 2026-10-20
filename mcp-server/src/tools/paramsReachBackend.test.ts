import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Сторож «параметр принят схемой, но до бэкенда не дошёл».
//
// 20.10.2026: decision_new объявлял `project` в схеме («creates BELONGS_TO_PROJECT»),
// а функция body его не передавала. Бэкенд параметр поддерживает и рёбра
// создал бы — но не получал его. Ответ ok:true, ребра нет; так легли без
// проекта три решения за день, и заметно это стало только по quality_check.
//
// Проверка: каждый инструмент записи вызывается со ВСЕМИ параметрами схемы,
// заполненными узнаваемыми метками, lorePost подменён и пишет, что ушло.
// Каждая метка обязана встретиться в отправленном (путь или тело). Ветвящиеся
// инструменты (rel/action) зовутся по разу на каждое значение перечисления,
// и параметр считается дошедшим, если дошёл хоть в одной ветке.

const sent: { path: string; body: unknown }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async (path: string, params?: unknown) => { sent.push({ path, body: params }); return { ok: true, rows: [] }; }),
  loreUpload: vi.fn(async (...a: unknown[]) => { sent.push({ path: String(a[0]), body: a.slice(1) }); return { ok: true }; }),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

type Tool = { name: string; schema: Record<string, z.ZodTypeAny>; handler: (a: Record<string, unknown>) => Promise<unknown> };

function collect(): Tool[] {
  const tools: Tool[] = [];
  const server = {
    tool: (...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[args.length - 1] as Tool['handler'];
      const schema = args.find((a, i) => i > 0 && i < args.length - 1 && typeof a === 'object' && a !== null) as Tool['schema'] | undefined;
      tools.push({ name, schema: schema ?? {}, handler });
    },
  } as unknown as McpServer;
  registerLoreWrite(server);
  return tools;
}

function unwrap(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = t;
  for (let i = 0; i < 10; i++) {
    const d = (cur as unknown as { _def: { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny } })._def;
    if (d.innerType) cur = d.innerType; else if (d.schema) cur = d.schema; else break;
  }
  return cur;
}

const MARK = (k: string) => `PRM${k.replace(/[^a-z0-9]/gi, '')}X`;

/** Значение-метка по типу; для перечислений — все варианты (для ветвления). */
function values(key: string, t: z.ZodTypeAny): unknown[] {
  const u = unwrap(t);
  if (u instanceof z.ZodEnum) return [...(u.options as string[])];
  if (u instanceof z.ZodLiteral) return [u.value];
  if (u instanceof z.ZodNumber) return [7301];
  if (u instanceof z.ZodBoolean) return [true];
  if (u instanceof z.ZodArray) {
    const el = unwrap(u.element as unknown as z.ZodTypeAny);
    if (el instanceof z.ZodNumber) return [[7301]];
    if (el instanceof z.ZodObject) return [[Object.fromEntries(Object.keys(el.shape).map(k => [k, MARK(key)]))]];
    return [[MARK(key)]];
  }
  if (u instanceof z.ZodObject) return [Object.fromEntries(Object.keys(u.shape).map(k => [k, MARK(key)]))];
  return [MARK(key)];
}

describe('каждый параметр схемы записи доходит до бэкенда', () => {
  beforeEach(() => { sent.length = 0; });

  it('ни один инструмент записи не теряет параметр', async () => {
    const tools = collect();
    expect(tools.length).toBeGreaterThan(30);   // положительный контроль: инструменты собраны
    const lost: string[] = [];
    let checked = 0;

    for (const tool of tools) {
      const keys = Object.keys(tool.schema);
      if (keys.length === 0) continue;
      const enumKeys = keys.filter(k => { const u = unwrap(tool.schema[k]); return u instanceof z.ZodEnum || u instanceof z.ZodLiteral; });
      // Комбинации: каждая ветка перечисления по очереди, остальные — первым значением.
      const variants: Record<string, unknown>[] = [];
      const base = Object.fromEntries(keys.map(k => [k, values(k, tool.schema[k])[0]]));
      variants.push(base);
      for (const ek of enumKeys) for (const v of values(ek, tool.schema[ek]).slice(1)) variants.push({ ...base, [ek]: v });
      // Взаимоисключающие режимы (task_set: пакет tasks[] ИЛИ одиночные поля): массив
      // объектов, будучи передан, вытесняет остальное — пробуем и без него.
      for (const k of keys) if (Array.isArray(base[k])) { const { [k]: _drop, ...rest } = base; variants.push(rest); }

      const reached = new Set<string>();
      for (const args of variants) {
        sent.length = 0;
        try { await tool.handler(args); } catch { /* ветка с отказом валидации — не потеря */ }
        const wire = JSON.stringify(sent);
        for (const k of keys) {
          const v = args[k];
          const probe = MARK(k);
          if (v === undefined) continue;
          if (enumKeys.includes(k) || typeof v === 'boolean') {
            // Перечисления и флаги нередко превращаются в путь или выбор ветки — дошедшими
            // считаем, если что-то ушло вообще; иначе ложные срабатывания на rel/action.
            if (sent.length > 0) reached.add(k);
          } else if (typeof v === 'number' || (Array.isArray(v) && typeof v[0] === 'number')) {
            if (wire.includes('7301')) reached.add(k);
          } else if (wire.includes(probe)) {
            reached.add(k);
          }
        }
      }
      checked++;
      for (const k of keys) if (!reached.has(k)) lost.push(`${tool.name}.${k}`);
    }

    expect(checked).toBeGreaterThan(30);
    expect(lost).toEqual([]);
  });
});
