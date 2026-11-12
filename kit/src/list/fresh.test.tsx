// @vitest-environment jsdom
// Свежесть ячейкой (SPRINT_UXR_S13_KIT4/K4-FRESHNESS).
//
// Повод — разбор kit по продуктам 11.11.2026: у реестра узлов MIDGARD, прогонов
// MUNINN и источников LORE главное в строке — «когда было в последний раз».
// Свежесть в kit жила только в шапке паспорта (RecordLoaded), ячейки не было.
//
// Граница K-14: какое поле считать временем и какие пороги — решает
// приложение; kit не знает, что такое «узел» или «прогон», и слов таких не
// печатает.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { validateKitConfig } from '../core/validate';
import schema from '../core/schema/kit-config.schema.json';
import { ListView } from './ListView';
import { FreshCell, freshOf, freshThresholdsFor } from './fresh';
import { colKey } from './sum';

beforeAll(() => { registerGameIcons(gameIcons); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const TH = { warnAfter: 10, staleAfter: 60 };

describe('freshOf: слова по диапазонам', () => {
  it.each([
    [0, 'now'],
    [0.5, 'now'],
    [3, 'min'],
    [59, 'min'],
    [60, 'hours'],
    [23 * 60 + 59, 'hours'],
  ])('%s мин назад → %s', (min, word) => {
    const f = freshOf(ago(min as number), NOW);
    expect(f.kind).toBe('at');
    if (f.kind === 'at') expect(f.word).toBe(word);
  });

  it('число в словах — целые минуты и часы', () => {
    const m = freshOf(ago(3), NOW);
    const h = freshOf(ago(125), NOW);
    expect(m.kind === 'at' && m.n).toBe(3);
    expect(h.kind === 'at' && h.n).toBe(2);
  });

  it('прошлые сутки по календарю — «вчера», раньше — дата', () => {
    const y = freshOf('2026-11-10T06:00:00Z', NOW);
    expect(y.kind === 'at' && y.word).toBe('yesterday');
    const d = freshOf('2026-11-06T09:00:00Z', NOW);
    expect(d.kind === 'at' && d.word).toBe('date');
    expect(d.kind === 'at' && d.date).toBe('2026-11-06');
  });
});

describe('freshOf: тон по порогам приложения', () => {
  it.each([
    [3, 'ok'],
    [10, 'warn'],
    [30, 'warn'],
    [60, 'stale'],
    [600, 'stale'],
  ])('%s мин при {10, 60} → %s', (min, tone) => {
    const f = freshOf(ago(min as number), NOW, TH);
    expect(f.kind === 'at' && f.tone).toBe(tone);
  });

  it('порогов нет — тона нет: kit не выдумывает, что считать «давно»', () => {
    const f = freshOf(ago(600), NOW);
    expect(f.kind === 'at' && f.tone).toBe('plain');
  });

  it('задан только один порог — работает он один', () => {
    expect((freshOf(ago(600), NOW, { staleAfter: 60 }) as { tone: string }).tone).toBe('stale');
    expect((freshOf(ago(30), NOW, { staleAfter: 60 }) as { tone: string }).tone).toBe('ok');
    expect((freshOf(ago(600), NOW, { warnAfter: 10 }) as { tone: string }).tone).toBe('warn');
  });
});

describe('freshOf: «времени нет» ≠ «давно»', () => {
  it.each([[null], [undefined], [''], ['   ']])('%s → none, а не stale', v => {
    expect(freshOf(v, NOW, TH)).toEqual({ kind: 'none' });
  });

  it('не дата — показываем как прислали, а не «давно»', () => {
    expect(freshOf('вчера вечером', NOW, TH)).toEqual({ kind: 'bad', raw: 'вчера вечером' });
  });
});

describe('FreshCell: что видит человек', () => {
  it('относительное время словами и полное время в подсказке', () => {
    const iso = ago(3);
    const { container } = render(<FreshCell value={iso} now={NOW} thresholds={TH} />);
    const el = container.querySelector('.sk-fresh') as HTMLElement;
    expect(el.textContent).toMatch(/3 мин назад/);
    expect(el.getAttribute('title')).toContain(iso);
    expect(el.getAttribute('data-tone')).toBe('ok');
  });

  it('устаревшее — тон stale и слово в строке, не только цвет', () => {
    const { container } = render(<FreshCell value={ago(125)} now={NOW} thresholds={TH} />);
    const el = container.querySelector('.sk-fresh') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('stale');
    expect(el.textContent).toMatch(/2 ч назад/);
    expect(el.textContent).toMatch(/устарело/);
  });

  it('пустое значение — нейтральные слова, тон none, никакого «назад»', () => {
    const { container } = render(<FreshCell value={null} now={NOW} thresholds={TH} />);
    const el = container.querySelector('.sk-fresh') as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('none');
    expect(el.textContent).toMatch(/времени нет/);
    expect(el.textContent).not.toMatch(/назад|устарело/);
  });

  it('kit не печатает предметных слов приложения', () => {
    const { container } = render(<FreshCell value={null} now={NOW} />);
    expect(container.textContent).not.toMatch(/узел|прогон|на связи|связь/i);
  });
});

describe('colKey знает префикс fresh:', () => {
  it('fresh:seen_at → seen_at', () => { expect(colKey('fresh:seen_at')).toBe('seen_at'); });
});

// ─── В списке ────────────────────────────────────────────────────────────────

const rec = (id: string, seen: string | null): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: { seen_at: seen } });

const cfg = (views: ('list' | 'board' | 'cards')[], withFresh = true): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { item: { title: 'Записи', icon: 'checkbox-tree', fields: [{ key: 'seen_at', title: 'Отметка', type: 'text' }] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: {
    views,
    columns: withFresh ? ['title+id', 'fresh:seen_at'] : ['title+id', 'fields.seen_at'],
    fresh: { seen_at: TH },
  },
});

const data: KitData = {
  records: [rec('R-1', ago(3)), rec('R-2', ago(30)), rec('R-3', ago(125)), rec('R-4', null)],
  edges: [], journal: [], meta: { generated_at: '2026-11-11T12:00:00Z', total: 4, truncated: false },
};

const minuteTimers = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(c => c[1] === 60_000).length;

describe('ListView: колонка fresh:<поле>', () => {
  it('рисует три тона и пустое значение; заголовок — по имени поля', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { container } = render(<ListView config={cfg(['list'])} data={data} />);
    const cells = Array.from(container.querySelectorAll('.sk-fresh')) as HTMLElement[];
    expect(cells.map(c => c.getAttribute('data-tone'))).toEqual(['ok', 'warn', 'stale', 'none']);
    expect(container.textContent).not.toContain('fresh:seen_at');
  });

  it('ОДИН таймер раз в минуту на весь список, а не на строку', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<ListView config={cfg(['list'])} data={data} />);
    expect(minuteTimers(spy)).toBe(1);
  });

  it('нет колонки свежести — нет и таймера', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(<ListView config={cfg(['list'], false)} data={data} />);
    expect(minuteTimers(spy)).toBe(0);
  });

  it('время тикает: через минуту «3 мин» становится «4 мин»', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = render(<ListView config={cfg(['list'])} data={data} />);
    const first = () => (container.querySelector('.sk-fresh') as HTMLElement).textContent;
    expect(first()).toMatch(/3 мин назад/);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(first()).toMatch(/4 мин назад/);
  });

  it('на доске — тот же вид в значках карточки', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    render(<ListView config={cfg(['board'])} data={data} />);
    const card = document.querySelector('.sk-board__card[data-record-id="R-3"]') as HTMLElement;
    expect(card).toBeTruthy();
    const badges = within(card).getByTestId('board-badges');
    expect(badges.querySelector('.sk-fresh')?.getAttribute('data-tone')).toBe('stale');
  });
});

// ─── Контракт ────────────────────────────────────────────────────────────────

describe('контракт: list.fresh', () => {
  const base = cfg(['list']);
  const issues = (fresh: unknown) => { const v = validateKitConfig({ ...base, list: { ...base.list, fresh } }); return [...v.errors, ...v.warnings]; };

  it('положительный контроль: корректные пороги — без замечаний по fresh', () => {
    expect(issues({ seen_at: TH }).filter(i => i.path.startsWith('list.fresh'))).toEqual([]);
  });

  it('порог не число или отрицательный — ошибка', () => {
    const e = issues({ seen_at: { warnAfter: 'десять' } }).filter(i => i.path.startsWith('list.fresh'));
    expect(e.some(i => i.level === 'error')).toBe(true);
    const n = issues({ seen_at: { staleAfter: -5 } }).filter(i => i.path.startsWith('list.fresh'));
    expect(n.some(i => i.level === 'error')).toBe(true);
  });

  it('предупреждение позже «устарело» — ошибка: тон warn не наступит никогда', () => {
    const e = issues({ seen_at: { warnAfter: 120, staleAfter: 60 } });
    expect(e.some(i => i.path.startsWith('list.fresh') && i.level === 'error')).toBe(true);
  });

  it('колонка fresh: без порогов — предупреждение, а не тишина', () => {
    const w = validateKitConfig({ ...base, list: { views: ['list'], columns: ['fresh:seen_at'] } }).warnings;
    expect(w.some(i => i.code === 'fresh-without-thresholds')).toBe(true);
  });

  it('JSON-схема знает list.fresh', () => {
    const list = (schema as { properties: { list: { properties: Record<string, unknown> } } }).properties.list.properties;
    expect(list.fresh).toBeTruthy();
  });
});

// ─── Пороги строки (S7B-ACT-1) ───────────────────────────────────────────────
// У каждой машины своё окно активности (1..24 ч, настройка в админке LORE): порог
// колонки один на список, а «давно» у строк разное. Приложение называет ПОЛЕ записи,
// где лежат минуты (perRecord) — kit берёт его, нет значения — порог колонки.

describe('пороги строки: list.fresh[поле].perRecord', () => {
  const recTh = (id: string, seen: string, stale?: number): KitRecord =>
    ({ id, kind: 'item', title: id, status: 'todo', fields: { seen_at: seen, ...(stale === undefined ? {} : { stale_min: stale }) } });

  it('freshThresholdsFor: число из поля записи главнее порога колонки; нет числа — порог колонки', () => {
    const th = { staleAfter: 60, perRecord: { staleAfter: 'stale_min' } };
    expect(freshThresholdsFor(th, recTh('A', ago(1), 1440))).toEqual({ staleAfter: 1440 });
    expect(freshThresholdsFor(th, recTh('B', ago(1)))).toEqual({ staleAfter: 60 });
    expect(freshThresholdsFor(th, { ...recTh('C', ago(1)), fields: { stale_min: 'много' } })).toEqual({ staleAfter: 60 });
    expect(freshThresholdsFor(undefined, recTh('D', ago(1), 5))).toBeUndefined();
  });

  it('ListView: одна и та же давность — у строки с окном сутки «ok», с окном час «устарело»', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const config: KitConfig = { ...cfg(['list']), list: { views: ['list'], columns: ['title+id', 'fresh:seen_at'],
      fresh: { seen_at: { staleAfter: 60, perRecord: { staleAfter: 'stale_min' } } } } };
    const d: KitData = { ...data, records: [recTh('DAY', ago(125), 1440), recTh('HOUR', ago(125), 60), recTh('COL', ago(125))] };
    const { container } = render(<ListView config={config} data={d} />);
    const tones = Array.from(container.querySelectorAll('.sk-fresh')).map(c => c.getAttribute('data-tone'));
    expect(tones).toEqual(['ok', 'stale', 'stale']);
  });

  it('контракт: perRecord — имена полей строкой; иначе ошибка; JSON-схема его знает', () => {
    const base = cfg(['list']);
    const issues = (fresh: unknown) => { const v = validateKitConfig({ ...base, list: { ...base.list, fresh } }); return [...v.errors, ...v.warnings]; };
    expect(issues({ seen_at: { staleAfter: 60, perRecord: { staleAfter: 'stale_min' } } }).filter(i => i.path.startsWith('list.fresh'))).toEqual([]);
    expect(issues({ seen_at: { perRecord: { staleAfter: 5 } } }).some(i => i.path.startsWith('list.fresh') && i.level === 'error')).toBe(true);
    expect(issues({ seen_at: { perRecord: { soon: 'x' } } }).some(i => i.path.startsWith('list.fresh'))).toBe(true);
    const list = (schema as unknown as { properties: { list: { properties: Record<string, { additionalProperties?: { properties?: Record<string, unknown> } }> } } }).properties.list.properties;
    expect(list.fresh.additionalProperties?.properties?.perRecord).toBeTruthy();
  });
});
