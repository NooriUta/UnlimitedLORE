// @vitest-environment jsdom
// Дерево со стандартной полосой управления
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS, «и а и б» владелицы 11.11.2026).
//
// ПРАВИЛО ФИЛЬТРА В ДЕРЕВЕ (одно на все условия — текст, фасеты):
//   • условие судит только записи ПОСЛЕДНЕГО уровня (листья: урок, задача);
//   • запись верхнего уровня видна, если под ней есть подходящий лист, — она
//     контекст, а не находка: найденный лист стоит под своим родителем;
//   • запись верхнего уровня без подходящих листьев скрыта (не свёрнута:
//     свёрнутая ветка с нулём находок — шум);
//   • ничего не подошло — «под фильтр ничего не подошло» и «Сбросить», а не
//     «записей нет»: записи есть, их отсеяло условие.
// Порядок — тоже только у листьев, внутри своего родителя: иерархию он не
// перестраивает. Группировка — внутри родителя: шапки групп между родителем и
// его листьями.
//
// Предметных имён нет (K-14): курс → модуль → урок.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx } from '../../core/contract';
import { KitLangProvider } from '../../i18n';
import { EMPTY_CONTROLS, type ControlState } from '../../list/ControlBar';
import { TreeTable, treeTableLines, type TreeControls, type TreeFlatRow, type TreeLevel } from './TreeTable';
import { filterTreeRows } from './treeControls';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    course: { title: 'Курс', icon: 'book-cover' },
    unit: { title: 'Модуль', icon: 'stone-block' },
    lesson: { title: 'Урок', icon: 'quill-ink', fields: [{ key: 'mins', title: 'Минут', type: 'number' }] },
  },
  statuses: {
    items: [
      { code: 'open', title: 'Идёт', category: 'in_progress', icon: 'play-button', color: 'var(--acc)' },
      { code: 'done', title: 'Пройден', category: 'finished', icon: 'check-mark', color: 'var(--suc)' },
    ],
  },
};
const ctx: KitCtx = {
  config, role: 'reader',
  data: { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
  href: id => `?open=${id}`, esc: s => s, md: s => s,
};
const LEVELS: TreeLevel[] = [{ kind: 'course' }, { kind: 'unit', optional: true }, { kind: 'lesson' }];
const COLUMNS = ['status', 'id', 'title', 'fields.mins'];
const FULL: TreeFlatRow[] = [
  { key: 'C-1', kind: 'course', parent: null, title: 'Руны', status: 'open' },
  { key: 'U-1', kind: 'unit', parent: 'C-1', title: 'Футарк', status: 'open' },
  { key: 'L-1', kind: 'lesson', parent: 'U-1', title: 'Феху', status: 'done', mins: 20 },
  { key: 'U-2', kind: 'unit', parent: 'C-1', title: 'Гальдр', status: 'open' },
  { key: 'L-2', kind: 'lesson', parent: 'U-2', title: 'Уруз', status: 'open', mins: 30 },
  { key: 'L-9', kind: 'lesson', parent: 'C-1', title: 'Вводный', status: 'open', mins: 10 },
];
const FLAT: TreeFlatRow[] = [
  { key: 'C-1', kind: 'course', parent: null, title: 'Руны', status: 'open' },
  { key: 'L-1', kind: 'lesson', parent: 'C-1', title: 'Феху', status: 'done', mins: 20 },
  { key: 'L-2', kind: 'lesson', parent: 'C-1', title: 'Уруз', status: 'open', mins: 30 },
  { key: 'L-3', kind: 'lesson', parent: 'C-1', title: 'Турисаз', status: 'open', mins: 10 },
];
const CONTROLS: TreeControls = { filters: ['status'], groupings: ['status'], sorts: ['title', 'fields.mins'] };
const st = (p: Partial<ControlState>): ControlState => ({ ...EMPTY_CONTROLS, ...p });

function show(rows: TreeFlatRow[] = FULL, controls: TreeControls | null = CONTROLS) {
  return render(
    <KitLangProvider lang="ru">
      <TreeTable levels={LEVELS} columns={COLUMNS} rows={rows} ctx={ctx} controls={controls ?? undefined} narrow={false} />
    </KitLangProvider>,
  );
}
const order = () => Array.from(document.querySelectorAll('tr[data-line="record"]')).map(tr => (tr as HTMLElement).dataset.id);
const search = () => screen.getByRole('searchbox', { name: 'Текст в ID или названии' });

describe('filterTreeRows — правило фильтра в дереве', () => {
  it('условие не задано — ряды те же, тем же порядком', () => {
    expect(filterTreeRows(FULL, LEVELS, EMPTY_CONTROLS, config).rows.map(r => r.key)).toEqual(FULL.map(r => r.key));
  });

  it('подходящий лист виден под своим родителем; родитель без подходящих листьев скрыт', () => {
    const out = filterTreeRows(FULL, LEVELS, st({ text: 'уруз' }), config);
    expect(out.rows.map(r => r.key)).toEqual(['C-1', 'U-2', 'L-2']);
    expect(out).toMatchObject({ shown: 1, total: 3 });
  });

  it('условие судит ТОЛЬКО листья: совпадение в названии модуля не тянет его уроки', () => {
    expect(filterTreeRows(FULL, LEVELS, st({ text: 'футарк' }), config).rows).toEqual([]);
  });

  it('порядок — у листьев внутри своего родителя; верхние уровни остаются как пришли', () => {
    const out = filterTreeRows(FLAT, LEVELS, st({ sort: { key: 'fields.mins', dir: 'desc' } }), config);
    expect(treeTableLines(out.rows, LEVELS, null).filter(l => l.type === 'record').map(l => l.type === 'record' && l.record.id))
      .toEqual(['C-1', 'L-2', 'L-1', 'L-3']);
  });
});

describe('treeTableLines — группировка внутри родителя', () => {
  it('шапки групп — между родителем и листьями, листья уровнем ниже; группы статуса — порядком словаря', () => {
    const lines = treeTableLines(FLAT, LEVELS, null, { groupBy: 'status', config });
    expect(lines.map(l => (l.type === 'record' ? `${l.record.id}@${l.level}` : `[${l.type === 'group' && l.value}]@${l.level}`)))
      .toEqual(['C-1@1', '[open]@2', 'L-2@3', 'L-3@3', '[done]@2', 'L-1@3']);
  });

  it('группировка не трогает уровни выше листьев: модули остаются модулями', () => {
    const lines = treeTableLines(FULL, LEVELS, null, { groupBy: 'status', config });
    const recs = lines.filter(l => l.type === 'record').map(l => l.type === 'record' && `${l.record.id}@${l.level}`);
    expect(recs).toEqual(['C-1@1', 'U-1@2', 'L-1@4', 'U-2@2', 'L-2@4', 'L-9@4']);
  });
});

describe('TreeTable · полоса управления', () => {
  it('без controls полосы нет — прежний вид не меняется', () => {
    const { container } = show(FULL, null);
    expect(container.querySelector('.sk-list__controls')).toBeNull();
    expect(order()).toEqual(['C-1', 'U-1', 'L-1', 'U-2', 'L-2', 'L-9']);
  });

  it('стандартная полоса: поиск, фасет, группировка, порядок', () => {
    const { container } = show();
    expect(Array.from(container.querySelectorAll('fieldset.sk-list__seg')).map(f => (f as HTMLElement).dataset.seg)).toEqual(['filter', 'group', 'sort']);
    expect(search()).toBeTruthy();
  });

  it('поиск: найденный урок — под своим модулем, чужие ветки скрыты, «Показано 1 из 3»', () => {
    show();
    fireEvent.change(search(), { target: { value: 'уруз' } });
    expect(order()).toEqual(['C-1', 'U-2', 'L-2']);
    expect(screen.getByText('Показано 1 из 3')).toBeTruthy();
  });

  it('свёрнутая ветка не прячет находку: новое условие раскрывает дерево', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: "Свернуть «Гальдр»" }));
    expect(order()).not.toContain('L-2');
    fireEvent.change(search(), { target: { value: 'уруз' } });
    expect(order()).toEqual(['C-1', 'U-2', 'L-2']);
  });

  it('ничего не подошло — «под фильтр ничего не подошло», а «Сбросить» возвращает всё', () => {
    show();
    fireEvent.change(search(), { target: { value: 'нет-такого' } });
    expect(screen.getByText('Под фильтр ничего не подошло')).toBeTruthy();
    expect(screen.queryByText('Записей нет')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Сбросить фильтр' })[0]);
    expect(order()).toEqual(['C-1', 'U-1', 'L-1', 'U-2', 'L-2', 'L-9']);
  });

  it('шапка группы — строкой таблицы с подписью значения и числом', () => {
    show(FLAT, { ...CONTROLS, state: st({ group: 'status' }) });
    const heads = Array.from(document.querySelectorAll('tr[data-line="group"][data-group="value"]')).map(tr => tr.textContent);
    expect(heads).toEqual(['Идёт2', 'Пройден1']);
  });

  it('управляемое состояние: state + onStateChange', () => {
    let last: ControlState | null = null;
    show(FLAT, { ...CONTROLS, state: st({ filters: { status: ['done'] } }), onStateChange: s => { last = s; } });
    expect(order()).toEqual(['C-1', 'L-1']);
    fireEvent.change(search(), { target: { value: 'x' } });
    expect(last).toEqual(st({ filters: { status: ['done'] }, text: 'x' }));
  });
});
