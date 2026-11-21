// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.1): MCP при старте говорит в instructions, какие роли доступны
// подагентам этой сессии — роли не выше главной роли учётки (agent_scope токена), по порядку модели; и правило
// «подагенту младшей роли — своя учётка, LORE_MCP_SECRET_VAR = ключ роли».
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readAgentOrder, rolesNotAbove, secretKeyOf, subagentInstructions } from './subagents.js';
import { createLoreServer, resolveSurface } from './server.js';

describe('порядок ролей — копия модели', () => {
  it('совпадает с разделом agent_profiles shared/model/lore-model.json', () => {
    const model = JSON.parse(readFileSync(fileURLToPath(new URL('../../shared/model/lore-model.json', import.meta.url)), 'utf-8')).agent_profiles;
    const order = readAgentOrder();
    expect(order).not.toBeNull();
    expect(order!.profiles).toEqual(model.profiles.map((p: { code: string; rank: number; parents: string[] }) => ({ code: p.code, rank: p.rank, parents: p.parents })));
    expect(order!.harness).toEqual(model.harness);
  });
});

describe('роли подагентов', () => {
  const order = readAgentOrder()!;
  it('не выше главной, по рангу; marketer под pm; соседи друг другу не младшие', () => {
    expect(rolesNotAbove('full', order)).toEqual(['full', 'architect', 'pm', 'product-analyst', 'analyst', 'developer', 'marketer', 'tester']);
    expect(rolesNotAbove('pm', order)).toEqual(['pm', 'product-analyst', 'analyst', 'developer', 'marketer', 'tester']);
    expect(rolesNotAbove('developer', order)).toEqual(['developer', 'tester']);
    expect(rolesNotAbove('ghost', order)).toEqual([]);
  });
  it('ключ секрета роли и harness', () => {
    expect(secretKeyOf('tester', 'kimi-code', order)).toBe('LORE_MCP_CLIENT_SECRET_TESTER_KIMI');
    expect(secretKeyOf('product-analyst', 'claude-code', order)).toBe('LORE_MCP_CLIENT_SECRET_PRODUCT_ANALYST');
    expect(secretKeyOf('full', null, order)).toBe('LORE_MCP_CLIENT_SECRET_FULL');
  });
  it('instructions: список ролей и правило своей учётки', () => {
    const t = subagentInstructions('pm', 'kimi-code', order);
    expect(t).toContain('pm, product-analyst, analyst, developer, marketer, tester');
    expect(t).not.toMatch(/architect/);
    expect(t).toContain('LORE_MCP_SECRET_VAR');
    expect(t).toContain('LORE_MCP_CLIENT_SECRET_TESTER_KIMI');
    expect(t).toContain('lore-mcp-tester_kimi');
  });
  it('роли учётки нет или их две — честно «не выведен», а не полный список', () => {
    expect(subagentInstructions(null, null, order)).toMatch(/не известна/);
    expect(subagentInstructions('ambiguous', null, order)).toMatch(/несколько/);
    expect(subagentInstructions('full', null, null)).toMatch(/порядок ролей не прочитан/i);
  });
});

describe('сервер отдаёт правило в instructions при initialize', () => {
  it('клиент видит список ролей подагентов', async () => {
    const { surface, profiles } = resolveSurface(null, 'developer', () => {});
    const server = createLoreServer(surface, profiles, false, subagentInstructions('developer', 'claude-code', readAgentOrder()));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getInstructions()).toContain('developer, tester');
    await client.close();
  });
});
