import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Обвязка тестов, которые зовут инструменты записи «вслепую», со всеми
// параметрами схемы. Подмену backend.js (vi.mock) делает сам тест — vitest
// поднимает vi.mock только в файле теста, из общего модуля она не сработает.

export type Tool = {
  name: string;
  description?: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (a: Record<string, unknown>) => Promise<unknown>;
};

/** Собирает инструменты, которые register… регистрирует на поддельном сервере. */
export function collect(register: (s: McpServer) => void): Tool[] {
  const tools: Tool[] = [];
  const server = {
    tool: (...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[args.length - 1] as Tool['handler'];
      const description = typeof args[1] === 'string' ? (args[1] as string) : undefined;
      const schema = args.find((a, i) => i > 0 && i < args.length - 1 && typeof a === 'object' && a !== null) as Tool['schema'] | undefined;
      tools.push({ name, description, schema: schema ?? {}, handler });
    },
  } as unknown as McpServer;
  register(server);
  return tools;
}

export function unwrap(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = t;
  for (let i = 0; i < 10; i++) {
    const d = (cur as unknown as { _def: { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny } })._def;
    if (d.innerType) cur = d.innerType; else if (d.schema) cur = d.schema; else break;
  }
  return cur;
}

export const MARK = (k: string) => `PRM${k.replace(/[^a-z0-9]/gi, '')}X`;
export const NUM = 7301;

/** Значение-метка по типу; для перечислений — все варианты (для ветвления). */
export function values(key: string, t: z.ZodTypeAny): unknown[] {
  const u = unwrap(t);
  if (u instanceof z.ZodEnum) return [...(u.options as string[])];
  if (u instanceof z.ZodLiteral) return [u.value];
  if (u instanceof z.ZodNumber) return [NUM];
  if (u instanceof z.ZodBoolean) return [true];
  // Record-параметры диспетчеров (entity_upsert/entity_link/entity_move): непустая
  // запись с project — иначе project-guard отказывает ДО сети и ветка не снимается.
  if (u instanceof z.ZodRecord) return [{ project: MARK(key) }];
  if (u instanceof z.ZodArray) {
    const el = unwrap(u.element as unknown as z.ZodTypeAny);
    if (el instanceof z.ZodNumber) return [[NUM]];
    if (el instanceof z.ZodObject) return [[Object.fromEntries(Object.keys(el.shape).map(k => [k, MARK(key)]))]];
    return [[MARK(key)]];
  }
  if (u instanceof z.ZodObject) return [Object.fromEntries(Object.keys(u.shape).map(k => [k, MARK(key)]))];
  return [MARK(key)];
}

export function isEnum(t: z.ZodTypeAny): boolean {
  const u = unwrap(t);
  return u instanceof z.ZodEnum || u instanceof z.ZodLiteral;
}

/** Record-параметр (свободная запись fields у entity_*-диспетчеров): ключи определяет бэкенд. */
export function isRecord(t: z.ZodTypeAny): boolean {
  return unwrap(t) instanceof z.ZodRecord;
}

/**
 * Наборы аргументов, покрывающие ветки инструмента: базовый (всё заполнено,
 * перечисления первым значением), ДЕКАРТОВО ПРОИЗВЕДЕНИЕ значений всех
 * перечислений (ветки диспетчеров живут на ПАРАХ вида (type, rel) — по одному
 * значению на ключ их не достать), и без каждого массива — взаимоисключающие
 * режимы (task_set: пакет tasks[] ИЛИ одиночные поля), где массив вытесняет
 * остальное.
 */
export function variantsOf(tool: Tool): Record<string, unknown>[] {
  const keys = Object.keys(tool.schema);
  const base = Object.fromEntries(keys.map(k => [k, values(k, tool.schema[k])[0]]));
  let out: Record<string, unknown>[] = [base];
  for (const k of keys.filter(k => isEnum(tool.schema[k]))) {
    const vals = values(k, tool.schema[k]);
    if (vals.length < 2) continue;
    out = out.flatMap(v => vals.map(val => ({ ...v, [k]: val })));
  }
  for (const k of keys) if (Array.isArray(base[k])) {
    const rest = { ...base };
    delete rest[k];
    out.push(rest);
  }
  return out;
}
