// @vitest-environment jsdom
// Замечания владелицы 08.11 к паспорту из живого списка:
// 1) «общая полоса прокрутки — если ADR большой, крутим всё… у каждого элемента должен быть
//    свой скролл, не двигающий остальные»;
// 2) «свойства слиплись в вертикальном показе с контентом, и расположение не выдержано от верха»;
// 3) «панель справа / снизу / во весь экран не должна быть элементом паспорта визуально, а
//    свойством использования элемента».
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';
import { RecordDock } from './RecordDock';
import { ViewMenu } from '../list/ViewMenu';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { spec: { title: 'Спека', icon: 'scroll-quill', fields: [{ key: 'version', title: 'Версия', type: 'text' }] } },
  statuses: { items: [{ code: 'proposed', title: 'предложено', category: 'active', icon: 'calendar', color: 'var(--acc)' }] },
};
const rec: KitRecord = { id: 'S-1', kind: 'spec', title: 'Спека', status: 'proposed', fields: { version: '1.0' }, body_md: 'Текст' };
const ctx: KitCtx = { config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } }, href: id => `#${id}`, esc: s => s, md: s => s };

describe('1) у списка и паспорта — своя прокрутка', () => {
  it('положительный контроль: правила дока найдены', () => {
    expect(ruleOf('.sk-dock')).not.toBe('');
  });
  it('док — сетка на высоту окна; список и паспорт прокручиваются каждый сам', () => {
    expect(ruleOf('.sk-dock')).toMatch(/display:\s*grid/);
    expect(ruleOf('.sk-dock')).toMatch(/height:/);
    for (const sel of ['.sk-dock__backdrop', '.sk-dock__panel']) {
      expect(ruleOf(sel)).toMatch(/overflow:\s*auto/);
      expect(ruleOf(sel)).toMatch(/min-height:\s*0/);
      expect(ruleOf(sel)).not.toMatch(/position:\s*absolute/);
    }
  });
  it('список под паспортом живой: не скрыт от чтения и не приглушён', () => {
    const { container } = render(<RecordDock placement="right" backdrop={<button type="button">строка</button>}><p>паспорт</p></RecordDock>);
    expect(container.querySelector('.sk-dock__backdrop')?.getAttribute('aria-hidden')).toBeNull();
    expect(ruleOf('.sk-dock__backdrop')).not.toMatch(/opacity/);
  });
  it('«Закрыть» — кнопка дока, а не полоса над паспортом', () => {
    const onClose = vi.fn();
    render(<RecordDock placement="bottom" onClose={onClose}><p>паспорт</p></RecordDock>);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть паспорт' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('2) свойства — рядом с контентом, от одного верха', () => {
  it.each(['bottom', 'full'] as const)('%s: шапка на всю ширину; вкладки и «Свойства» — в одном ряду под ней', p => {
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement={p} />);
    const body = container.querySelector('.sk-rec__body') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.querySelector('h1')).toBeNull();
    expect(body.querySelector('[role="tablist"], .sk-rec__panel')).not.toBeNull();
    expect(body.querySelector(':scope > aside[data-zone="props"]')).not.toBeNull();
    expect(ruleOf('.sk-rec__body')).toMatch(/gap:\s*24px/);
  });
});

describe('3) место паспорта — настройка использования, в «Вид» списка', () => {
  it('в поповере «Вид» — «Паспорт открывается»: панелью справа / снизу / на весь экран', () => {
    const onPlace = vi.fn();
    render(<ViewMenu closed="below" modes={['below', 'all']} onClosed={() => {}} place="right" onPlace={onPlace} />);
    fireEvent.click(screen.getByRole('button', { name: /Вид/ }));
    const group = screen.getByRole('radiogroup', { name: 'Паспорт открывается' });
    expect(within(group).getAllByRole('radio').map(r => r.textContent)).toEqual(['панелью справа', 'снизу', 'на весь экран']);
    fireEvent.click(within(group).getByRole('radio', { name: 'снизу' }));
    expect(onPlace).toHaveBeenCalledWith('bottom');
  });
  it('без onPlace раздела нет (место задаёт приложение)', () => {
    render(<ViewMenu closed="below" modes={['below']} onClosed={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Вид/ }));
    expect(screen.queryByRole('radiogroup', { name: 'Паспорт открывается' })).toBeNull();
  });
});
