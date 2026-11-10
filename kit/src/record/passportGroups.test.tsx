// @vitest-environment jsdom
// Паспорта v3: ГРУППА РАЗДЕЛОВ — одна вкладка; «Ещё» решает ряд; «0» и «?» —
// разные ответы (10.11.2026, D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11).
//
// Три правила, каждое со своей ценой за нарушение.
//
// 1) ГРУППА — ОДНА ВКЛАДКА. Модель шестым ключом говорит, какие разделы
//    родственны (`group: {key, label}`); они идут подряд, рисуются одной
//    вкладкой с подписью группы, внутри — подзаголовками по разделам, а
//    счётчик вкладки — СУММА. Без склейки родственные разделы занимали бы в
//    ряду по месту каждый, и ряд переполнялся именно тем, что человек считает
//    одним делом.
//
// 2) «ЕЩЁ» СЧИТАЕТ РЯД, А НЕ МОДЕЛЬ. `slot: more` убран: сервер не знает ни
//    ширины окна, ни того, сколько вкладок у записи набралось вместе со
//    служебными. Потолок — семь (shell/tabRow.ts); здесь проверяется, что он
//    доходит до живого паспорта, а не живёт в отдельной функции.
//
// 3) «0 ПРОВЕРЕНО» ≠ «НЕ ПРОВЕРЕНО». Пустая вкладка остаётся на месте с нулём.
//    Но раздел, про который фасад данных сказал «не читал» (`meta.data_state`
//    строкой `{source: "relation:<ключ>", part: "<ключ>", state: "error"}`),
//    показывается знаком вопроса с причиной. Ложный ноль здесь — худший из
//    исходов: человек решает «связей нет» по данным, которых никто не смотрел.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitMeta, KitRecord, KitRelationDef } from '../core/contract';
import type { PassportOrder } from '../model/surfaces';
import { RecordView } from './RecordView';
import { axeViolations } from '../test/axe';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: {} });
const host = r('H-1', 'host', 'Запись');
const kids = ['K-1', 'K-2', 'K-3'].map(id => r(id, 'kid', `Дочка ${id}`));
const records = [host, ...kids];
const edges = [
  { from: 'H-1', to: 'K-1', type: 'HAS_PART' },
  { from: 'H-1', to: 'K-2', type: 'HAS_NOTE' },
  { from: 'H-1', to: 'K-3', type: 'HAS_NOTE' },
];

const rel = (key: string, label: string, rl: string): KitRelationDef =>
  ({ key, label, relation: 'aggregation', rel: rl, dir: 'out' });

const configOf = (relations: KitRelationDef[], tabs?: { key: string; title: string }[]): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: {
    host: {
      title: 'Запись', icon: 'scroll-quill',
      fields: [{ key: 'version', title: 'Версия', type: 'text' }],
      relations,
      ...(tabs ? { tabs: tabs.map(t => ({ ...t, render: () => 'тело вкладки' })) } : {}),
    },
  },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
});

const RELATIONS: KitRelationDef[] = [
  { key: 'kids', label: 'Дочки', relation: 'composition', rel: 'HAS_PART', dir: 'out' },
  rel('notes', 'Заметки', 'HAS_NOTE'),
  rel('files', 'Вложения', 'HAS_FILE'),
];

const ctxOf = (config: KitConfig, meta: Record<string, unknown> = {}): KitCtx => ({
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records, edges, journal: [], meta: { generated_at: '2026-11-10T00:00:00Z', ...meta } as unknown as KitMeta },
});

/** Группа «Связи» из двух разделов; «Дочки» сами по себе. */
const GROUPED: PassportOrder = {
  decided: true, notes: [],
  sections: [
    { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own', group: null },
    { key: 'kids', source: 'relation', ref: 'HAS_PART', order: 2, slot: 'own', group: null },
    { key: 'notes', source: 'relation', ref: 'HAS_NOTE', order: 3, slot: 'own', group: { key: 'ties', label: 'Окружение' } },
    { key: 'files', source: 'relation', ref: 'HAS_FILE', order: 4, slot: 'own', group: { key: 'ties', label: 'Окружение' } },
  ],
};

const view = (sections?: PassportOrder, tab = 'overview', meta: Record<string, unknown> = {}, config = configOf(RELATIONS)) =>
  render(<RecordView record={host} ctx={ctxOf(config, meta)} tab={tab} onTab={() => {}} placement="bottom" sections={sections} />);

const rowNames = () => screen.getAllByRole('tab').map(t => (t.textContent ?? '').replace(/[◆◇⇢▷△]/g, ''));
/** Только подписи вкладок ряда, без значков и счётчиков. */
const rowLabels = () => screen.getAllByRole('tab')
  .map(t => t.querySelector('span:not(.sk-tab__count):not(.sk-tab__mark)')?.textContent ?? '');
const tabOf = (label: string) => screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes(label));
const countOf = (label: string) => tabOf(label)?.querySelector('.sk-tab__count')?.textContent;

describe('1) группа разделов — ОДНА вкладка с подписью группы', () => {
  it('положительный контроль: без группы каждый раздел — своя вкладка', () => {
    view();
    expect(rowNames().some(n => n.startsWith('Заметки'))).toBe(true);
    expect(rowNames().some(n => n.startsWith('Вложения'))).toBe(true);
    expect(tabOf('Окружение')).toBeUndefined();
  });

  it('вкладка группы названа подписью группы, а разделов в ряду больше нет', () => {
    view(GROUPED);
    expect(tabOf('Окружение')).toBeTruthy();
    expect(rowNames().some(n => n.startsWith('Заметки'))).toBe(false);
    expect(rowNames().some(n => n.startsWith('Вложения'))).toBe(false);
    // Раздел вне группы своей вкладки не лишается.
    expect(rowNames().some(n => n.startsWith('Дочки'))).toBe(true);
  });

  it('счётчик вкладки — СУММА счётчиков разделов, а не число первого из них', () => {
    // Заметок две, вложений ноль: вкладка говорит «2». Показать «0» (по
    // последнему) или «2» как «только заметки» значило бы соврать о том, сколько
    // всего под этой вкладкой лежит.
    view(GROUPED);
    expect(countOf('Окружение')).toBe('2');
  });

  it('внутри вкладки — подзаголовки по разделам, подпись берётся из описания связи', () => {
    view(GROUPED, 'ties');
    const panel = screen.getByRole('tabpanel');
    const heads = Array.from(panel.querySelectorAll('.sk-rec-group__head')).map(h => h.textContent ?? '');
    expect(heads.map(h => h.replace(/\d+|\?/g, '').trim())).toEqual(['Заметки', 'Вложения']);
  });

  it('у каждого подзаголовка свой счётчик: сумма не прячет, из чего она собрана', () => {
    view(GROUPED, 'ties');
    const panel = screen.getByRole('tabpanel');
    const secs = Array.from(panel.querySelectorAll('.sk-rec-group__sec'));
    expect(secs.map(s => s.querySelector('.sk-tab__count')?.textContent)).toEqual(['2', '0']);
  });

  it('порядок разделов внутри — порядок модели, а не порядок связей у типа', () => {
    const reversed: PassportOrder = {
      ...GROUPED,
      sections: [
        GROUPED.sections[0], GROUPED.sections[1],
        { ...GROUPED.sections[3], order: 3 },
        { ...GROUPED.sections[2], order: 4 },
      ],
    };
    view(reversed, 'ties');
    const heads = Array.from(screen.getByRole('tabpanel').querySelectorAll('.sk-rec-group__head'))
      .map(h => (h.textContent ?? '').replace(/\d+|\?/g, '').trim());
    expect(heads).toEqual(['Вложения', 'Заметки']);
  });

  it('ссылка на раздел, который теперь внутри группы, открывает ГРУППУ, а не обзор', () => {
    // Адрес мог быть сохранён до того, как разделы сгруппировали. Молча увести
    // человека на обзор — то же, что сломать ссылку.
    view(GROUPED, 'files');
    expect(tabOf('Окружение')?.getAttribute('aria-selected')).toBe('true');
    const heads = Array.from(screen.getByRole('tabpanel').querySelectorAll('.sk-rec-group__head'));
    expect(heads).toHaveLength(2);
  });

  it('раздел, которого kit внутри группы нарисовать не умеет, остаётся своей вкладкой', () => {
    // Группа склеивается из разделов-связей: их рендер у kit есть. Вкладку вида
    // от приложения внутрь группы положить нельзя — её рисует приложение.
    // Показать раздел не там, где просили, — полбеды; не показать вовсе —
    // потеря данных с экрана.
    const config = configOf(RELATIONS, [{ key: 'own', title: 'Своя' }]);
    const withForeign: PassportOrder = {
      decided: true, notes: [],
      sections: [
        { key: 'notes', source: 'relation', ref: 'HAS_NOTE', order: 1, slot: 'own', group: { key: 'ties', label: 'Окружение' } },
        { key: 'own', source: 'part', ref: 'own', order: 2, slot: 'own', group: { key: 'ties', label: 'Окружение' } },
      ],
    };
    view(withForeign, 'overview', {}, config);
    expect(tabOf('Окружение')).toBeTruthy();
    expect(rowNames().some(n => n.startsWith('Своя'))).toBe(true);
  });

  it('вкладка группы допустима по ARIA и класс группы описан в seidr.css', () => {
    expect(css).toMatch(/\.sk-rec-group\b/);
    expect(css).toMatch(/\.sk-rec-group__head\b/);
  });

  it('ряд с группой проходит axe', async () => {
    const { container } = view(GROUPED, 'ties');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('2) «Ещё» в живом паспорте: потолок семь', () => {
  // Девять связей плюс обзор, свойства и служебное — ряд заведомо длиннее
  // потолка. Модель при этом НИЧЕГО не прячет: `slot` у всех `own`.
  const many = Array.from({ length: 9 }, (_, i) => rel(`r${i}`, `Раздел ${i}`, `R${i}`));
  const all: PassportOrder = {
    decided: true, notes: [],
    sections: many.map((d, i) => ({ key: d.key, source: 'relation' as const, ref: d.rel, order: i + 1, slot: 'own' as const, group: null })),
  };

  it('положительный контроль: модель не просила ничего прятать', () => {
    expect(all.sections.every(s => s.slot === 'own')).toBe(true);
  });

  it('в ряду не больше семи вкладок, остальное — под «Ещё»', () => {
    view(all, 'overview', {}, configOf(many));
    expect(screen.getAllByRole('tab').filter(t => !/Ещё/.test(t.textContent ?? ''))).toHaveLength(7);
    expect(screen.getByRole('tab', { name: /Ещё/ })).toBeTruthy();
  });

  it('в ряду — ПЕРВЫЕ по порядку модели: уходит хвост, а не что попало', () => {
    view(all, 'overview', {}, configOf(many));
    const names = rowLabels().filter(n => n !== 'Ещё');
    expect(names.slice(0, 3)).toEqual(['Раздел 0', 'Раздел 1', 'Раздел 2']);
  });

  it('спрятанное ДОСТУПНО под свёрткой со своим счётчиком: это перенос, а не удаление', () => {
    view(all, 'overview', {}, configOf(many));
    fireEvent.click(screen.getByRole('tab', { name: /Ещё/ }));
    const menu = screen.getByRole('menu', { name: 'Ещё' });
    const item = within(menu).getByRole('menuitem', { name: /Раздел 8/ });
    expect(item.querySelector('.sk-tab__count')?.textContent).toBe('0');
  });

  it('открытая вкладка в ряду, даже если по порядку она в хвосте', () => {
    view(all, 'r8', {}, configOf(many));
    expect(rowNames().some(n => n.startsWith('Раздел 8'))).toBe(true);
    expect(screen.getAllByRole('tab').filter(t => !/Ещё/.test(t.textContent ?? ''))).toHaveLength(7);
  });
});

describe('3) «0 проверено» и «не проверено» — разные ответы', () => {
  it('положительный контроль: пустая вкладка остаётся на месте и говорит «0»', () => {
    view();
    expect(rowNames().some(n => n.startsWith('Вложения'))).toBe(true);
    expect(countOf('Вложения')).toBe('0');
  });

  it('фасад данных раздел не читал — «?» с причиной, а не «0»', () => {
    // Форма строки — дословно с серверной стороны: источник `relation:<ключ>`
    // и часть `<ключ>`.
    view(undefined, 'overview', {
      data_state: [{ source: 'relation:files', part: 'files', state: 'error', reason: 'срез не отвечал' }],
    });
    expect(countOf('Вложения')).toBe('?');
    expect(tabOf('Вложения')?.querySelector('.sk-tab__count')?.getAttribute('data-unknown')).toBe('');
    expect(tabOf('Вложения')?.querySelector('.sk-tab__count')?.getAttribute('title')).toMatch(/не смогли/i);
  });

  it('«нет прав» — тоже не ноль: ждать нечего, но и «пусто» это не значит', () => {
    view(undefined, 'overview', {
      data_state: [{ source: 'relation:files', part: 'files', state: 'forbidden', reason: 'нет прав' }],
    });
    expect(countOf('Вложения')).toBe('?');
  });

  it('у СУММЫ группы один непроверенный раздел делает неизвестной всю сумму', () => {
    // Иначе вкладка показала бы «2» там, где на самом деле «2 и неизвестно
    // сколько ещё». Частичная сумма выглядит точной — это и есть ложь.
    view(GROUPED, 'overview', {
      data_state: [{ source: 'relation:files', part: 'files', state: 'error', reason: 'срез не отвечал' }],
    });
    expect(countOf('Окружение')).toBe('?');
  });

  it('и внутри вкладки непроверенный раздел помечен сам, а не выброшен', () => {
    view(GROUPED, 'ties', {
      data_state: [{ source: 'relation:files', part: 'files', state: 'error', reason: 'срез не отвечал' }],
    });
    const secs = Array.from(screen.getByRole('tabpanel').querySelectorAll('.sk-rec-group__sec'));
    expect(secs).toHaveLength(2);
    expect(secs.map(s => s.querySelector('.sk-tab__count')?.textContent)).toEqual(['2', '?']);
  });

  it('проверенный раздел рядом с непроверенным остаётся числом: «?» не расползается', () => {
    view(undefined, 'overview', {
      data_state: [{ source: 'relation:files', part: 'files', state: 'error', reason: 'срез не отвечал' }],
    });
    expect(countOf('Заметки')).toBe('2');
    expect(countOf('Дочки')).toBe('1');
  });
});
