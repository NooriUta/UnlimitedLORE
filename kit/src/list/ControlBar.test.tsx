// @vitest-environment jsdom
// Стандартная полоса управления — отдельно от ListView
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS).
//
// Повод — владелица 11.11.2026: у всех табличных представлений по умолчанию
// должны быть поиск, фильтры, группировка и порядок. Дерево и таблица задач
// рисуют свои строки и не могут стать ListView, поэтому полоса вынесена: те же
// сегменты, те же классы, те же модели фильтра и порядка, что у списка.
//
// Тесты держат правила:
//   • полоса собрана из ТЕХ ЖЕ частей, что у ListView (сегменты filter/group/
//     sort, поле поиска, фасет на ось) — иначе «стандартная» значит «похожая»;
//   • модель — общая: applyControls = фильтр списка (toFilterSet) + порядок
//     списка (sortRecords), а не своя реализация;
//   • сегмент, которого вызывающий не дал, не рисуется — пустой сегмент
//     обещает выбор, которого нет.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { ControlBar, EMPTY_CONTROLS, applyControls, controlsActive, type ControlState } from './ControlBar';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { lesson: { title: 'Урок', icon: 'quill-ink', fields: [{ key: 'mins', title: 'Минут', type: 'number' }, { key: 'who', title: 'Ведёт', type: 'text' }] } },
  statuses: {
    items: [
      { code: 'open', title: 'Идёт', category: 'in_progress', icon: 'play-button', color: 'var(--acc)' },
      { code: 'done', title: 'Пройден', category: 'finished', icon: 'check-mark', color: 'var(--suc)' },
    ],
  },
};

const rec = (id: string, title: string, status: string, mins: number, who: string): KitRecord =>
  ({ id, kind: 'lesson', title, status, fields: { mins, who } });
const RECS = [rec('L-1', 'Феху', 'done', 20, 'Сигрид'), rec('L-2', 'Уруз', 'open', 30, 'Эйрик'), rec('L-3', 'Турисаз', 'open', 10, 'Сигрид')];

const st = (p: Partial<ControlState>): ControlState => ({ ...EMPTY_CONTROLS, ...p });

describe('applyControls — фильтр и порядок списка на чужих строках', () => {
  it('пустое состояние — всё как пришло, и это «не активно»', () => {
    expect(applyControls(RECS, EMPTY_CONTROLS, config).map(r => r.id)).toEqual(['L-1', 'L-2', 'L-3']);
    expect(controlsActive(EMPTY_CONTROLS)).toBe(false);
  });

  it('текст ищет в ID и названии; фасет — по значению поля; всё через И', () => {
    expect(applyControls(RECS, st({ text: 'уруз' }), config).map(r => r.id)).toEqual(['L-2']);
    expect(applyControls(RECS, st({ filters: { 'fields.who': ['Сигрид'] } }), config).map(r => r.id)).toEqual(['L-1', 'L-3']);
    expect(applyControls(RECS, st({ filters: { 'fields.who': ['Сигрид'], status: ['open'] } }), config).map(r => r.id)).toEqual(['L-3']);
    expect(controlsActive(st({ text: 'x' }))).toBe(true);
  });

  it('порядок — порядком списка: число как число, статус — порядком словаря, «по убыванию»', () => {
    expect(applyControls(RECS, st({ sort: { key: 'fields.mins', dir: 'desc' } }), config).map(r => r.id)).toEqual(['L-2', 'L-1', 'L-3']);
    expect(applyControls(RECS, st({ sort: { key: 'status', dir: 'asc' } }), config).map(r => r.id)).toEqual(['L-2', 'L-3', 'L-1']);
  });
});

function show(props: Partial<Parameters<typeof ControlBar>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <KitLangProvider lang="ru">
      <ControlBar config={config} records={RECS} state={EMPTY_CONTROLS} onChange={onChange}
        filterKeys={['status', 'fields.who']} groupKeys={['status', 'fields.who']} sortKeys={['title', 'fields.mins']} {...props} />
    </KitLangProvider>,
  );
  return { ...utils, onChange };
}

describe('ControlBar — та же полоса, что у ListView', () => {
  it('сегменты filter · group · sort с классами списка; поиск и фасет на каждую ось', () => {
    const { container } = show();
    const bar = container.querySelector('.sk-list__controls')!;
    expect(bar).not.toBeNull();
    expect(Array.from(bar.querySelectorAll('fieldset.sk-list__seg')).map(f => (f as HTMLElement).dataset.seg)).toEqual(['filter', 'group', 'sort']);
    expect(screen.getByRole('searchbox', { name: 'Текст в ID или названии' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Статус/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ведёт/ })).toBeTruthy();
  });

  it('ввод в поиск уходит наверх полным состоянием', () => {
    const { onChange } = show();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'феху' } });
    expect(onChange).toHaveBeenCalledWith(st({ text: 'феху' }));
  });

  it('порядок: выбор ключа и «по убыванию»', () => {
    const { onChange, rerender } = show();
    fireEvent.click(screen.getByRole('button', { name: /Порядок: как пришло/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Минут' }));
    expect(onChange).toHaveBeenLastCalledWith(st({ sort: { key: 'fields.mins', dir: 'asc' } }));
    rerender(
      <KitLangProvider lang="ru">
        <ControlBar config={config} records={RECS} state={st({ sort: { key: 'fields.mins', dir: 'asc' } })} onChange={onChange}
          filterKeys={['status']} sortKeys={['fields.mins']} />
      </KitLangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'по убыванию' }));
    expect(onChange).toHaveBeenLastCalledWith(st({ sort: { key: 'fields.mins', dir: 'desc' } }));
  });

  it('сегмента, которого не дали, нет: без groupKeys — нет группировки, без sortKeys — нет порядка', () => {
    const { container } = show({ groupKeys: undefined, sortKeys: undefined });
    expect(Array.from(container.querySelectorAll('fieldset.sk-list__seg')).map(f => (f as HTMLElement).dataset.seg)).toEqual(['filter']);
  });

  it('своя группировка вызывающего (groupSlot) встаёт в стандартный сегмент группы', () => {
    const { container } = show({ groupKeys: undefined, groupSlot: <button type="button">свои группы</button> });
    const seg = container.querySelector('fieldset[data-seg="group"]')!;
    expect(seg.textContent).toContain('свои группы');
  });

  it('условие задано — видно «Показано N из M» и кнопка «Сбросить фильтр» возвращает пустое условие', () => {
    const { onChange } = show({ state: st({ text: 'уруз', sort: { key: 'title', dir: 'asc' } }), shown: { shown: 1, total: 3 } });
    expect(screen.getByText('Показано 1 из 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));
    // Сброс снимает ФИЛЬТР; выбранный порядок и группа — не фильтр, их не трогаем.
    expect(onChange).toHaveBeenLastCalledWith(st({ sort: { key: 'title', dir: 'asc' } }));
  });
});
