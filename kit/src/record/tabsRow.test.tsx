// @vitest-environment jsdom
// Ряд вкладок паспорта: ровный шаг, «Ещё N» и ОДНО правило счётчика
// (ревью 10.11.2026, B13: «строка связей плывёт на 3–4 строки с рваными
// промежутками; иконки отрываются от подписей; счётчики то есть, то нет
// („Заменён" — без)»).
//
// Три утверждения, каждое отдельно:
//  1) раскладка — чип не разрывается (значок остаётся при подписи) и не
//     растягивается, шаг ряда один и тот же по обеим осям;
//  2) «под Ещё» — по месту в ряду, и там раздел ДОСТУПЕН: это перенос, а не
//     удаление. Своего приоритета kit не придумывает: ПОРЯДОК приходит из
//     модели (`surfaces.passport.<type>.sections`), а под свёртку уходит хвост
//     этого порядка — то, что не влезло по ширине или за потолок в семь вкладок
//     (паспорта v3, 10.11.2026: прежнее `slot: more` было решением о чужом
//     экране вслепую — сервер не знает ни ширины окна, ни того, сколько вкладок
//     у записи набралось вместе со служебными);
//  3) счётчик — по одному правилу: у раздела-коллекции он есть всегда, а
//     «не смогли посчитать» показывается знаком вопроса с подсказкой, а не
//     прячется и не выдаётся за ноль.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitMeta, KitRecord } from '../core/contract';
import type { PassportOrder } from '../model/surfaces';
import { RecordView } from './RecordView';
import { axeViolations } from '../test/axe';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: {} });
const host = r('H-1', 'host', 'Запись');
const records = [host, r('K-1', 'kid', 'Дочка')];
const edges = [{ from: 'H-1', to: 'K-1', type: 'HAS_PART' }];

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    host: {
      title: 'Запись', icon: 'scroll-quill',
      fields: [{ key: 'version', title: 'Версия', type: 'text' }],
      relations: [
        { key: 'kids', label: 'Дочки', relation: 'composition', rel: 'HAS_PART', dir: 'out' },
        { key: 'notes', label: 'Заметки', relation: 'aggregation', rel: 'HAS_NOTE', dir: 'out' },
        { key: 'files', label: 'Вложения', relation: 'aggregation', rel: 'HAS_FILE', dir: 'out' },
      ],
    },
  },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};

// `data_state` в типе meta не объявлен (его разбирает dataStateOf как слово
// сервера) — поэтому мета в тестах приходит записью и приводится к KitMeta.
const ctxOf = (meta: Record<string, unknown> = {}): KitCtx => ({
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records, edges, journal: [], meta: { generated_at: '2026-11-10T00:00:00Z', ...meta } as unknown as KitMeta },
});

/**
 * Ряд длиннее потолка: модель называет «Вложения» ПОСЛЕДНИМИ, и в семь вкладок
 * они не попадают.
 *
 * Модель при этом ничего не прячет — у всех разделов `slot: own`. Прятать
 * нечего и некому: «не влезло» считает ряд, а модель только расставляет
 * порядок. Четыре безымянных раздела между ними — не декорация: без них
 * «Вложения» оказались бы четвёртыми и влезли, и тест проверял бы не то, что
 * написано в его названии.
 */
const PAST_CEILING: PassportOrder = {
  decided: true, notes: [],
  sections: [
    { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own', group: null },
    { key: 'kids', source: 'relation', ref: 'HAS_PART', order: 2, slot: 'own', group: null },
    { key: 'notes', source: 'relation', ref: 'HAS_NOTE', order: 3, slot: 'own', group: null },
    ...[0, 1, 2, 3].map(i => ({ key: `x${i}`, source: 'relation' as const, ref: `X${i}`, order: 4 + i, slot: 'own' as const, group: null })),
    { key: 'files', source: 'relation', ref: 'HAS_FILE', order: 9, slot: 'own', group: null },
  ],
};

/** Тот же тип, но со связями `x0…x3` — чтобы ряду было чем перевалить потолок. */
const padded: KitConfig = {
  ...config,
  kinds: {
    host: {
      ...config.kinds.host,
      relations: [
        ...(config.kinds.host.relations ?? []).slice(0, 2),
        ...[0, 1, 2, 3].map(i => ({ key: `x${i}`, label: `Прочее ${i}`, relation: 'aggregation' as const, rel: `X${i}`, dir: 'out' as const })),
        ...(config.kinds.host.relations ?? []).slice(2),
      ],
    },
  },
};

const view = (tab = 'overview', meta: Record<string, unknown> = {}, sections?: PassportOrder, cfg: KitConfig = config) =>
  render(<RecordView record={host} ctx={{ ...ctxOf(meta), config: cfg }} tab={tab} onTab={() => {}} placement="bottom" sections={sections} />);
/** Ряд, в котором «Вложения» заведомо за потолком. */
const viewPast = (tab = 'overview', meta: Record<string, unknown> = {}) => view(tab, meta, PAST_CEILING, padded);
const rowNames = () => screen.getAllByRole('tab').map(t => (t.textContent ?? '').replace(/[◆◇⇢▷△]/g, ''));
const countOf = (label: string) => {
  const tab = screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes(label));
  return tab?.querySelector('.sk-tab__count')?.textContent;
};

describe('B13 · 1) раскладка ряда вкладок', () => {
  it('положительный контроль: правила ряда и чипа найдены', () => {
    expect(ruleOf('.sk-tabs')).not.toBe('');
    expect(ruleOf('.sk-tab')).not.toBe('');
  });

  it('чип не разрывается: значок остаётся при подписи, перенос внутри запрещён', () => {
    expect(ruleOf('.sk-tab')).toMatch(/white-space:\s*nowrap/);
  });

  it('чип не тянется и не сжимается — иначе промежутки в ряду рваные', () => {
    expect(ruleOf('.sk-tab')).toMatch(/flex:\s*0\s+0\s+auto/);
  });

  it('шаг ряда один и тот же по обеим осям, строки выровнены по центру', () => {
    const row = ruleOf('.sk-tabs');
    const gap = /row-gap:\s*(\d+)px/.exec(row)?.[1];
    const col = /column-gap:\s*(\d+)px/.exec(row)?.[1];
    expect(gap).toBeDefined();
    expect(col).toBe(gap);
    expect(row).toMatch(/align-items:\s*center/);
  });
});

describe('B13 · 2) «под Ещё» решает ряд, а порядок — модель', () => {
  it('положительный контроль: вкладок меньше потолка — не прячется НИЧЕГО', () => {
    view();
    expect(rowNames().some(n => n.startsWith('Заметки'))).toBe(true);
    expect(rowNames().some(n => n.startsWith('Вложения'))).toBe(true);
    expect(screen.queryByRole('tab', { name: /Ещё/ })).toBeNull();
  });

  it('`decided: false` — порядок за приложением, и прятать это тоже не повод', () => {
    view('overview', {}, { decided: false, sections: [], notes: [] });
    expect(screen.queryByRole('tab', { name: /Ещё/ })).toBeNull();
  });

  it('раздел за потолком ряда уходит под «Ещё», и число спрятанного названо', () => {
    viewPast();
    expect(rowNames().some(n => n.startsWith('Вложения'))).toBe(false);
    // «Ещё» без числа не говорит, стоит ли открывать.
    expect(screen.getByRole('tab', { name: /Ещё.*\d/ })).toBeTruthy();
  });

  it('спрятанное ДОСТУПНО и со своим счётчиком: «под ещё» — перенос, а не удаление', () => {
    viewPast();
    fireEvent.click(screen.getByRole('tab', { name: /Ещё/ }));
    const menu = screen.getByRole('menu', { name: 'Ещё' });
    const item = within(menu).getByRole('menuitem', { name: /Вложения/ });
    expect(item.querySelector('.sk-tab__count')?.textContent).toBe('0');
  });

  it('открытая вкладка остаётся в ряду, даже будучи за потолком: прятать читаемое нельзя', () => {
    viewPast('files');
    expect(rowNames().some(n => n.startsWith('Вложения'))).toBe(true);
  });

  it('ряд со свёрткой допустим по ARIA: role="tablist" не содержит чужих детей', async () => {
    const { container } = viewPast();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('B13 · 3) счётчик — по одному правилу', () => {
  it('положительный контроль: у непустого раздела счётчик есть', () => {
    view();
    expect(countOf('Дочки')).toBe('1');
  });

  it('у каждого раздела-коллекции в ряду счётчик есть — «то есть, то нет» кончилось', () => {
    view('notes');
    for (const t of screen.getAllByRole('tab')) {
      const txt = t.textContent ?? '';
      if (!/Дочки|Заметки|Вложения|Связи|Журнал/.test(txt)) continue;
      expect(t.querySelector('.sk-tab__count')?.textContent).toBeTruthy();
    }
  });

  it('блок данных не прочитался — счётчик «?» с подсказкой, а не ложный ноль', () => {
    view('overview', { data_state: [{ source: 'files', state: 'error', reason: 'срез отдал 502' }] });
    expect(countOf('Вложения')).toBe('?');
    const tab = screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes('Вложения'))!;
    expect(tab.querySelector('.sk-tab__count')?.getAttribute('title')).toMatch(/не смогли/i);
  });

  it('то же правило под «Ещё»: спрятанный раздел с нечитаемым блоком — «?», а не ноль', () => {
    viewPast('overview', { data_state: [{ source: 'files', state: 'forbidden', reason: 'нет прав' }] });
    fireEvent.click(screen.getByRole('tab', { name: /Ещё/ }));
    const item = within(screen.getByRole('menu', { name: 'Ещё' })).getByRole('menuitem', { name: /Вложения/ });
    expect(item.querySelector('.sk-tab__count')?.textContent).toBe('?');
  });

  it('«не смогли посчитать» и у блока в хвосте тела: раздел остаётся, а не исчезает по ложному нулю', () => {
    view('overview', { data_state: [{ source: 'files', state: 'error', reason: 'срез отдал 502' }] }, {
      decided: true, notes: [],
      sections: [
        { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own', group: null },
        { key: 'files', source: 'relation', ref: 'HAS_FILE', order: 2, slot: 'content', group: null },
      ],
    });
    const glue = document.querySelector('[data-glued="files"]');
    expect(glue).not.toBeNull();
    expect(glue?.querySelector('.sk-tab__count')?.textContent).toBe('?');
  });
});
