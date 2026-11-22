// Раздел «Агенты»: в колонке «Владелец» — ИМЯ человека, а не его опознаватель Keycloak.
//
// Находка владелицы 22.11.2026 (снимок экрана прода): в колонке «Владелец» у всех агентов стоит
// «52f6fad5-3fe6-42b2-8393-f5e667ac8c8f». Данные при этом целы — имя есть в графе и его отдаёт соседний срез
// agent_owners («Ann So»), а срез agents брал только `out('OWNED_BY').kc_sub`. То есть это не потеря владельцев,
// а колонка, читающая опознаватель вместо имени: человек в списке не узнаёт сам себя.
//
// Правило: показываем имя, если оно пришло; имени нет — опознаватель (лучше строка-загадка, чем пустота);
// нет и его — поле пустое, и быстрый отбор «без владельца» по-прежнему ловит такие строки.
import { describe, it, expect } from 'vitest';
import { agentRecord } from './records';

describe('S9-05 · владелец агента в списке — имя человека', () => {
  it('имя пришло — показываем имя, а не опознаватель', () => {
    const r = agentRecord({
      actor_id: 'AGENT-FULL-msbt0fed', name: 'Claude Code (full)', client_id: 'lore-mcp-full',
      agent_role: 'full', harness: 'claude',
      owner: '52f6fad5-3fe6-42b2-8393-f5e667ac8c8f', owner_name: 'Ann So', projects: [],
    });
    expect(r.fields.owner).toBe('Ann So');
  });

  it('имени нет — остаётся опознаватель: это хуже имени, но лучше пустоты', () => {
    const r = agentRecord({
      actor_id: 'A', name: 'a', client_id: 'c', agent_role: 'full', harness: 'claude',
      owner: 'e8c633a1-33fe-4e1b-b7e9-59287f47964a', owner_name: null, projects: [],
    });
    expect(r.fields.owner).toBe('e8c633a1-33fe-4e1b-b7e9-59287f47964a');
  });

  it('владельца нет вовсе — поле пустое, быстрый отбор «без владельца» работает', () => {
    const r = agentRecord({
      actor_id: 'AGENT-FULL_QWEN-LORCETUS', name: 'Qwen Code', client_id: null,
      agent_role: null, harness: null, owner: null, owner_name: null, projects: [],
    });
    expect(r.fields.owner).toBe('');
  });
});
