import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// Решение владелицы 09.11.2026 («перепиши правило — с разрешения человека»):
// справочник правит человек, но агент full может записать в него, если назвал,
// кто из людей разрешил. dict_set несёт это в заголовке X-Lore-Human-Approval —
// бэкенд решает по нему в AgentScopeFilter и пишет разрешение в журнал.
// Кириллица в заголовке HTTP недопустима, поэтому значение уходит URL-кодированным.

const calls: { path: string; body: unknown; headers?: Record<string, string> }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown, headers?: Record<string, string>) => {
    calls.push({ path, body, headers });
    return { ok: true };
  }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const dictSet = () => collect(registerLoreWrite).find((t) => t.name === 'dict_set')!;

describe('dict_set: разрешение человека', () => {
  beforeEach(() => { calls.length = 0; });

  it('разрешение уходит заголовком, URL-кодированным, и не попадает в тело', async () => {
    const who = 'omiloreadmin: канал minilore 09.11';
    await dictSet().handler({ dict_type: 'adr_status', code: 'DRAFT', human_approval: who });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toEqual({ 'X-Lore-Human-Approval': encodeURIComponent(who) });
    expect(JSON.stringify(calls[0].body)).not.toContain('human_approval');
  });

  it('без разрешения заголовка нет — запись идёт как раньше', async () => {
    await dictSet().handler({ dict_type: 'adr_status', code: 'DRAFT' });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers ?? {}).toEqual({});
  });
});
