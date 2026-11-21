// SPRINT_UXR_S9_SCALE_OPT/S9-05 (часть A) — человек и агент открываются своим паспортом
// «шапка + таблица детей». Паспорт проекта вёл на них связями (people → user, agents → agent),
// но раздела и паспорта не было: ссылка была null.
import { describe, expect, it } from 'vitest';
import { recordHref, sectionOfType } from '../nav/loreRoutes';
import { V2_SECTIONS, v2Config } from '../shell/v2Config';
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
      // AO-AGENT-HUMAN-NAME (владелица 21.11.2026): «Claude Code · full» вместо голого имени; учётка — полем clientId.
      id: 'AGENT-FULL', kind: 'agent', title: 'Claude Code · full', status: '',
      fields: { clientId: 'lore-mcp-full', agentRole: 'full', owner: 'kc-1', project: [] },
    });
  });

  // Владелица 21.11.2026: «Организация — организации, продукты, проекты, люди» — люди в общем меню (список без прав и
  // ролей); агенты по-прежнему только в админке (MC-07).
  it('люди — в общем меню (группа «Организация»), агентов нет (уровень admin)', () => {
    const ids = v2Config('ru').menu.groups.flatMap(g => g.items.map(i => i.id));
    expect(ids).toContain('sprint');
    expect(ids).toContain('user');
    expect(ids).not.toContain('agent');
  });
});
