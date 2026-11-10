// @vitest-environment jsdom
// Вложенный блок ВИДА (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED).
//
// Контракт владелицы: «зависимый объект показывается вложенным блоком СВОЕГО
// вида: тот же рендер, что у его паспорта или строки. Заново у родителя его не
// рисуют».
//
// Поэтому тесты проверяют ПРАВИЛО «рендера не три, а те же самые», а не вид
// конкретного блока: признак — разметка приходит теми классами, которые уже
// описаны в seidr.css для строки списка, карточки и тела паспорта. Свой третий
// рендер неизбежно принёс бы свои классы, и это здесь покраснеет.
//
// Вид берётся из `record.kind`: родитель не называет вид вложенного блока — он
// его и не знает (у него может лежать что угодно).
//
// Вида нет в конфиге — ЧЕСТНЫЙ ОТКАЗ СЛОВАМИ. Пустой блок читается как «данных
// нет», а это не одно и то же: данные есть, показать их нечем.
//
// Предметных имён LORE в тестах тоже нет (K-14): уровни и виды здесь — чужого
// приложения (курс → модуль → урок), и kit о них знает ровно столько, сколько
// пришло данными.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { definedClasses, usedClasses } from '../test/cssClasses';
import { KindBlock } from './KindBlock';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const config: KitConfig = {
  modules: [],
  menu: { groups: [] },
  kinds: {
    course: { title: 'Курс', icon: 'book-cover', fields: [{ key: 'owner', title: 'Ведёт', type: 'text' }] },
    lesson: {
      title: 'Урок',
      icon: 'quill-ink',
      fields: [{ key: 'mins', title: 'Минут', type: 'number' }],
      bodySections: [{ key: 'note_md', title: 'Конспект' }],
    },
  },
  statuses: {
    items: [
      { code: 'open', title: 'Идёт', category: 'in_progress', icon: 'play-button', color: 'var(--acc)' },
      { code: 'done', title: 'Пройден', category: 'finished', icon: 'check-mark', color: 'var(--suc)' },
    ],
  },
  roles: { reader: { canEdit: false, canStatus: false }, teacher: { canEdit: true, canStatus: true } },
  list: { views: ['list'], columns: ['status', 'id', 'title', 'fields.mins'] },
};

const lesson: KitRecord = {
  id: 'L-1',
  kind: 'lesson',
  title: 'Рунный строй',
  status: 'open',
  fields: { mins: 45, note_md: 'Старший футарк: 24 знака.' },
};

function ctxOf(role = 'reader', records: KitRecord[] = [lesson]): KitCtx {
  return {
    config,
    role,
    data: { records, edges: [], journal: [], meta: { generated_at: '2026-11-10T00:00:00Z' } },
    href: id => `?open=${id}`,
    esc: s => s,
    md: s => <div className="sk-prose">{s}</div>,
  };
}

const show = (node: React.ReactNode) => render(<KitLangProvider lang="ru">{node}</KitLangProvider>);

describe('S4-TREE-NESTED · KindBlock — вложенный блок своего вида', () => {
  it('положительный контроль: все три вида блока показывают запись', () => {
    for (const as of ['row', 'card', 'full'] as const) {
      const { container, unmount } = show(<KindBlock record={lesson} ctx={ctxOf()} as={as} />);
      expect(container.textContent, as).toContain(as === 'full' ? 'Конспект' : 'Рунный строй');
      unmount();
    }
  });

  it('as="row" — строка списка: разметка и колонки списка, а не свои', () => {
    const { container } = show(<KindBlock record={lesson} ctx={ctxOf()} as="row" />);
    expect(container.querySelector('.sk-list__table')).toBeTruthy();
    expect(container.querySelector('.sk-list__row')).toBeTruthy();
    // Колонки — те, что названы в конфигурации списка (тот же набор, что в разделе).
    const heads = within(screen.getByRole('table')).getAllByRole('columnheader').map(th => th.textContent?.trim());
    expect(heads).toEqual(['Статус', 'Код', 'Запись', 'Минут']);
    const cells = within(screen.getByRole('table')).getAllByRole('cell');
    expect(cells).toHaveLength(4);
  });

  it('as="card" — карточка того же вида, что у списка «Карточки»', () => {
    const { container } = show(<KindBlock record={lesson} ctx={ctxOf()} as="card" />);
    expect(container.querySelector('.sk-cards__card')).toBeTruthy();
    expect(container.querySelector('.sk-cards__title')?.textContent).toContain('Рунный строй');
    // Поля карточки — поля вида из конфига, с их подписями.
    expect(container.querySelector('.sk-cards__fields')?.textContent).toContain('Минут');
  });

  it('as="full" — тело паспорта БЕЗ шапки и вкладок', () => {
    const { container } = show(<KindBlock record={lesson} ctx={ctxOf()} as="full" />);
    // Тело — теми же классами, что в паспорте: разделы тела и свойства.
    expect(container.querySelector('.sk-rec-sections')).toBeTruthy();
    expect(container.querySelector('.sk-rec-fields')).toBeTruthy();
    expect(container.textContent).toContain('Старший футарк');
    // …и ни шапки записи, ни вкладок: блок вложен, второй шапки у него нет.
    expect(container.querySelector('.sk-rec-head')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('вид берётся из record.kind: один и тот же блок рисует разные виды', () => {
    const course: KitRecord = { id: 'C-1', kind: 'course', title: 'Руны', status: 'open', fields: { owner: 'Эйрик' } };
    const { container } = show(<KindBlock record={course} ctx={ctxOf('reader', [course])} as="card" />);
    expect(container.querySelector('.sk-cards__fields')?.textContent).toContain('Ведёт');
    expect(container.querySelector('.sk-cards__fields')?.textContent).not.toContain('Минут');
  });

  it('вида нет в конфиге — отказ СЛОВАМИ, а не пустой блок', () => {
    const alien: KitRecord = { id: 'X-1', kind: 'riddle', title: 'Загадка', status: 'open', fields: {} };
    const { container } = show(<KindBlock record={alien} ctx={ctxOf('reader', [alien])} as="row" />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/не описан/);
    expect(text).toContain('riddle');
    // «Пусто» — это другое утверждение, и его здесь быть не должно.
    expect(text.trim().length).toBeGreaterThan(20);
    expect(container.querySelector('.sk-list__row')).toBeNull();
  });

  it('отказ одинаков во всех трёх видах блока: нечем рисовать — значит нечем', () => {
    const alien: KitRecord = { id: 'X-1', kind: 'riddle', title: 'Загадка', status: 'open', fields: {} };
    for (const as of ['row', 'card', 'full'] as const) {
      const { container, unmount } = show(<KindBlock record={alien} ctx={ctxOf('reader', [alien])} as={as} />);
      expect(container.textContent, as).toMatch(/не описан/);
      unmount();
    }
  });

  it('все классы sk-… блока описаны в seidr.css (единый слой, S4-00e)', () => {
    const defined = definedClasses(css);
    for (const as of ['row', 'card', 'full'] as const) {
      const { container, unmount } = show(<KindBlock record={lesson} ctx={ctxOf()} as={as} />);
      const missing = [...usedClasses(container.innerHTML)].filter(c => c.startsWith('sk-') && !defined.has(c));
      expect(missing, as).toEqual([]);
      unmount();
    }
  });
});
