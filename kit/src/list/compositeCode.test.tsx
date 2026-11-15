// @vitest-environment jsdom
// PU-29 (правило владелицы, приёмка 14.11.2026, SPRINT_UXR_POLISH_UAT_1113/PU-29): составной код
// записи (задача «СПРИНТ/КОД») рядом с родителем — только последняя часть, без родителя — полный путь.
// «Рядом с родителем» = в той же строке есть колонка, чьё значение и есть родитель (у задачи — «Спринт»).
// Полный путь при этом не теряется: он в подсказке кода.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const task: KitRecord = { id: 'SPRINT_X/CO-11', kind: 'task', title: 'Задача', status: 'todo', fields: { sprint: 'SPRINT_X' } };
const plain: KitRecord = { id: 'ADR-LORE-050', kind: 'task', title: 'Без пути', status: 'todo', fields: { sprint: 'SPRINT_X' } };

const configOf = (columns: string[]): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'cog', fields: [{ key: 'sprint', title: 'Спринт', type: 'text' }] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], columns, showClosed: 'all' },
});
const dataOf = (rs: KitRecord[]): KitData =>
  ({ records: rs, edges: [], journal: [], meta: { generated_at: '2026-11-15T00:00:00Z', total: rs.length } });

const idPills = () => Array.from(document.querySelectorAll('tbody .sk-pill')).map(p => ({ text: p.textContent, title: p.closest('[title]')?.getAttribute('title') ?? null }));

describe('PU-29: составной код рядом с родителем — последняя часть', () => {
  it('колонка «Спринт» в строке есть — код короткий, полный путь в подсказке', () => {
    render(<ListView config={configOf(['id', 'title', 'fields.sprint'])} data={dataOf([task])} urlState={false} />);
    const [pill] = idPills();
    expect(pill.text).toBe('CO-11');
    expect(pill.title).toBe('SPRINT_X/CO-11');
  });

  it('родителя в строке нет — полный путь', () => {
    render(<ListView config={configOf(['id', 'title'])} data={dataOf([task])} urlState={false} />);
    expect(idPills()[0].text).toBe('SPRINT_X/CO-11');
  });

  it('код без «/» не трогается (положительный контроль)', () => {
    render(<ListView config={configOf(['id', 'title', 'fields.sprint'])} data={dataOf([plain])} urlState={false} />);
    expect(idPills()[0].text).toBe('ADR-LORE-050');
  });
});
