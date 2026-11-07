import type { z } from 'zod';

// SPRINT_UXR_S0_SAFETY/S0-01 — описание контракта MCP-инструмента: форма входа
// (параметры схемы и их типы) и форма ответа (структура CallToolResult и JSON
// внутри text, без значений). Используется контрактным тестом contract.test.ts.

export type Shape = string | Shape[] | { [k: string]: Shape };
export type ToolContract = { input: Record<string, string>; output: Shape };
export type Contract = Record<string, ToolContract>;

type Def = {
  type: string;
  innerType?: z.ZodTypeAny;
  element?: z.ZodTypeAny;
  shape?: Record<string, z.ZodTypeAny>;
  options?: z.ZodTypeAny[];
  entries?: Record<string, string | number>;
  values?: unknown[];
  valueType?: z.ZodTypeAny;
  in?: z.ZodTypeAny;
};

const defOf = (t: z.ZodTypeAny): Def => (t as unknown as { def: Def }).def;

/** Тип zod-схемы одной строкой: `string?`, `enum(a|b)`, `{id:string,n:number?}[]`. */
export function describeType(t: z.ZodTypeAny): string {
  const d = defOf(t);
  switch (d.type) {
    case 'optional':
    case 'default':
    case 'prefault':
      return `${describeType(d.innerType!)}?`.replace(/\?\?$/, '?');
    case 'nullable':
      return `${describeType(d.innerType!)}|null`;
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return describeType(d.innerType!);
    case 'pipe':
      return describeType(d.in!);
    case 'enum':
      return `enum(${Object.values(d.entries ?? {}).map(String).sort().join('|')})`;
    case 'literal':
      return `literal(${(d.values ?? []).map(v => JSON.stringify(v)).join('|')})`;
    case 'array':
      return `${describeType(d.element!)}[]`;
    case 'object': {
      const shape = (t as unknown as { shape: Record<string, z.ZodTypeAny> }).shape ?? d.shape ?? {};
      return `{${Object.keys(shape).sort().map(k => `${k}:${describeType(shape[k])}`).join(',')}}`;
    }
    case 'union':
      return (d.options ?? []).map(describeType).sort().join(' | ');
    case 'record':
      return `record<${d.valueType ? describeType(d.valueType) : 'unknown'}>`;
    default:
      return d.type;
  }
}

export function describeInput(schema: Record<string, z.ZodTypeAny>): Record<string, string> {
  return Object.fromEntries(Object.keys(schema).sort().map(k => [k, describeType(schema[k])]));
}

/** Структура JSON без значений: ключи сортированы, массив — форма первого элемента. */
export function describeJson(v: unknown): Shape {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length === 0 ? [] : [describeJson(v[0])];
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, describeJson(o[k])]));
  }
  return typeof v;
}

/** Форма ответа инструмента: текст, который парсится как JSON, раскрывается в структуру. */
export function describeResult(res: unknown): Shape {
  if (!res || typeof res !== 'object') return describeJson(res);
  const r = res as { content?: unknown[]; isError?: boolean } & Record<string, unknown>;
  const out: Record<string, Shape> = {};
  for (const k of Object.keys(r).sort()) {
    if (k === 'content' && Array.isArray(r.content)) {
      out.content = r.content.map((c) => {
        const item = c as { type?: string; text?: unknown };
        if (item.type === 'text' && typeof item.text === 'string') {
          let text: Shape = '<text>';
          try { text = describeJson(JSON.parse(item.text)); } catch { /* не JSON — сообщение */ }
          return { type: 'text', text };
        }
        return describeJson(c);
      });
    } else if (k === 'isError') {
      // Значение, а не тип: «ответ стал ошибкой» — это и есть смена контракта.
      out.isError = String(r.isError);
    } else {
      out[k] = describeJson(r[k]);
    }
  }
  return out;
}

type Callable = { name: string; schema: Record<string, z.ZodTypeAny> };

export async function buildContract<T extends Callable>(tools: T[], call: (t: T) => Promise<unknown>): Promise<Contract> {
  const out: Contract = {};
  for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    let output: Shape;
    try { output = describeResult(await call(t)); } catch (e) { output = `<throws ${(e as Error).message}>`; }
    out[t.name] = { input: describeInput(t.schema), output };
  }
  return out;
}

const show = (s: unknown) => JSON.stringify(s);

/** Список расхождений «путь: было → стало»; пусто — контракт не изменился. */
export function diffContracts(expected: Contract, actual: Contract): string[] {
  const diff: string[] = [];
  for (const name of Object.keys(expected).sort()) {
    if (!(name in actual)) { diff.push(`${name}: инструмент пропал`); continue; }
    const e = expected[name], a = actual[name];
    for (const p of Object.keys(e.input).sort()) {
      if (!(p in a.input)) diff.push(`${name}.input.${p}: параметр пропал (был ${e.input[p]})`);
      else if (e.input[p] !== a.input[p]) diff.push(`${name}.input.${p}: тип ${e.input[p]} → ${a.input[p]}`);
    }
    for (const p of Object.keys(a.input).sort())
      if (!(p in e.input)) diff.push(`${name}.input.${p}: новый параметр ${a.input[p]}`);
    if (show(e.output) !== show(a.output)) diff.push(`${name}.output: ${show(e.output)} → ${show(a.output)}`);
  }
  for (const name of Object.keys(actual).sort())
    if (!(name in expected)) diff.push(`${name}: новый инструмент (нет в снимке)`);
  return diff;
}
