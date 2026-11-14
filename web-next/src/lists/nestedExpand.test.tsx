// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-23 — сторож правила владелицы 14.11.2026:
// «список при наличии дочернего элемента встроит его дочернюю таблицу — так же, как список со
// своими полями, маппингами и отображениями, — если объекты разные. И унифицированно, если это
// иерархия (ссылка сама на себя однотипных объектов)».
//   • дети ДРУГОГО типа → вложенная таблица дочернего типа с ЕГО колонками (экран этого типа);
//   • дети ТОГО ЖЕ типа → строки той же таблицы, в тех же колонках (kit expand.rows).
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ListView, registerGameIcons } from '@seidr/kit';
import type { KitConfig, KitData, KitRecord, ListExpandRows } from '@seidr/kit';
import { buildExpand, childMode, childScreenOf } from './nestedExpand';
import { LIST_SCREENS, type ListNested } from './screens';
import type { LoreClient } from '../sprints/loreClient';

beforeAll(() => { registerGameIcons(gameIcons); });

const client = {} as LoreClient;
const ok = (records: KitRecord[]) => (): ListExpandRows => ({ state: 'ok', records });

const compCfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { component: { title: 'Компоненты', icon: 'cog', fields: [{ key: 'tasks', title: 'Задачи', type: 'number' }] } },
  statuses: { items: [] },
  list: { views: ['list'], columns: ['id', 'title', 'fields.tasks'] },
};
const data = (r: KitRecord): KitData => ({ records: [r], edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: 1 } });
const nestedOf = (kind?: string): ListNested => ({
  lateFields: [], load: async () => new Map(), render: () => 'поток',
  children: { ...(kind ? { kind } : {}), load: async () => [] },
});

describe('PU-23 · правило раскрытия: другой тип — вложенная таблица, тот же — строки той же таблицы', () => {
  it('правило одной функцией', () => {
    expect(childMode('sprint', 'task')).toBe('table');
    expect(childMode('milestone', 'sprint')).toBe('table');
    expect(childMode('component', 'component')).toBe('rows');
    expect(childMode('task', 'task')).toBe('rows');
  });

  it('экран дочернего типа находится по modelType', () => {
    expect(childScreenOf('task')).toBe('tasks');
    expect(childScreenOf('sprint')).toBe('sprints');
    expect(childScreenOf('нет-такого')).toBeUndefined();
  });

  it('тот же тип (иерархия компонентов) — строки той же таблицы, в колонках родителя', () => {
    const parent: KitRecord = { id: 'C1', kind: 'component', title: 'Ядро', status: '', fields: { tasks: 3 } };
    const kids: KitRecord[] = [{ id: 'C1.a', kind: 'component', title: 'Подкомпонент', status: '', fields: { tasks: 1 } }];
    const expand = buildExpand({ nested: nestedOf(), client, childRows: ok(kids), childConfigOf: () => undefined, lang: 'ru' });
    render(<ListView config={compCfg} data={data(parent)} urlState={false} expand={expand} />);
    fireEvent.click(screen.getByRole('button', { name: /Раскрыть/ }));
    const rows = [...document.querySelectorAll('tr[data-child-of="C1"]')];
    expect(rows.map(r => r.getAttribute('data-record-id'))).toEqual(['C1.a']);
    expect(document.querySelector('[data-nested]')).toBeNull();
  });

  it('другой тип (спринт → задачи) — вложенная таблица задач: «Спринт» и «Оценка» задачи есть, «Задачи x/y» спринта нет', () => {
    const sprintCfg: KitConfig = {
      modules: [], menu: { groups: [] },
      kinds: { sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'tasks', title: 'Задачи', type: 'number' }] } },
      statuses: { items: [] },
      list: { views: ['list'], columns: ['id', 'title', 'progress:tasks'] },
    };
    const parent: KitRecord = { id: 'SP', kind: 'sprint', title: 'Спринт SP', status: '', fields: { tasks: { done: 0, total: 1 } } };
    const kids: KitRecord[] = [{ id: 'SP/T1', kind: 'task', title: 'Задача T1', status: 'planned', fields: { code: 'T1', sprint: 'SP', effort: 2 } }];
    const expand = buildExpand({ nested: nestedOf('task'), client, childRows: ok(kids), childConfigOf: k => childConfig(k), lang: 'ru' });
    render(<ListView config={sprintCfg} data={data(parent)} urlState={false} expand={expand} />);
    fireEvent.click(screen.getByRole('button', { name: /Раскрыть/ }));
    expect(document.querySelector('tr[data-child-of]')).toBeNull();
    const nested = document.querySelector('tr[data-expand-of="SP"] [data-nested]') as HTMLElement;
    expect(nested).not.toBeNull();
    const heads = within(nested).getAllByRole('columnheader').map(h => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(['Оценка']));
    // Приёмка препрода 14.11.2026: колонка, указывающая на саму родительскую строку («Спринт» внутри
    // спринта), — повтор; код — коротким (T1), а не полным uid SP/T1.
    expect(heads).not.toContain('Спринт');
    const row = nested.querySelector('tr[data-record-id="SP/T1"]') as HTMLElement;
    expect(row.textContent).toContain('T1');
    expect(row.textContent).not.toContain('SP/T1');
    expect(heads).not.toContain('Задачи');
    expect(within(nested).getByRole('link', { name: 'Задача T1' }).getAttribute('href')).toMatch(/open=SP%2FT1/);
  });

  it('тип ребёнка не объявлен — берётся из kind загруженных записей', () => {
    const parent: KitRecord = { id: 'SP', kind: 'sprint', title: 'Спринт SP', status: '', fields: {} };
    const kids: KitRecord[] = [{ id: 'SP/T1', kind: 'task', title: 'Задача T1', status: 'planned', fields: {} }];
    const expand = buildExpand({ nested: nestedOf(), client, childRows: ok(kids), childConfigOf: k => childConfig(k), lang: 'ru' });
    render(<ListView config={compCfg} data={data(parent)} urlState={false} expand={expand} />);
    fireEvent.click(screen.getByRole('button', { name: /Раскрыть/ }));
    expect(document.querySelector('[data-nested]')).not.toBeNull();
    expect(document.querySelector('tr[data-child-of]')).toBeNull();
  });
});

// Конфиг экрана дочернего типа — из LIST_SCREENS, как у его собственного списка.
function childConfig(kind: string): KitConfig | undefined {
  const id = childScreenOf(kind);
  return id ? LIST_SCREENS[id].config('ru') : undefined;
}
