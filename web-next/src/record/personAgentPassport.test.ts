// SPRINT_UXR_S9_SCALE_OPT/S9-05 (часть A) — человек и агент открываются своим паспортом
// «шапка + таблица детей». Паспорт проекта вёл на них связями (people → user, agents → agent),
// но раздела и паспорта не было: ссылка была null.
import { describe, expect, it } from 'vitest';
import { recordHref, sectionOfType } from '../nav/loreRoutes';
import { V2_SECTIONS } from '../shell/v2Config';
import { agentRecord, userRecord } from '../lists/records';
import { PASSPORT_TYPES } from './passportAdapters';

describe('человек и агент: раздел, маршрут, паспорт', () => {
  it('разделы есть, типы ведут в них', () => {
    expect(V2_SECTIONS).toContain('user');
    expect(V2_SECTIONS).toContain('agent');
    expect(sectionOfType('user')).toBe('user');
    expect(sectionOfType('agent')).toBe('agent');
    expect(recordHref('user', 'kc-1')).toBe('/?mod=forseti&sec=user&open=kc-1');
    expect(recordHref('agent', 'AGENT-FULL')).toBe('/?mod=forseti&sec=agent&open=AGENT-FULL');
  });

  it('паспорт знает оба типа', () => {
    expect(PASSPORT_TYPES).toContain('user');
    expect(PASSPORT_TYPES).toContain('agent');
  });

  it('строки срезов users / agents → записи без выдуманного статуса', () => {
    expect(userRecord({ kc_sub: 'kc-1', display_name: 'Алекса', projects: ['NooriUta/UnlimitedLORE'] })).toMatchObject({
      id: 'kc-1', kind: 'user', title: 'Алекса', status: '', fields: { project: ['NooriUta/UnlimitedLORE'] },
    });
    expect(userRecord({ kc_sub: 'kc-2' }).title).toBe('kc-2');
    expect(agentRecord({ actor_id: 'AGENT-FULL', name: 'Claude Code', client_id: 'lore-mcp-full', agent_role: 'full', owner: 'kc-1', projects: [] })).toMatchObject({
      id: 'AGENT-FULL', kind: 'agent', title: 'Claude Code', status: '',
      fields: { clientId: 'lore-mcp-full', agentRole: 'full', owner: 'kc-1', project: [] },
    });
  });
});
