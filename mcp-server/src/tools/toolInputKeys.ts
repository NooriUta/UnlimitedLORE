import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// MT-MCP-TRUTH (случай 13.11): ключи входной схемы каждого зарегистрированного инструмента.
// entity_upsert принимает fields свободной записью и сверяет их со схемой заменённого
// инструмента — иначе поле, которого у сущности нет, бэкенд молча отбрасывает, а ответ ok:true.
export const TOOL_INPUT_KEYS = new Map<string, Set<string>>();

/** Сервер-обёртка: запоминает ключи схемы при регистрации и передаёт вызов дальше без изменений. */
export function recordingInputKeys(server: McpServer): McpServer {
  const orig = server.tool.bind(server) as (...a: unknown[]) => unknown;
  return new Proxy(server, {
    get(target, prop, recv) {
      if (prop !== 'tool') return Reflect.get(target, prop, recv);
      return (...args: unknown[]) => {
        const schema = args.find((a, i) => i > 0 && i < args.length - 1 && typeof a === 'object' && a !== null);
        if (typeof args[0] === 'string' && schema) TOOL_INPUT_KEYS.set(args[0], new Set(Object.keys(schema as object)));
        return orig(...args);
      };
    },
  });
}

/** Служебные ключи entity_upsert, которые едут не в тело (проект — отдельной связью, разрешение — заголовком). */
const SERVICE_KEYS = new Set(['project', 'human_approval']);

/** Поля, которых нет ни в одной схеме заменённых инструментов; схема неизвестна — проверки нет (undefined). */
export function ignoredFields(replaces: readonly string[] | undefined, fields: Record<string, unknown>, extra: readonly string[] = []): string[] | undefined {
  const known = new Set<string>([...SERVICE_KEYS, ...extra]);
  let any = false;
  for (const name of replaces ?? []) {
    const keys = TOOL_INPUT_KEYS.get(name);
    if (!keys) continue;
    any = true;
    for (const k of keys) known.add(k);
  }
  if (!any) return undefined;
  const out = Object.keys(fields).filter(k => !known.has(k)).sort();
  return out.length ? out : undefined;
}
