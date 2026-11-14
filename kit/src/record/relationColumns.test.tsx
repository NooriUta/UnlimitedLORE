// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-05, решение владелицы D14 «колонки по типу ребёнка»:
// таблица детей паспорта-родителя показывает сверх общих колонок колонки,
// которые НАЗВАЛО приложение для этой связи (`KitRelationDef.columns`): у задач —
// исполнитель, оценка, класс; у спринтов — прогресс x/y и даты. Kit предметных
// имён не знает (K-14): что за колонки — решает вызывающий; не назвал — прежние
// общие колонки.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord, KitRelationDef } from '../core/contract';
import { RecordRelations } from './RecordRelations';

const kinds: KitConfig['kinds'] = {
  component: { title: 'Компонент', icon: 'component' },
  task: { title: 'Задача', icon: 'checklist', fields: [
    { key: 'executor', title: 'Исполнитель', type: 'text' },
    { key: 'effort', title: 'Оценка', type: 'number' },
  ] },
  sprint: { title: 'Спринт', icon: 'sprint', fields: [
    { key: 'progress', title: 'Прогресс', type: 'text' },
    { key: 'planned_end', title: 'Конец по плану', type: 'date' },
  ] },
};
const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds,
  statuses: { items: [{ code: 'done', title: 'Готово', category: 'finished', icon: 'check-mark', color: 'var(--suc)' }] },
  roles: { reader: { canEdit: false, canStatus: false } },
};
const comp: KitRecord = { id: 'C1', kind: 'component', title: 'Компонент', status: '', fields: {} };
const ctxOf = (records: KitRecord[], edges: { from: string; to: string; type: string }[]): KitCtx => ({
  config, role: 'reader',
  data: { records: [comp, ...records], edges, journal: [], meta: { generated_at: '2026-11-14T00:00:00Z' } },
  href: id => `?open=${id}`, esc: s => s, md: s => s,
});
const heads = () => within(screen.getByRole('table')).getAllByRole('columnheader').map(th => th.textContent?.trim());

describe('S9-05 / D14 · колонки таблицы детей по типу ребёнка', () => {
  it('задачи: колонки, названные связью, — с подписями полей вида и значениями', () => {
    const def: KitRelationDef = { key: 'tasks', label: 'Задачи', relation: 'association', rel: 'TAGGED_WITH', dir: 'in', targetKind: 'task',
      columns: ['status', 'id', 'title', 'fields.executor', 'fields.effort'] };
    const t: KitRecord = { id: 'S/T-1', kind: 'task', title: 'Задача', status: 'done', fields: { executor: 'claude', effort: 2 } };
    render(<RecordRelations record={comp} ctx={ctxOf([t], [{ from: 'S/T-1', to: 'C1', type: 'TAGGED_WITH' }])} defs={[def]} lang="ru" />);
    expect(heads()).toEqual(expect.arrayContaining(['Исполнитель', 'Оценка']));
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map(c => c.textContent);
    expect(cells).toContain('claude');
  });

  it('спринты: прогресс x/y ячейкой прогресса и дата плана', () => {
    const def: KitRelationDef = { key: 'sprints', label: 'Спринты', relation: 'association', rel: 'BELONGS_TO', dir: 'in', targetKind: 'sprint',
      columns: ['status', 'id', 'title', 'progress:progress', 'fields.planned_end'] };
    const s: KitRecord = { id: 'SPRINT_X', kind: 'sprint', title: 'Спринт', status: 'done', fields: { progress: { done: 6, total: 12 }, planned_end: '2026-11-20' } };
    render(<RecordRelations record={comp} ctx={ctxOf([s], [{ from: 'SPRINT_X', to: 'C1', type: 'BELONGS_TO' }])} defs={[def]} lang="ru" />);
    expect(heads()).toEqual(expect.arrayContaining(['Прогресс', 'Конец по плану']));
    expect(within(screen.getByRole('table')).getByText('6/12')).toBeTruthy();
  });

  it('колонок связь не назвала — прежние общие: Статус, Вид, Код, Запись', () => {
    const def: KitRelationDef = { key: 'tasks', label: 'Задачи', relation: 'association', rel: 'TAGGED_WITH', dir: 'in', targetKind: 'task' };
    const t: KitRecord = { id: 'S/T-1', kind: 'task', title: 'Задача', status: 'done', fields: {} };
    render(<RecordRelations record={comp} ctx={ctxOf([t], [{ from: 'S/T-1', to: 'C1', type: 'TAGGED_WITH' }])} defs={[def]} lang="ru" />);
    expect(heads().slice(0, 4)).toEqual(['Статус', 'Вид', 'Код', 'Запись']);
  });
});
