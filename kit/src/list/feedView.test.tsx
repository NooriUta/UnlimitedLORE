// @vitest-environment jsdom
// Лента как ВИД того же источника (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW,
// spec:SPEC-LORE-KIT-FEED-VIEW §1–3, §6, §7; прототип принят владелицей
// 09.11.2026 — docs/prototypes/kit2-story-feed.html, раздел 1).
//
// Главное решение спеки: лента — ВИД, а не экран. Тот же переключатель, тот же
// источник (`KitData`), та же строка управления (фильтр · группировка ·
// порядок), те же честные состояния. Отдельной страницей «События» её делать
// нельзя: у фильтров появилась бы ВТОРАЯ реализация, и «Статус: в работе» в
// таблице и в ленте однажды разошлись бы.
//
// Поэтому главный тест здесь — не разметка, а совпадение НАБОРА записей в
// таблице и в ленте при одном и том же фильтре. Он и есть доказательство «без
// второй реализации»: разойдутся пути — тест покраснеет.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { validateKitConfig } from '../core/validate';
import type { FeedFields } from './feedModel';

const rec = (id: string, status: string, fields: Record<string, unknown>, updated_at?: string): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status, fields, ...(updated_at ? { updated_at } : {}) });

/** Конфиг БЕЗ предметных имён (K-14): поля ленты называет приложение. */
const cfg = (feed?: FeedFields): KitConfig => ({
  modules: [{ id: 'm', title: 'Раздел', icon: 'scroll-quill' }], menu: { groups: [] },
  kinds: {
    item: {
      title: 'Предмет',
      icon: 'scroll-quill',
      fields: [
        { key: 'lead', title: 'Суть', type: 'text' },
        { key: 'happened', title: 'Случилось', type: 'date' },
      ],
    },
  },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['list', 'feed'],
    columns: ['title+id', 'status'],
    groupings: ['status'],
    filters: ['status'],
    showClosed: 'all',
    ...(feed ? { feed } : {}),
  },
});

const FEED: FeedFields = { timeField: 'updated_at', lead: ['fields.lead'], because: ['BECAUSE'] };
const NOW = '2026-11-10T12:00:00Z';

const rs = [
  rec('a', 'todo', { lead: 'суть а' }, '2026-11-10T11:00:00Z'),
  rec('b', 'done', { lead: 'суть б' }, '2026-11-10T09:00:00Z'),
  rec('c', 'todo', {}, '2026-11-09T09:00:00Z'),
  rec('d', 'todo', {}, '2026-10-01T09:00:00Z'),
  // Запись БЕЗ поля времени: она не должна исчезнуть из ленты.
  rec('e', 'todo', {}),
];

const data = (records: KitRecord[] = rs, meta: Partial<KitData['meta']> = {}): KitData => ({
  records, edges: [], journal: [], meta: { generated_at: NOW, total: records.length, ...meta },
});

const switcher = () => screen.getByRole('radiogroup', { name: /Вид/ });
const pick = (name: string) => fireEvent.click(within(switcher()).getByRole('radio', { name }));
const viewNames = () => within(switcher()).getAllByRole('radio').map(r => r.textContent);
const recordIds = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(e => e.getAttribute('data-record-id'));

describe('K2-FEED-VIEW · лента стоит в переключателе видов (§1)', () => {
  it('положительный контроль: конфиг с полями ленты валиден', () => {
    expect(validateKitConfig(cfg(FEED)).errors).toEqual([]);
  });

  it('приложение назвало поле времени — лента есть в переключателе', () => {
    render(<ListView config={cfg(FEED)} data={data()} urlState={false} />);
    expect(viewNames()).toEqual(['Список', 'Лента']);
  });

  it('поле времени НЕ названо — ленту не предлагаем: kit не угадывает, где время (K-14)', () => {
    const { container } = render(<ListView config={cfg()} data={data()} urlState={false} />);
    expect(screen.queryByRole('radio', { name: 'Лента' })).toBeNull();
    // И по ссылке её тоже не открыть: вид падает на первый из названных.
    expect(container.querySelector('.sk-feed')).toBeNull();
  });

  it('?view=feed при НЕназванном поле времени открывает первый вид, а не пустую ленту', () => {
    const win = { location: { pathname: '/', search: '?lv=feed', hash: '' }, history: { pushState: () => {}, replaceState: () => {} } };
    const { container } = render(<ListView config={cfg()} data={data()} urlState={win} />);
    expect(container.querySelector('.sk-list')?.getAttribute('data-view')).toBe('list');
  });

  it('?view=feed (lv=feed) открывает ленту по ссылке', () => {
    const win = { location: { pathname: '/', search: '?lv=feed', hash: '' }, history: { pushState: () => {}, replaceState: () => {} } };
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={win} />);
    expect(container.querySelector('.sk-list')?.getAttribute('data-view')).toBe('feed');
    expect(container.querySelector('.sk-feed')).not.toBeNull();
  });

  it('нового раздела меню лента не требует: вид живёт в состоянии списка', () => {
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={false} />);
    pick('Лента');
    expect(container.querySelector('.sk-list[data-view="feed"]')).not.toBeNull();
  });
});

describe('K2-FEED-VIEW · ОДИН фильтр — ОДИН набор записей в таблице и в ленте (§1, главный тест)', () => {
  // Набор условий, который сужает выдачу всеми путями сразу: текст, значение
  // поля и «Быстро». Если у ленты появится свой путь фильтрации, разойдётся
  // хотя бы один из них.
  const cases: { why: string; initial: Parameters<typeof ListView>[0]['initial'] }[] = [
    { why: 'без фильтра — положительный контроль, наборы совпадают и так', initial: {} },
    { why: 'значение поля', initial: { filters: { status: ['todo'] } } },
    { why: 'текст', initial: { text: 'Запись b' } },
    { why: 'текст и поле вместе', initial: { filters: { status: ['todo'] }, text: 'Запись a' } },
  ];

  for (const { why, initial } of cases) {
    it(`${why}: таблица и лента дают одинаковый набор`, () => {
      const table = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ ...initial, view: 'list' }} />);
      const inTable = recordIds(table.container).sort();
      table.unmount();
      const feed = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ ...initial, view: 'feed' }} />);
      const inFeed = recordIds(feed.container).sort();
      expect(inFeed).toEqual(inTable);
      // Контроль, что сравниваются не два пустых набора.
      if (Object.keys(initial ?? {}).length === 0) expect(inFeed.length).toBe(rs.length);
      else expect(inFeed.length).toBeGreaterThan(0);
    });
  }

  it('фильтр переживает смену вида: переключение не возвращает отфильтрованное', () => {
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ text: 'Запись b' }} />);
    expect(recordIds(container)).toEqual(['b']);
    pick('Лента');
    expect(recordIds(container)).toEqual(['b']);
  });
});

describe('K2-FEED-VIEW · время и группировка (§2, §3)', () => {
  it('умолчание вида — группы времени: сегодня · вчера · раньше · без времени', () => {
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ view: 'feed' }} />);
    expect([...container.querySelectorAll('.sk-feed__day')].map(d => d.getAttribute('data-day')))
      .toEqual(['today', 'yesterday', 'earlier', '__feed_undated__']);
    expect(screen.getByText('Сегодня')).toBeTruthy();
    expect(screen.getByText('Без времени')).toBeTruthy();
  });

  it('запись без поля времени — в «без времени» и НЕ теряется (§2)', () => {
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ view: 'feed' }} />);
    const undated = container.querySelector('.sk-feed__day[data-day="__feed_undated__"]') as HTMLElement;
    expect(recordIds(undated)).toEqual(['e']);
    expect(recordIds(container)).toContain('e');
  });

  it('форма строки ОДНА: время, вид записи, код, название, суть — из НАЗВАННЫХ полей', () => {
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ view: 'feed' }} />);
    const a = container.querySelector('.sk-feed__item[data-record-id="a"]') as HTMLElement;
    expect(a.querySelector('.sk-feed__when')?.textContent).toContain('2026-11-10');
    expect(a.querySelector('.sk-feed__kind')?.textContent).toBe('Предмет');
    expect(a.querySelector('.sk-feed__lead')?.textContent).toContain('суть а');
    expect(a.querySelector('.sk-feed__title')?.textContent).toContain('Запись a');
    // Поле сути не названо у записи — абзаца нет, пустого места не рисуем.
    const c = container.querySelector('.sk-feed__item[data-record-id="c"]') as HTMLElement;
    expect(c.querySelector('.sk-feed__lead')).toBeNull();
  });

  it('повод — НАЗВАННЫЕ связи записи; связей нет — блока нет (§2)', () => {
    const d = data();
    d.edges = [{ from: 'a', to: 'b', type: 'BECAUSE' }, { from: 'a', to: 'c', type: 'OTHER' }];
    const { container } = render(<ListView config={cfg(FEED)} data={d} urlState={false} initial={{ view: 'feed' }} />);
    const a = container.querySelector('.sk-feed__item[data-record-id="a"]') as HTMLElement;
    const refs = [...a.querySelectorAll('.sk-feed__ref')].map(e => e.textContent);
    // Только названная связь: тип, который приложение не называло, в повод не идёт.
    expect(refs).toEqual(['Запись b']);
    expect(container.querySelector('.sk-feed__item[data-record-id="d"] .sk-feed__because')).toBeNull();
  });

  it('группировка из таблицы работает в ленте, и заголовки групп — её (§3)', () => {
    const { container } = render(
      <ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ view: 'feed', group: 'status' }} />,
    );
    expect([...container.querySelectorAll('.sk-feed__day')].map(d => d.getAttribute('data-day'))).toEqual(['todo', 'done']);
    expect([...container.querySelectorAll('.sk-feed__gtitle')].map(e => e.textContent)).toEqual(['к работе', 'готово']);
    // Строка управления у ленты та же: сегмент группировки на месте.
    expect(container.querySelector('.sk-list__controls [data-seg="group"]')).not.toBeNull();
  });
});

describe('K2-FEED-VIEW · четыре честных состояния (§6)', () => {
  it('«не смогли проверить» — строкой В ПОРЯДКЕ ВРЕМЕНИ, с причиной', () => {
    const { container } = render(
      <ListView
        config={cfg(FEED)}
        data={data(rs, { errors: [{ block: 'источник', reason: 'сеть не ответила', at: '2026-11-10T10:00:00Z' }] })}
        urlState={false}
        initial={{ view: 'feed' }}
      />,
    );
    const today = container.querySelector('.sk-feed__day[data-day="today"]') as HTMLElement;
    const rows = [...today.querySelectorAll('.sk-feed__item')]
      .map(e => e.getAttribute('data-record-id') ?? `gap:${e.getAttribute('data-feed-gap')}`);
    // 11:00 · провал 10:00 · 09:00 — провал стоит на своём месте по времени.
    expect(rows).toEqual(['a', 'gap:failed', 'b']);
    const gap = today.querySelector('[data-feed-gap="failed"]') as HTMLElement;
    expect(gap.textContent).toContain('Не смогли проверить');
    expect(gap.textContent).toContain('сеть не ответила');
    expect(gap.textContent).toContain('источник');
  });

  it('«нет прав» — ОТДЕЛЬНО от сбоя: другое слово и другой признак', () => {
    const { container } = render(
      <ListView
        config={cfg(FEED)}
        data={data(rs, { errors: [
          { block: 'первый', reason: 'сеть не ответила', at: '2026-11-10T10:30:00Z' },
          { block: 'второй', reason: '403', forbidden: true, at: '2026-11-10T10:00:00Z' },
        ] })}
        urlState={false}
        initial={{ view: 'feed' }}
      />,
    );
    expect(container.querySelectorAll('[data-feed-gap="failed"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-feed-gap="forbidden"]')).toHaveLength(1);
    expect((container.querySelector('[data-feed-gap="forbidden"]') as HTMLElement).textContent).toContain('Нет прав');
    // «Нет прав» не называется сбоем — иначе два разных исхода читались бы одним.
    expect((container.querySelector('[data-feed-gap="forbidden"]') as HTMLElement).textContent).not.toContain('Не смогли проверить');
  });

  it('«обрезано» — лента говорит, что показан не весь период, и числом', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      rec(`m${i}`, 'todo', {}, `2026-11-10T${String(23 - Math.floor(i / 4)).padStart(2, '0')}:00:00Z`));
    const { container } = render(
      <ListView config={cfg(FEED)} data={data(many)} urlState={false} initial={{ view: 'feed' }} />,
    );
    const cut = container.querySelector('.sk-feed__cut') as HTMLElement;
    expect(cut).not.toBeNull();
    expect(cut.textContent).toContain('50');
    expect(cut.textContent).toContain('60');
    // Спрятанное НЕ исчезает: его можно раскрыть на месте.
    fireEvent.click(within(cut).getByRole('button'));
    expect(container.querySelectorAll('.sk-feed__item')).toHaveLength(60);
  });

  it('выдача обрезана сервером — лента говорит, что её числа по загруженным строкам', () => {
    const { container } = render(
      <ListView config={cfg(FEED)} data={data(rs, { truncated: true, total: 180 })} urlState={false} initial={{ view: 'feed' }} />,
    );
    expect(container.querySelector('.sk-feed__page')?.textContent).toBeTruthy();
  });

  it('«пусто» — только когда источник ОТВЕТИЛ и записей правда нет', () => {
    const { container } = render(
      <ListView config={cfg(FEED)} data={data([], { total: 0 })} urlState={false} initial={{ view: 'feed' }} />,
    );
    expect(container.querySelector('.sk-state')).not.toBeNull();
    expect(container.querySelector('.sk-feed__none')).toBeNull();
  });

  it('записей не пришло, но выдача НЕПОЛНАЯ — «пусто» не утверждаем', () => {
    // Источник говорит «всего 180», а загрузилось ноль: «ничего не было» —
    // ровно то утверждение, которого делать нельзя.
    const { container } = render(
      <ListView config={cfg(FEED)} data={data([], { truncated: true, total: 180 })} urlState={false} initial={{ view: 'feed' }} />,
    );
    expect(container.querySelector('.sk-feed__none')).not.toBeNull();
    expect(container.querySelector('.sk-state')).toBeNull();
  });

  it('записей нет, а блок упал — провал виден строкой, а не «пусто»', () => {
    const { container } = render(
      <ListView
        config={cfg(FEED)}
        data={data([], { total: 0, errors: [{ block: 'источник', reason: '403', forbidden: true, at: NOW }] })}
        urlState={false}
        initial={{ view: 'feed' }}
      />,
    );
    expect(container.querySelector('[data-feed-gap="forbidden"]')).not.toBeNull();
    expect(container.querySelector('.sk-state')).toBeNull();
  });
});

describe('K2-FEED-VIEW · чего в ленте нет намеренно (§7)', () => {
  it('своей вёрстки под тип записи нет: у всех строк один класс и одна форма', () => {
    const d = data([...rs, { id: 'x', kind: 'other', title: 'Иное', status: 'todo', fields: {}, updated_at: NOW }]);
    const c2 = cfg(FEED);
    c2.kinds.other = { title: 'Иное', icon: 'scroll-quill' };
    const { container } = render(<ListView config={c2} data={d} urlState={false} initial={{ view: 'feed' }} />);
    const classes = new Set([...container.querySelectorAll('.sk-feed__item[data-record-id]')].map(e => e.className));
    expect([...classes]).toEqual(['sk-feed__item']);
  });

  it('границы потока названы: «Показано N из M» остаётся общей строкой списка', () => {
    const { container } = render(<ListView config={cfg(FEED)} data={data()} urlState={false} initial={{ view: 'feed' }} />);
    expect(container.querySelector('[data-testid="kit-list-shown"]')?.textContent).toContain('5');
  });
});
