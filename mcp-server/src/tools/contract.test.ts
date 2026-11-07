import { readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { collect, variantsOf, type Tool } from './writeToolHarness.js';
import {
  buildContract,
  describeInput,
  describeResult,
  diffContracts,
  type Contract,
  type ToolContract,
} from './contract.js';

// SPRINT_UXR_S0_SAFETY/S0-01 — контрактный тест MCP.
//
// Зачем: агенты (и UI-справочник /lore?section=mcp) опираются на имена
// инструментов, их параметры и форму ответа. Переименованный параметр,
// пропавший инструмент или ответ, у которого исчезло поле, ломают вызывающих
// молча: ok:true приходит, а нужного ключа нет. Здесь каждый инструмент
// ВЫЗЫВАЕТСЯ (бэкенд подменён фиксированными ответами), ответ проверяется на
// соответствие CallToolResult, а форма входа и выхода сверяется со снимком
// contract.snapshot.json, который коммитится вместе с изменением.
//
// Намеренная правка контракта: UPDATE_MCP_CONTRACT=1 npx vitest run src/tools/contract.test.ts
// — снимок перезапишется, и его дифф попадёт в ревью PR как явное изменение API.

const SNAPSHOT_URL = new URL('./contract.snapshot.json', import.meta.url);

// Ответы бэкенда фиксированы и одинаковы для всех вызовов: снимок фиксирует
// то, что MCP делает с ответом (обёртка, пост-обработка, подсказки), а не
// данные прод-БД.
const CANNED = { ok: true, id: 'CONTRACT-ID', rows: [] as unknown[] };
let override: ((path: string) => unknown) | undefined;
const answer = (path: string) => (override ? override(path) : structuredClone(CANNED));

vi.mock('../backend.js', async (orig) => ({
  ...(await orig<typeof import('../backend.js')>()),
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string) => answer(path)),
  loreGet: vi.fn(async (path: string) => answer(path)),
  loreUpload: vi.fn(async (path: string) => answer(path)),
  loreSlices: vi.fn(async () => ({ slices: [] })),
  loreSlice: vi.fn(async () => [{ id: 'CONTRACT-ID', title: 'contract', content_md_ru: '# contract body' }]),
  loreSliceWithMeta: vi.fn(async () => ({ rows: [] })),
  muninnSlices: vi.fn(async () => ({ slices: [] })),
  muninnSlice: vi.fn(async () => ({ rows: [] })),
  muninnStatus: vi.fn(async () => ({ ok: true })),
}));

// claude_rules_* читают и пишут файлы по аргументу path — в тесте файловой
// системы не касаемся.
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => '# contract body'),
  writeFile: vi.fn(async () => undefined),
  access: vi.fn(async () => { throw new Error('ENOENT'); }),
}));

const FORGEJO_ENV = { LORE_FORGEJO: '1', FORGEJO_URL: 'http://forgejo.invalid', FORGEJO_TOKEN: 'x' } as NodeJS.ProcessEnv;

const { registerLoreRead } = await import('./loreRead.js');
const { registerLoreWrite } = await import('./loreWrite.js');
const { registerMuninn } = await import('./muninn.js');
const { registerClaudeRules } = await import('./claudeRules.js');
const { registerForgejo, forgejoConfigured } = await import('./forgejo.js');
const { registerVersion } = await import('./version.js');

/** Все инструменты, которые поднимает index.ts (forgejo_* — с заявленным мостом). */
function allTools(): Tool[] {
  return collect((s) => {
    registerLoreRead(s);
    registerLoreWrite(s);
    registerMuninn(s);
    registerClaudeRules(s);
    registerForgejo(s, FORGEJO_ENV);
    registerVersion(s);
  });
}

async function call(tool: Tool): Promise<unknown> {
  return tool.handler(variantsOf(tool)[0]);
}

function readSnapshot(): Contract | null {
  try { return JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8')) as Contract; } catch { return null; }
}

describe('MCP-контракт: все инструменты отвечают, форма не изменилась (S0-01)', () => {
  beforeEach(() => { override = undefined; });

  it('положительный контроль: собраны инструменты всех модулей, включая forgejo_*', () => {
    expect(forgejoConfigured(FORGEJO_ENV)).toBe(true);
    const names = allTools().map(t => t.name);
    expect(names.length).toBeGreaterThan(90);
    for (const n of ['query_slice', 'task_new', 'bench_status', 'claude_rules_pull', 'forgejo_ci_status', 'lore_version'])
      expect(names, `нет ${n}`).toContain(n);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('каждый инструмент отвечает валидным CallToolResult и не бросает', async () => {
    const broken: string[] = [];
    for (const tool of allTools()) {
      try {
        const res = await call(tool);
        const parsed = CallToolResultSchema.safeParse(res);
        if (!parsed.success) broken.push(`${tool.name}: не CallToolResult`);
        else if (parsed.data.content.length === 0) broken.push(`${tool.name}: пустой content`);
        // Бэкенд ответил ok — инструмент обязан вернуть успех, а не ошибку.
        else if (parsed.data.isError) broken.push(`${tool.name}: isError при ok-ответе бэкенда: ${JSON.stringify(parsed.data.content).slice(0, 200)}`);
      } catch (e) {
        broken.push(`${tool.name}: бросил ${(e as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('форма входа и ответа совпадает со снимком contract.snapshot.json', async () => {
    const actual = await buildContract(allTools(), call);
    if (process.env.UPDATE_MCP_CONTRACT === '1') {
      writeFileSync(SNAPSHOT_URL, JSON.stringify(actual, null, 2) + '\n', 'utf8');
    }
    const expected = readSnapshot();
    expect(expected, 'нет contract.snapshot.json — сгенерируйте: UPDATE_MCP_CONTRACT=1 npx vitest run src/tools/contract.test.ts').not.toBeNull();
    const diff = diffContracts(expected as Contract, actual);
    expect(diff, `контракт MCP изменился:\n${diff.join('\n')}\n` +
      'Если это намеренно — UPDATE_MCP_CONTRACT=1 npx vitest run src/tools/contract.test.ts и закоммитить снимок.').toEqual([]);
  });

  it('снимок построен детерминированно: два прогона дают одно и то же', async () => {
    const a = await buildContract(allTools(), call);
    const b = await buildContract(allTools(), call);
    expect(diffContracts(a, b)).toEqual([]);
  });

  // ── положительные контроли: сломанное поле обязано ловиться ──────────────

  it('положительный контроль: переименованное поле ОТВЕТА ловится', async () => {
    const tool = allTools().find(t => t.name === 'task_new')!;
    const good: ToolContract = { input: describeInput(tool.schema), output: describeResult(await call(tool)) };
    // Бэкенд (или пост-обработка MCP) отдал id под другим именем.
    override = () => ({ ok: true, idd: 'CONTRACT-ID', rows: [] });
    const bad: ToolContract = { input: describeInput(tool.schema), output: describeResult(await call(tool)) };
    const diff = diffContracts({ task_new: good }, { task_new: bad });
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.join('\n')).toMatch(/task_new.*output/);
  });

  it('положительный контроль: пропавший/переименованный ПАРАМЕТР и пропавший инструмент ловятся', async () => {
    const actual = await buildContract(allTools(), call);
    const broken: Contract = structuredClone(actual);
    const input = broken.task_new.input as Record<string, string>;
    expect(input.title, 'у task_new нет параметра title — контроль некорректен').toBeDefined();
    input.titel = input.title;
    delete input.title;
    delete broken.query_slice;
    const diff = diffContracts(actual, broken).join('\n');
    expect(diff).toMatch(/task_new\.input\.title/);
    expect(diff).toMatch(/query_slice/);
  });

  it('положительный контроль: ответ, ставший ошибкой, ловится', async () => {
    const tool = allTools().find(t => t.name === 'decision_new')!;
    const good: ToolContract = { input: describeInput(tool.schema), output: describeResult(await call(tool)) };
    override = () => { throw new Error('POST /lore/decision → 500'); };
    const bad: ToolContract = { input: describeInput(tool.schema), output: describeResult(await call(tool)) };
    expect(JSON.stringify(bad.output)).toContain('"isError":"true"');
    expect(diffContracts({ decision_new: good }, { decision_new: bad }).join('\n')).toMatch(/decision_new\.output/);
  });

  it('положительный контроль: смена ТИПА параметра ловится', async () => {
    const actual = await buildContract(allTools(), call);
    const broken: Contract = structuredClone(actual);
    const input = broken.task_new.input as Record<string, string>;
    input.title = 'number';
    expect(diffContracts(actual, broken).join('\n')).toMatch(/task_new\.input\.title/);
  });
});
