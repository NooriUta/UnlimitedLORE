import { describe, expect, it } from 'vitest';
import { authMode, mcpClientSecret, secretVarName } from './backend.js';

// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2): stdio MCP берёт секрет из переменной,
// ИМЯ которой задаёт LORE_MCP_SECRET_VAR (по умолчанию LORE_MCP_CLIENT_SECRET) — как helper
// заголовков. Подагент младшей роли получает LORE_MCP_SECRET_VAR = LORE_MCP_CLIENT_SECRET_TESTER.
// Переменной нет — ошибка с её ИМЕНЕМ и без значения.

const ISSUER = 'https://kc.example/realms/omilore';
const VALUE = 'sEcReT-value-123';

describe('LORE_MCP_SECRET_VAR', () => {
  it('по умолчанию — LORE_MCP_CLIENT_SECRET (положительный контроль прежнего пути)', () => {
    expect(secretVarName({})).toBe('LORE_MCP_CLIENT_SECRET');
    const env = { LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_ID: 'lore-mcp-full', LORE_MCP_CLIENT_SECRET: VALUE };
    expect(authMode(env)).toBe('oidc');
    expect(mcpClientSecret(env)).toBe(VALUE);
  });

  it('имя переменной из LORE_MCP_SECRET_VAR — секрет берётся оттуда', () => {
    const env = {
      LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_ID: 'lore-mcp-tester',
      LORE_MCP_SECRET_VAR: 'LORE_MCP_CLIENT_SECRET_TESTER', LORE_MCP_CLIENT_SECRET_TESTER: VALUE,
    };
    expect(authMode(env)).toBe('oidc');
    expect(mcpClientSecret(env)).toBe(VALUE);
  });

  it('названной переменной нет — ошибка с её именем, без значения соседней переменной', () => {
    const env = {
      LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_ID: 'lore-mcp-tester',
      LORE_MCP_SECRET_VAR: 'LORE_MCP_CLIENT_SECRET_TESTER', LORE_MCP_CLIENT_SECRET: VALUE,
    };
    let msg = '';
    try { authMode(env); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/LORE_MCP_CLIENT_SECRET_TESTER/);
    expect(msg).toMatch(/LORE_MCP_SECRET_VAR/);
    expect(msg).not.toContain(VALUE);
  });

  it('LORE_MCP_SECRET_VAR не похоже на имя переменной — отказ', () => {
    expect(() => secretVarName({ LORE_MCP_SECRET_VAR: 'not a name; rm' })).toThrow(/LORE_MCP_SECRET_VAR/);
  });

  it('одна LORE_MCP_SECRET_VAR без остального — прежний режим заголовка (это имя, не учётные данные)', () => {
    expect(authMode({ LORE_MCP_SECRET_VAR: 'LORE_MCP_CLIENT_SECRET_TESTER' })).toBe('header');
  });
});
