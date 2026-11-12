// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35 + ADR-LORE-049 (подтверждён владелицей 11.11:
// «s4-35 да») — ширина колонок «по содержимому И по важности», длинное — под
// многоточие с подсказкой.
//
// Модель уже отдаёт у каждого поля `display: {priority 1..4, width xs|s|m|l|fill,
// overflow none|ellipsis|more}` (серверный #982), kit её разбирает
// (`configFromModel` → `display`) — и НИГДЕ не применял. Написано и не
// подключено: приоритеты колонок не прятали наименее важное, ширина бралась
// браузером, длинное значение рвало строку.
//
// Правила ADR-LORE-049 §1–2: 1280 → прячется p4, 1100 → p3, 900 → p2; p1
// («запись», статус) не прячется никогда. Многоточие — с полным текстом в
// подсказке И раскрытием по касанию: на телефоне наведения нет.
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const LONG = 'Очень длинное значение поля, которое не помещается в колонку и раньше рвало строку';
const base: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [
    { key: 'release', title: 'Релиз', type: 'text' },
    { key: 'goal', title: 'Цель', type: 'text' },
  ] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], columns: ['title+id', 'fields.release', 'fields.goal'], showClosed: 'all' },
};
const rec: KitRecord = { id: 'S1', kind: 'sprint', title: 'Спринт 1', status: 'todo', fields: { release: 'v1.17', goal: LONG } };
const data: KitData = { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z', total: 1 } };
const withDisplay = (d: NonNullable<KitConfig['list']>['columnDisplay']): KitConfig => ({ ...base, list: { ...base.list!, columnDisplay: d } });
const th = (c: string) => document.querySelector(`th.sk-list__c-${c}`) as HTMLElement;
const td = (c: string) => document.querySelector(`[data-record-id="S1"] td.sk-list__c-${c}`) as HTMLElement;

describe('S4-35 · display колонки из модели доходит до таблицы', () => {
  it('положительный контроль: без display классов приоритета и ширины нет', () => {
    render(<ListView config={base} data={data} urlState={false} />);
    expect(th('fields-release').className).not.toMatch(/sk-list__p\d/);
    expect(th('fields-release').getAttribute('data-w')).toBeNull();
  });

  it('приоритет 4 и ширина s — у заголовка и у ячейки', () => {
    render(<ListView config={withDisplay({ release: { priority: 4, width: 's', overflow: 'none' } })} data={data} urlState={false} />);
    for (const el of [th('fields-release'), td('fields-release')]) {
      expect(el.classList.contains('sk-list__p4')).toBe(true);
      expect(el.getAttribute('data-w')).toBe('s');
    }
  });

  it('ключ поля без приставки «fields.» тоже находится — модель зовёт поле по имени', () => {
    render(<ListView config={withDisplay({ 'fields.release': { priority: 3 } })} data={data} urlState={false} />);
    expect(th('fields-release').classList.contains('sk-list__p3')).toBe(true);
  });

  it('приоритет 1 не прячется никогда — класса нет', () => {
    render(<ListView config={withDisplay({ release: { priority: 1 } })} data={data} urlState={false} />);
    expect(th('fields-release').className).not.toMatch(/sk-list__p\d/);
  });

  it('многоточие: полный текст в подсказке, касание раскрывает', () => {
    render(<ListView config={withDisplay({ goal: { priority: 2, width: 'm', overflow: 'ellipsis' } })} data={data} urlState={false} />);
    const box = td('fields-goal').querySelector('.sk-list__ellip') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.getAttribute('title')).toBe(LONG);
    expect(box.getAttribute('data-open')).toBeNull();
    fireEvent.click(box);
    expect(box.getAttribute('data-open')).toBe('true');
    fireEvent.click(box);
    expect(box.getAttribute('data-open')).toBeNull();
  });

  it('подпись значения лежит в своей обёртке чипа — многоточие применимо к ней', () => {
    render(<ListView config={base} data={data} urlState={false} />);
    const val = td('fields-goal').querySelector('.sk-list__val') as HTMLElement;
    expect(val).toBeTruthy();
    const label = val.querySelector('.sk-list__val-t') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.textContent).toBe(LONG);
  });
});

describe('S4-35 · правила CSS по ADR-LORE-049', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
  const media = (w: number) => {
    const i = css.indexOf(`@media (max-width: ${w}px) {\n  .sk-list__p`);
    return i < 0 ? '' : css.slice(i, css.indexOf('}\n}', i) + 3);
  };

  it('1280 → прячется p4, 1100 → p3, 900 → p2', () => {
    expect(media(1280)).toMatch(/\.sk-list__p4\s*\{\s*display:\s*none/);
    expect(media(1100)).toMatch(/\.sk-list__p3\s*\{\s*display:\s*none/);
    expect(media(900)).toMatch(/\.sk-list__p2\s*\{\s*display:\s*none/);
  });

  it('многоточие обрезает строку, раскрытое — переносит', () => {
    expect(css).toMatch(/\.sk-list__ellip\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.sk-list__ellip\[data-open='true'\]\s*\{[^}]*white-space:\s*normal/);
  });

  it('подпись значения-чипа обрезается многоточием, а не срезом без знака', () => {
    // Раньше длинная подпись чипа упиралась в overflow ячейки и обрывалась
    // посередине буквы — по виду не отличить от полного текста. Теперь чип
    // сжимается (min-width: 0) и прячет обрез под text-overflow.
    expect(css).toMatch(/\.sk-list__val\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.sk-list__val-t\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('ширины колонок — по шагам xs/s/m/l', () => {
    for (const w of ['xs', 's', 'm', 'l']) expect(css).toMatch(new RegExp(`\\[data-w='${w}'\\]`));
  });
});
