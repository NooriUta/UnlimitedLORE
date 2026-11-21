// AO-AGENT-HUMAN-NAME (владелица 21.11.2026): агент — «имя · профиль · машина» вместо учётки; учётка — подсказкой.
import { describe, expect, it } from 'vitest';
import { agentLabel, profileOf } from './whoLabel';
import { loreAuthor } from '../history/loreAuthor';
import { agentRecord } from '../lists/records';

describe('подпись агента', () => {
  it('профиль — из учётки lore-mcp-<профиль>[_…]', () => {
    expect(profileOf('lore-mcp-full')).toBe('full');
    expect(profileOf('lore-mcp-full_kimi')).toBe('full');
    expect(profileOf('lore-backend-minilore-reader')).toBeNull();
  });

  it('имя · профиль · машина; машины нет — без третьей части', () => {
    expect(agentLabel({ name: 'Claude Code', clientId: 'lore-mcp-full', machine: 'LEGION' })).toBe('Claude Code · full · LEGION');
    expect(agentLabel({ name: 'Claude Code', clientId: 'lore-mcp-full' })).toBe('Claude Code · full');
    expect(agentLabel({ name: 'Claude Code', clientId: 'lore-mcp-full', machine: '(unknown)' })).toBe('Claude Code · full');
    expect(agentLabel({ harness: 'claude-code', clientId: 'lore-mcp-full' })).toBe('claude-code · full');
    expect(agentLabel({ clientId: 'lore-x' })).toBe('lore-x');
  });

  it('история: автор-агент — подпись сервера, учётка остаётся id (фильтр)', () => {
    const a = loreAuthor({ kind: 'agent', client_id: 'lore-mcp-full', display_name: 'Claude Code · full · LEGION', owner_kc_sub: 's1' });
    expect(a).toEqual({ kind: 'agent', id: 'lore-mcp-full', name: 'Claude Code · full · LEGION', owner: 's1' });
  });

  it('список «Агенты»: заголовок — подпись, учётка — поле (видна в админке)', () => {
    const r = agentRecord({ actor_id: 'A1', name: 'Claude Code', client_id: 'lore-mcp-full', harness: 'claude-code', agent_role: 'dev' });
    expect(r.title).toBe('Claude Code · full');
    expect(r.fields.clientId).toBe('lore-mcp-full');
    expect(r.search).toContain('lore-mcp-full');
  });
});
