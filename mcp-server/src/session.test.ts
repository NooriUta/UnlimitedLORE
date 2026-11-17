// SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG: код сессии Claude Code — заголовком на каждом вызове.
import { describe, expect, it } from 'vitest';
import { sessionHeader } from './backend.js';

describe('sessionHeader: код сессии из CLAUDE_CODE_SESSION_ID', () => {
  it('переменная есть — X-Lore-Session-Id', () => {
    expect(sessionHeader({ CLAUDE_CODE_SESSION_ID: 'b2c27515-7345-4386-b9e0-9c824bc96050' }))
      .toEqual({ 'X-Lore-Session-Id': 'b2c27515-7345-4386-b9e0-9c824bc96050' });
  });
  it('нет переменной или пусто — заголовка нет, а не пустая строка', () => {
    expect(sessionHeader({})).toEqual({});
    expect(sessionHeader({ CLAUDE_CODE_SESSION_ID: '  ' })).toEqual({});
  });
  it('мусор вычищается, длина — до 64', () => {
    expect(sessionHeader({ CLAUDE_CODE_SESSION_ID: 'ab c\r\nd' })['X-Lore-Session-Id']).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    expect(sessionHeader({ CLAUDE_CODE_SESSION_ID: 'a'.repeat(200) })['X-Lore-Session-Id']).toHaveLength(64);
  });
});

import { harnessHeader } from './backend.js';

describe('harnessHeader: код harness константой из настроек MCP (LORE_HARNESS)', () => {
  it('задан — X-Lore-Harness', () => {
    expect(harnessHeader({ LORE_HARNESS: 'claude-code' })).toEqual({ 'X-Lore-Harness': 'claude-code' });
  });
  it('не задан — заголовка нет (сервер пометит «не прислан»)', () => {
    expect(harnessHeader({})).toEqual({});
    expect(harnessHeader({ LORE_HARNESS: ' ' })).toEqual({});
  });
  it('мусор вычищается, до 64', () => {
    expect(harnessHeader({ LORE_HARNESS: 'Claude Code!' })['X-Lore-Harness']).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
  });
});
