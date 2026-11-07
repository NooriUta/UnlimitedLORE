import { describe, expect, it } from 'vitest';

// T36 (SPRINT_LORE_UX_OPTIMIZATION): справочник /lore?section=mcp ведётся руками
// и отставал от сервера (60 записей при 98 зарегистрированных инструментах).
// Гвард: каждый инструмент, который регистрирует mcp-server/src/tools/*.ts,
// обязан иметь запись в TOOLS экрана LoreMcpApiScreen. bench_* (muninn.ts)
// документируются на /benchmark?tab=mcp и сюда не входят.

const SERVER_SRC = import.meta.glob(
  [
    '../../../mcp-server/src/tools/*.ts',
    '!../../../mcp-server/src/tools/*.test.ts',
    '!../../../mcp-server/src/tools/writeToolHarness.ts',
    '!../../../mcp-server/src/tools/strictTool.ts',
    '!../../../mcp-server/src/tools/muninn.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const SCREEN_SRC = import.meta.glob('./LoreMcpApiScreen.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Две формы регистрации: `server.tool(\n    'name',` и объект `definePostTool(server, {\n    name: 'name',`. */
function serverToolNames(): string[] {
  const names = new Set<string>();
  for (const src of Object.values(SERVER_SRC)) {
    for (const m of src.matchAll(/server\.tool\(\s*'([a-z0-9_]+)'/g)) names.add(m[1]);
    // `name:` с отступом ровно в 4 пробела и запятой в конце строки — поле объекта
    // регистрации; строки внутри description/schema так не выглядят.
    for (const m of src.matchAll(/^ {4}name: '([a-z0-9_]+)',$/gm)) names.add(m[1]);
  }
  return [...names].sort();
}

function screenToolNames(): string[] {
  const src = Object.values(SCREEN_SRC)[0] ?? '';
  return [...src.matchAll(/^ {2}\{ name: '([a-z0-9_]+)'/gm)].map(m => m[1]).sort();
}

describe('экран MCP API — полнота справочника инструментов', () => {
  it('положительный контроль: разбор исходников сервера реально находит инструменты', () => {
    const names = serverToolNames();
    expect(Object.keys(SERVER_SRC).length).toBeGreaterThanOrEqual(4);
    expect(names.length).toBeGreaterThan(60);
    expect(names).toContain('task_new');   // форма definePostTool
    expect(names).toContain('uc_new');
    expect(names).toContain('query_slice'); // форма server.tool
    expect(names.some(n => n.startsWith('bench_'))).toBe(false);
  });

  it('положительный контроль: разбор экрана находит записи TOOLS', () => {
    const names = screenToolNames();
    expect(names.length).toBeGreaterThanOrEqual(60);
    expect(names).toContain('list_slices');
  });

  it('каждый инструмент сервера описан в TOOLS экрана', () => {
    const screen = new Set(screenToolNames());
    const missing = serverToolNames().filter(n => !screen.has(n));
    expect(missing, `нет на экране MCP API: ${missing.join(', ')}`).toEqual([]);
  });

  it('на экране нет записей об инструментах, которых сервер не регистрирует', () => {
    const server = new Set(serverToolNames());
    const stale = screenToolNames().filter(n => !server.has(n));
    expect(stale, `лишние на экране MCP API: ${stale.join(', ')}`).toEqual([]);
  });

  it('имена в TOOLS не повторяются', () => {
    const names = screenToolNames();
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

// SPRINT_UXR_S0_SAFETY/S0-01: контрактный снимок MCP (mcp-server/src/tools/contract.snapshot.json)
// фиксирует параметры и форму ответа каждого инструмента; сверку с живым кодом
// делает mcp-server/src/tools/contract.test.ts. Здесь — что снимок, экран и
// сервер говорят об ОДНОМ наборе инструментов: инструмент, попавший на экран
// мимо снимка, ушёл бы в API без зафиксированного контракта.
const CONTRACT_SRC = import.meta.glob('../../../mcp-server/src/tools/contract.snapshot.json', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

type ContractEntry = { input: Record<string, string>; output: unknown };

function contract(): Record<string, ContractEntry> {
  const raw = Object.values(CONTRACT_SRC)[0];
  return raw ? (JSON.parse(raw) as Record<string, ContractEntry>) : {};
}

/** Инструменты снимка без bench_* — они документируются на /benchmark?tab=mcp. */
const contractToolNames = () => Object.keys(contract()).filter(n => !n.startsWith('bench_')).sort();

describe('экран MCP API — контрактный снимок MCP (S0-01)', () => {
  it('положительный контроль: снимок найден и несёт вход и форму ответа', () => {
    const c = contract();
    expect(Object.keys(CONTRACT_SRC)).toHaveLength(1);
    expect(Object.keys(c).length).toBeGreaterThan(60);
    expect(c.task_new?.input.sprint_id).toBe('string');
    expect(JSON.stringify(c.query_slice?.output)).toContain('"type":"text"');
  });

  it('каждый инструмент сервера зафиксирован в контрактном снимке', () => {
    const inContract = new Set(contractToolNames());
    const missing = serverToolNames().filter(n => !inContract.has(n));
    expect(missing, `нет в contract.snapshot.json (UPDATE_MCP_CONTRACT=1 в mcp-server): ${missing.join(', ')}`).toEqual([]);
  });

  it('каждый инструмент снимка описан на экране', () => {
    const screen = new Set(screenToolNames());
    const undocumented = contractToolNames().filter(n => !screen.has(n));
    expect(undocumented, `нет на экране MCP API: ${undocumented.join(', ')}`).toEqual([]);
  });
});
