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
