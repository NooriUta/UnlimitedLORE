import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';
import { corePermission } from '../profile.js';

// SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI — инструмент «кто ты»: GET /lore/whoami как есть.
// Ответ сервера не пересобирается: что LORE видит в токене — то агент и читает.
// Ошибка (401 без токена, 502) — честный isError, а не пустой ответ.

const calls: string[] = [];
let impl: () => Promise<unknown> = async () => ({ kind: 'agent', profile: 'full', client_id: 'lore-mcp-full' });

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async () => ({ ok: true })),
  loreGet: vi.fn(async (path: string) => { calls.push(path); return impl(); }),
  loreUpload: vi.fn(async () => ({ ok: true })),
  loreSlices: vi.fn(async () => ({ slices: [] })),
  loreSliceWithMeta: vi.fn(async () => ({ rows: [] })),
}));

const { registerLoreRead } = await import('./loreRead.js');
const tool = () => {
  const t = collect((s) => registerLoreRead(s)).find((x) => x.name === 'whoami');
  if (!t) throw new Error('whoami не зарегистрирован');
  return t;
};
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

beforeEach(() => { calls.length = 0; });

describe('whoami', () => {
  it('зовёт GET /lore/whoami и отдаёт ответ сервера как есть', async () => {
    const r = await tool().handler({});
    expect(calls).toEqual(['/lore/whoami']);
    expect(JSON.parse(text(r))).toMatchObject({ kind: 'agent', profile: 'full', client_id: 'lore-mcp-full' });
  });

  it('отказ сервера — isError с текстом, а не пустой ответ', async () => {
    impl = async () => { throw new Error('GET /lore/whoami → 401 UNAUTHENTICATED'); };
    const r = await tool().handler({}) as { isError?: boolean };
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('401');
  });

  it('доступен read-only профилю core — это чтение', () => {
    expect(corePermission().whoami).toBe('allow');
  });
});
