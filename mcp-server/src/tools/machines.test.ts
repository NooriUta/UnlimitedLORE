import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_UXR_S7B_ADMIN/S7B-ACL-2 · S7B-ACL-3 — машины и допуски из MCP, а не только из админки
// (приоритет 0 владелицы 11.11.2026: «harness и машины, как через UI админки, так и через MCP»).
//
// Чтение: machine_acl (срез machine_acl), harness_list (справочник harness).
// Запись: machine_access_set (POST /lore/user/machine-access), machine_owner_set
// (POST /lore/actor + /lore/actor/owner, как bindKcClient в web-next/src/admin/wizards.ts).
// Агенту запись запрещена сервером (ADR-MINILORE-007; "user" и "actor/owner" закрыты
// AgentScopeFilter) — инструмент НЕ обходит и не глушит отказ: ответ сервера идёт как есть.

type Call = { method: 'GET' | 'POST'; path: string; body?: unknown; params?: Record<string, string> };
const calls: Call[] = [];
let postImpl: (path: string, body: unknown) => Promise<unknown> = async () => ({ ok: true });
let sliceRows: unknown[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => {
    calls.push({ method: 'POST', path, body });
    return postImpl(path, body);
  }),
  loreGet: vi.fn(async (path: string, params?: Record<string, string>) => {
    calls.push({ method: 'GET', path, params });
    return { rows: sliceRows };
  }),
  loreUpload: vi.fn(async () => ({ ok: true })),
  loreSlices: vi.fn(async () => ({ slices: [] })),
  loreSliceWithMeta: vi.fn(async (slice: string, params?: Record<string, string>) => {
    calls.push({ method: 'GET', path: `/lore/slice/${slice}`, params });
    return { rows: sliceRows };
  }),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const { registerLoreRead } = await import('./loreRead.js');
const tool = (name: string) => {
  const t = collect((s) => { registerLoreRead(s); registerLoreWrite(s); }).find((x) => x.name === name);
  if (!t) throw new Error(`инструмент ${name} не зарегистрирован`);
  return t;
};
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;

const FORBIDDEN = 'POST /lore/user/machine-access → 403 {"code":"AGENT_SCOPE_FORBIDDEN","message":"agent scope \'full\' may not write /lore/user/machine-access"}';

beforeEach(() => {
  calls.length = 0;
  postImpl = async () => ({ ok: true });
  sliceRows = [];
});

describe('machine_acl — кто допущен к машине / к каким машинам допущен человек', () => {
  it('по machine_id — срез machine_acl с client_id minilore-link-<machine_id>', async () => {
    await tool('machine_acl').handler({ machine_id: 'lorcetus' });
    expect(calls).toEqual([{ method: 'GET', path: '/lore/slice/machine_acl', params: { client_id: 'minilore-link-lorcetus' } }]);
  });

  it('по kc_sub — машины человека; client_id передаётся как есть', async () => {
    await tool('machine_acl').handler({ kc_sub: 'sub-1' });
    expect(calls[0].params).toEqual({ kc_sub: 'sub-1' });
    calls.length = 0;
    await tool('machine_acl').handler({ client_id: 'minilore-link-x' });
    expect(calls[0].params).toEqual({ client_id: 'minilore-link-x' });
  });

  it('machine_id и расходящийся client_id — machine_id главнее, расхождение названо в _warning', async () => {
    const r = await tool('machine_acl').handler({ machine_id: 'a', client_id: 'minilore-link-b' });
    expect(isError(r)).toBe(false);
    expect(calls[0].params).toEqual({ client_id: 'minilore-link-a' });
    expect(JSON.parse(text(r))._warning).toMatch(/minilore-link-b.*ignored/);
  });

  it('строки отдаются как есть', async () => {
    sliceRows = [{ client_id: 'minilore-link-lorcetus', grant_kc_subs: ['sub-1'] }];
    const r = await tool('machine_acl').handler({ machine_id: 'lorcetus' });
    expect(JSON.parse(text(r))).toEqual(sliceRows);
  });
});

describe('harness_list — справочник harness', () => {
  it('читает срез dictionary с dict_type=harness', async () => {
    await tool('harness_list').handler({});
    expect(calls).toEqual([{ method: 'GET', path: '/lore/slice/dictionary', params: { dict_type: 'harness' } }]);
  });
});

describe('machine_access_set — выдать / изменить / снять допуск', () => {
  it('grant: тело запроса совпадает с MachineAccessRequest сервера', async () => {
    await tool('machine_access_set').handler({
      machine_id: 'lorcetus', kc_sub: 'sub-1', action: 'grant', role: 'actor',
      projects: ['AIDA/UnlimitedLORE'], harnesses: ['claude-code'], display_name: 'Аня',
    });
    expect(calls).toEqual([{ method: 'POST', path: '/lore/user/machine-access', body: {
      machine_id: 'lorcetus', kc_sub: 'sub-1', action: 'grant', role: 'actor',
      projects: ['AIDA/UnlimitedLORE'], harnesses: ['claude-code'], display_name: 'Аня',
    } }]);
  });

  it('dry_run уходит на сервер, план возвращается как есть', async () => {
    postImpl = async () => ({ machine_id: 'lorcetus', ok: true, dry_run: true, applied: 0, plan: { kind: 'grant' } });
    const r = await tool('machine_access_set').handler({ machine_id: 'lorcetus', kc_sub: 'sub-1', action: 'grant', role: 'viewer', dry_run: true });
    expect((calls[0].body as { dry_run: boolean }).dry_run).toBe(true);
    expect(JSON.parse(text(r)).plan).toEqual({ kind: 'grant' });
  });

  it('revoke: роль, проекты и harness не нужны и не шлются', async () => {
    await tool('machine_access_set').handler({ machine_id: 'lorcetus', kc_sub: 'sub-1', action: 'revoke' });
    expect(calls[0].body).toEqual({ machine_id: 'lorcetus', kc_sub: 'sub-1', action: 'revoke' });
  });

  it('отказ сервера (агент) передаётся как есть — с кодом и причиной', async () => {
    postImpl = async () => { throw new Error(FORBIDDEN); };
    const r = await tool('machine_access_set').handler({ machine_id: 'lorcetus', kc_sub: 'sub-1', action: 'grant', role: 'actor' });
    expect(isError(r)).toBe(true);
    expect(text(r)).toContain('403');
    expect(text(r)).toContain('AGENT_SCOPE_FORBIDDEN');
    expect(text(r)).toContain("may not write /lore/user/machine-access");
  });

  it('описание прямо говорит, что агенту запись запрещена', () => {
    expect(tool('machine_access_set').description).toMatch(/agent.*(cannot|refus)/i);
  });
});

describe('machine_owner_set — машинная учётка → человек (owner, профиль, машина)', () => {
  it('актор есть: одна запись владельца, тело как у bindKcClient', async () => {
    await tool('machine_owner_set').handler({
      client_id: 'minilore-link-lorcetus', kc_sub: 'sub-1', profile: 'full', machine_id: 'lorcetus', harness: 'claude-code',
    });
    expect(calls).toEqual([{ method: 'POST', path: '/lore/actor/owner', body: {
      actor_id: 'minilore-link-lorcetus', client_id: 'minilore-link-lorcetus', kc_sub: 'sub-1',
      agent_role: 'full', machine_id: 'lorcetus', harness: 'claude-code',
    } }]);
  });

  it('отказ сервера (агент, 403) — как есть, и ничего больше не пишется (актор не заводится)', async () => {
    postImpl = async (path) => {
      throw new Error(`POST ${path} → 403 {"code":"AGENT_SCOPE_FORBIDDEN","message":"agent scope 'full' may not write /lore/actor/owner"}`);
    };
    const r = await tool('machine_owner_set').handler({ client_id: 'lore-mcp-x', kc_sub: 'sub-1' });
    expect(isError(r)).toBe(true);
    expect(text(r)).toContain('AGENT_SCOPE_FORBIDDEN');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/lore/actor/owner']);
  });

  it('актора нет (400): заводит /lore/actor kind=agent и повторяет привязку', async () => {
    let first = true;
    postImpl = async (path) => {
      if (path === '/lore/actor/owner' && first) {
        first = false;
        throw new Error('POST /lore/actor/owner → 400 {"code":"BAD_PARAMS","message":"actor \'lore-mcp-x\' не найден — заведите его через actor_new"}');
      }
      return { ok: true };
    };
    sliceRows = []; // agent_owners: такого актора нет
    const r = await tool('machine_owner_set').handler({ client_id: 'lore-mcp-x', kc_sub: 'sub-1' });
    expect(isError(r)).toBe(false);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.path)).toEqual(['/lore/actor/owner', '/lore/actor', '/lore/actor/owner']);
    expect(posts[1].body).toEqual({ actor_id: 'lore-mcp-x', name: 'lore-mcp-x', kind: 'agent' });
    expect(JSON.parse(text(r)).actor_created).toBe(true);
  });

  it('актор есть, но не kind=agent (400) — отказ как есть, kind не переписывается', async () => {
    postImpl = async () => { throw new Error('POST /lore/actor/owner → 400 {"code":"BAD_PARAMS","message":"actor \'pm\' не kind=agent — владелец назначается только агентам"}'); };
    sliceRows = [];
    const r = await tool('machine_owner_set').handler({ client_id: 'pm', kc_sub: 'sub-1' });
    expect(isError(r)).toBe(true);
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/lore/actor/owner']);
  });

  it('400 по другой причине (актор есть) — отказ как есть, актор не заводится', async () => {
    postImpl = async () => { throw new Error('POST /lore/actor/owner → 400 {"code":"BAD_PARAMS","message":"harness \'zzz\' нет в справочнике"}'); };
    sliceRows = [{ actor_id: 'lore-mcp-x' }];
    const r = await tool('machine_owner_set').handler({ client_id: 'lore-mcp-x', kc_sub: 'sub-1', harness: 'zzz' });
    expect(isError(r)).toBe(true);
    expect(text(r)).toContain('нет в справочнике');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/lore/actor/owner']);
  });
});
