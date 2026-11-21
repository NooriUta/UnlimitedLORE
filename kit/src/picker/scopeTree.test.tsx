// @vitest-environment jsdom
// SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER — дерево в ScopePicker (владелица 21.11.2026: «сделать раскрытием дерева с
// кнопочкой рядом с составным продуктом»). По умолчанию видны только записи верхнего уровня; у составной (есть потомки)
// рядом кнопка-раскрывашка (aria-expanded): нажатие показывает потомков отступом, повторное — сворачивает, выбор не
// меняется. Выбранный потомок (старая ссылка) — его родитель раскрыт. Поиск ищет и среди потомков.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { useState } from 'react';
import { ScopePicker, registerGameIcons } from '../index';
import type { ScopeOption } from '../index';
import { scopeTree } from './scopeModel';

beforeAll(() => { registerGameIcons(gameIcons); });

const OPTS: ScopeOption[] = [
  { id: 'AIDA', title: 'AIDA' },
  { id: 'HOUND', title: 'Hound', parent: 'AIDA' },
  { id: 'SEIDR', title: 'Seiðr', parent: 'AIDA' },
  { id: 'OMILORE', title: 'OMILORE' },
  { id: 'TYR', title: 'TYR', parent: 'OMILORE' },
  { id: 'FREYJA', title: 'Freyja' },
];

function Harness({ initial = [], spy, narrow = false }: { initial?: string[]; spy?: (v: string[]) => void; narrow?: boolean }) {
  const [value, setValue] = useState<string[]>(initial);
  return <ScopePicker label="Продукты" options={OPTS} state="ok" mine="known" narrow={narrow} value={value}
    onChange={v => { setValue(v); spy?.(v); }} />;
}
const open = () => fireEvent.click(screen.getByRole('button', { name: /Продукты/ }));
const rowIds = () => [...document.querySelectorAll('.sk-scope__row')].map(r => r.getAttribute('data-scope-id'));

describe('дерево в ScopePicker', () => {
  it('модель: корни и потомки; родитель, которого нет в списке, — запись остаётся корнем', () => {
    const t = scopeTree([...OPTS, { id: 'ORPHAN', parent: 'GONE' }]);
    expect(t.roots.map(o => o.id)).toEqual(['AIDA', 'OMILORE', 'FREYJA', 'ORPHAN']);
    expect(t.children.get('AIDA')?.map(o => o.id)).toEqual(['HOUND', 'SEIDR']);
    expect(t.children.has('FREYJA')).toBe(false);
  });

  it('по умолчанию — только верхний уровень; кнопка-раскрывашка только у составных', () => {
    render(<Harness />);
    open();
    expect(rowIds()).toEqual(['AIDA', 'FREYJA', 'OMILORE']);
    expect(screen.getByRole('button', { name: 'Раскрыть: AIDA' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Раскрыть: Freyja' }), 'у простого продукта кнопки нет').toBeNull();
  });

  it('раскрыть — потомки отступом под родителем; свернуть — скрыты; выбор при этом не меняется', () => {
    const seen: string[][] = [];
    render(<Harness spy={v => seen.push(v)} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: AIDA' }));
    expect(rowIds()).toEqual(['AIDA', 'HOUND', 'SEIDR', 'FREYJA', 'OMILORE']);
    expect(document.querySelector('[data-scope-id="HOUND"]')?.getAttribute('data-depth')).toBe('1');
    const btn = screen.getByRole('button', { name: 'Свернуть: AIDA' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(rowIds()).toEqual(['AIDA', 'FREYJA', 'OMILORE']);
    expect(seen, 'раскрытие не трогает выбор').toEqual([]);
  });

  it('раскрыв, можно выбрать отдельный потомок', () => {
    const seen: string[][] = [];
    render(<Harness spy={v => seen.push(v)} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: OMILORE' }));
    fireEvent.click(document.querySelector('[data-scope-id="TYR"] input[type="checkbox"]')!);
    expect(seen[seen.length - 1]).toEqual(['TYR']);
  });

  it('выбранный потомок (старая ссылка) — выбран сам, его родитель раскрыт', () => {
    render(<Harness initial={['HOUND']} />);
    open();
    expect(rowIds()).toEqual(['AIDA', 'HOUND', 'SEIDR', 'FREYJA', 'OMILORE']);
    expect((document.querySelector('[data-scope-id="HOUND"] input') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('[data-scope-id="AIDA"] input') as HTMLInputElement).checked).toBe(false);
  });

  it('поиск ищет и среди потомков — списком, без дерева', () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tyr' } });
    expect(rowIds()).toEqual(['TYR']);
  });

  it('положительный контроль: список без родителей — плоский, без кнопок', () => {
    function Flat() {
      const [v, setV] = useState<string[]>([]);
      return <ScopePicker label="Продукты" options={[{ id: 'A' }, { id: 'B' }]} state="ok" mine="known" narrow={false} value={v} onChange={setV} />;
    }
    render(<Flat />);
    open();
    expect(rowIds()).toEqual(['A', 'B']);
    expect(document.querySelector('.sk-scope__exp')).toBeNull();
  });

  it('на телефоне — то же дерево (лист снизу), кнопка раскрытия есть', () => {
    render(<Harness narrow />);
    open();
    expect(rowIds()).toEqual(['AIDA', 'FREYJA', 'OMILORE']);
    expect(screen.getByRole('button', { name: 'Раскрыть: AIDA' })).toBeTruthy();
  });
});
