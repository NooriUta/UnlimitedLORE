// @vitest-environment jsdom
// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MACHINE-OBJ, часть A — «машины» агента на экране «Агенты».
//
// Срез agent_owners отдаёт machines — машины, с которых агент ходил (USES_MACHINE по
// заголовку X-Lore-Machine), а экран показывал только объявленное поле machine_id.
// Приёмка 13.11: «8 из 11 — не привязана», хотя у full есть наблюдённая машина.
// Правило: машина агента = объявленная ∪ наблюдённые; «без машины» — только когда
// нет ни той, ни другой. Повтор разного регистра — одна машина.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { agentMachines, agentsWithoutMachine, parseAgents } from './agents';

beforeAll(() => { registerGameIcons(gameIcons); });

const ROWS = [
  { actor_id: 'F', name: 'Claude Code (full)', client_id: 'lore-mcp-full', machine_id: null, machines: ['LORCETUS'] },
  { actor_id: 'K', name: 'Kimi (full)', client_id: 'lore-mcp-full_kimi', machine_id: 'lorcetus', machines: ['LorCetus', 'lorcetus'] },
  { actor_id: 'N', name: 'Нигде', client_id: 'lore-mcp-pm', machine_id: null, machines: [] },
];

describe('AO-MACHINE-OBJ A · машины агента', () => {
  it('разбор: machines из среза — массивом; нет поля — пусто, а не падение', () => {
    const d = parseAgents({ rows: [...ROWS, { actor_id: 'X', machine_id: null }] } as never, []);
    expect(d.rows[0].machines).toEqual(['LORCETUS']);
    expect(d.rows[3].machines).toEqual([]);
  });

  it('машины = объявленная ∪ наблюдённые, без повторов по регистру', () => {
    const d = parseAgents({ rows: ROWS } as never, []);
    expect(agentMachines(d.rows[0])).toEqual([{ id: 'LORCETUS', declared: false }]);
    expect(agentMachines(d.rows[1])).toEqual([{ id: 'lorcetus', declared: true }]);
  });

  it('«без машины» — только когда нет ни объявленной, ни наблюдённой', () => {
    const d = parseAgents({ rows: ROWS } as never, []);
    expect(agentsWithoutMachine(d.rows).map(r => r.actor_id)).toEqual(['N']);
  });

  it('экран: наблюдённая машина видна в строке с пометкой «по вызовам»', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ rows: ROWS }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);
    const cell = await screen.findByTestId('adm-agent-machines-F');
    expect(cell.textContent).toContain('LORCETUS');
    expect(cell.textContent).toMatch(/по вызовам/i);
    expect((await screen.findByTestId('adm-agent-machines-N')).textContent).toMatch(/не привязана/i);
  });
});
