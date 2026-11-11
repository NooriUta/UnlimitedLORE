// @vitest-environment jsdom
// Двухуровневая лента: верхний уровень полосой, под ним то, что в нём двигалось
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-TWO-LEVEL, spec:SPEC-LORE-KIT-FEED-VIEW §4).
//
// Повод — владелица 09.11.2026, отдельной просьбой: «раздели еще одну идею
// спринты и задачи дерево будет двух уровневая лента». Прототип принят ею же
// (docs/prototypes/kit2-story-feed.html, раздел 2).
//
// Главный тест здесь — не разметка, а СОВПАДЕНИЕ ЧИСЕЛ: прогресс и суммы в
// полосе верхнего уровня обязаны получаться тем же путём, что колонки
// `progress:`/`sum:` в таблице. Два пути дали бы две правды о числах, и
// разошлись бы они первой же правкой — поэтому проверяется равенство текста, а
// не наличие цифр.
//
// Нижний уровень грузится ПРИ РАСКРЫТИИ — это слово владелицы 10.11.2026, а не
// допущение (см. feedUnder.ts).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { validateKitConfig } from '../core/validate';
import type { FeedFields } from './feedModel';
import type { FeedUnder } from './feedUnder';

const NOW = '2026-11-10T12:00:00Z';

const rec = (id: string, fields: Record<string, unknown> = {}, updated_at = '2026-11-10T11:00:00Z'): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields, updated_at });

/** Числа кладёт ПРИЛОЖЕНИЕ в поля — ровно так же, как их читает таблица. */
const NUMS = {
  cnt: { done: 3, total: 7 },
  size: { value: 12.5, known: 9, of: 14, unit: 'д' },
};

const top = rec('s1', NUMS);
const plain = rec('s2', { cnt: { done: 1, total: 1 }, size: { value: 2, known: 2, of: 2, unit: 'д' } });
const unders = [rec('u1'), rec('u2'), rec('u3')];

/** Конфиг БЕЗ предметных имён (K-14): что верхний уровень, а что нижний — слово приложения. */
const cfg = (opts: { under?: boolean; cols?: string[] } = {}): KitConfig => {
  const feed: FeedFields = {
    timeField: 'updated_at',
    ...(opts.under === false ? {} : { under: { title: 'Вложенное' } }),
  };
  return {
    modules: [{ id: 'm', title: 'Раздел', icon: 'scroll-quill' }], menu: { groups: [] },
    kinds: {
      item: {
        title: 'Предмет',
        icon: 'scroll-quill',
        fields: [{ key: 'cnt', title: 'Счёт', type: 'number' }, { key: 'size', title: 'Размер', type: 'number' }],
      },
    },
    statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
    list: {
      views: ['list', 'feed'],
      columns: opts.cols ?? ['title+id', 'status', 'progress:cnt', 'sum:size'],
      showClosed: 'all',
      feed,
    },
  };
};

const data = (records: KitRecord[] = [top, plain]): KitData =>
  ({ records, edges: [], journal: [], meta: { generated_at: NOW, total: records.length } });

type Win = Parameters<typeof ListView>[0]['urlState'];
const makeWin = (search = '') => {
  const win = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: unknown, url: string) => { win.location.search = url.includes('?') ? url.slice(url.indexOf('?')) : ''; },
      replaceState: (_s: unknown, _t: unknown, url: string) => { win.location.search = url.includes('?') ? url.slice(url.indexOf('?')) : ''; },
    },
  };
  return win;
};

/** Лента с двумя уровнями: верхний — только «s1», его состояние задаёт тест. */
function feed(
  under: FeedUnder | null,
  opts: {
    onFeedUnder?: (id: string) => void;
    records?: KitRecord[];
    config?: KitConfig;
    urlState?: Win;
    noProp?: boolean;
  } = {},
) {
  return render(
    <ListView
      config={opts.config ?? cfg()}
      data={data(opts.records)}
      urlState={opts.urlState ?? false}
      initial={{ view: 'feed' }}
      {...(opts.noProp ? {} : { feedUnder: (r: KitRecord) => (r.id === 's1' ? under : null) })}
      {...(opts.onFeedUnder ? { onFeedUnder: opts.onFeedUnder } : {})}
    />,
  );
}

const item = (c: HTMLElement, id: string) => c.querySelector(`[data-record-id="${id}"]`) as HTMLElement;
const strip = (c: HTMLElement, id: string) => item(c, id).querySelector('.sk-feed__strip') as HTMLElement | null;
const group = (c: HTMLElement, id: string) => item(c, id).querySelector('.sk-feed__undergroup') as HTMLElement | null;
const moreBtn = (c: HTMLElement, id: string) => item(c, id).querySelector('.sk-feed__undermore') as HTMLElement | null;
const underIds = (c: HTMLElement, id: string) =>
  [...item(c, id).querySelectorAll('.sk-feed__under [data-record-id]')].map(e => e.getAttribute('data-record-id'));

describe('K2-FEED-TWO-LEVEL · верхний уровень полосой (состав п.1)', () => {
  it('положительный контроль: конфиг с нижним уровнем валиден', () => {
    expect(validateKitConfig(cfg()).errors).toEqual([]);
  });

  it('у верхней записи есть полоса с названием, статусом, прогрессом и суммой', () => {
    const { container } = feed({ kind: 'rest', count: 7 });
    const row = item(container, 's1');
    expect(row.querySelector('.sk-feed__title')?.textContent).toContain('Запись s1');
    expect(row.querySelector('.sk-list__status')).toBeTruthy();
    const s = strip(container, 's1')!;
    expect(s.querySelector('.sk-progress')).toBeTruthy();
    expect(s.querySelector('.sk-sum')).toBeTruthy();
  });

  it('запись, которую приложение верхним уровнем НЕ назвало, полосы не получает', () => {
    const { container } = feed({ kind: 'rest', count: 7 });
    expect(strip(container, 's2')).toBeNull();
    expect(group(container, 's2')).toBeNull();
  });

  it('приложение не назвало нижний уровень в конфиге — двух уровней нет вовсе', () => {
    // Иначе kit пришлось бы выдумать слово для нижнего уровня — а это
    // предметное знание (K-14): «Ещё 7» неизвестно чего читать нельзя.
    const { container } = feed({ kind: 'rest', count: 7 }, { config: cfg({ under: false }) });
    expect(strip(container, 's1')).toBeNull();
    expect(group(container, 's1')).toBeNull();
  });

  it('состав нижнего уровня не передан — двух уровней нет: раскрывать нечего', () => {
    const { container } = feed(null, { noProp: true });
    expect(group(container, 's1')).toBeNull();
    expect(strip(container, 's1')).toBeNull();
  });

  it('подпись нижнего уровня — слово ПРИЛОЖЕНИЯ, своего kit не придумывает', () => {
    const { container } = feed({ kind: 'here', records: unders }, { urlState: makeWin('?lx=s1') });
    expect(item(container, 's1').querySelector('.sk-rec-glue__head')?.textContent).toContain('Вложенное');
  });

  it('чисел приложение не назвало — полосы чисел нет, пустой рамки не рисуем', () => {
    const { container } = feed({ kind: 'rest', count: 7 }, { config: cfg({ cols: ['title+id', 'status'] }) });
    expect(strip(container, 's1')).toBeNull();
    // Но сам нижний уровень остаётся: он от чисел не зависит.
    expect(group(container, 's1')).toBeTruthy();
  });
});

describe('K2-FEED-TWO-LEVEL · прогресс и суммы ТЕМ ЖЕ путём, что в списке (состав п.4)', () => {
  // Одни и те же данные в двух видах обязаны дать ОДИН текст. Набор значений
  // нарочно включает честные исходы: «не посчитали», «считаем», «не заполнено»
  // и неполный охват — именно на них вторая реализация врёт тише всего.
  const cases: { why: string; cnt: unknown; size: unknown }[] = [
    { why: 'положительный контроль: обычные числа', cnt: { done: 3, total: 7 }, size: { value: 12.5, known: 14, of: 14, unit: 'д' } },
    { why: 'неполный охват суммы', cnt: { done: 3, total: 7 }, size: { value: 12.5, known: 9, of: 14, unit: 'д' } },
    { why: 'не заполнено ни у кого — не ноль', cnt: { done: 0, total: 0 }, size: { value: null, known: 0, of: 14, unit: 'д' } },
    { why: 'не посчитали', cnt: { error: 'источник не ответил' }, size: { error: 'источник не ответил' } },
    { why: 'ещё считаем', cnt: { loading: true }, size: { loading: true } },
    { why: 'складывали не всё', cnt: { done: 3, total: 7, partial: true }, size: { value: 12.5, known: 9, of: 14, unit: 'д', cut: true } },
    { why: 'полей нет вовсе', cnt: undefined, size: undefined },
  ];

  const look = (sel: string, root: HTMLElement) => {
    const e = root.querySelector(sel) as HTMLElement | null;
    return e && { text: e.textContent, title: e.getAttribute('title'), state: e.getAttribute('data-progress') ?? e.getAttribute('data-sum') };
  };

  for (const kase of cases) {
    it(`${kase.why}: числа в списке и в полосе ленты совпадают`, () => {
      const r = rec('s1', { cnt: kase.cnt, size: kase.size });
      const list = render(<ListView config={cfg()} data={data([r])} urlState={false} initial={{ view: 'list' }} />);
      const row = list.container.querySelector('[data-record-id="s1"]') as HTMLElement;
      const fromList = { p: look('.sk-progress', row), s: look('.sk-sum', row) };
      // Положительный контроль: колонки в таблице ЕСТЬ — иначе сравнивалось бы пустое с пустым.
      expect(fromList.p).not.toBeNull();
      expect(fromList.s).not.toBeNull();
      list.unmount();

      const fed = feed({ kind: 'rest', count: 7 }, { records: [r] });
      const s = strip(fed.container, 's1')!;
      expect({ p: look('.sk-progress', s), s: look('.sk-sum', s) }).toEqual(fromList);
    });
  }

  it('у каждого числа в полосе есть подпись — иначе «3/7» неизвестно о чём', () => {
    const { container } = feed({ kind: 'rest', count: 7 });
    const labels = [...strip(container, 's1')!.querySelectorAll('.sk-feed__striplabel')].map(e => e.textContent);
    expect(labels).toEqual(['Счёт', 'Размер']);
  });
});

describe('K2-FEED-TWO-LEVEL · под ним то, что в нём двигалось (состав п.2, п.3)', () => {
  it('свёрнуто — строк нижнего уровня нет', () => {
    const { container } = feed({ kind: 'here', records: unders });
    expect(underIds(container, 's1')).toEqual([]);
    expect(moreBtn(container, 's1')?.textContent).toContain('3');
  });

  it('нажатие при НЕзагруженном нижнем уровне просит его у приложения — один раз', () => {
    const ask = vi.fn();
    const { container } = feed({ kind: 'rest', count: 3 }, { onFeedUnder: ask });
    fireEvent.click(moreBtn(container, 's1')!);
    fireEvent.click(moreBtn(container, 's1')!);
    expect(ask.mock.calls.map(c => c[0])).toEqual(['s1', 's1']);
    // Строк всё ещё нет: их не присылали — «загружается» это не «пусто».
    expect(underIds(container, 's1')).toEqual([]);
  });

  it('загруженный нижний уровень раскрывается НА МЕСТЕ и в сеть не ходит', () => {
    const ask = vi.fn();
    const { container } = feed({ kind: 'here', records: unders }, { onFeedUnder: ask });
    fireEvent.click(moreBtn(container, 's1')!);
    expect(underIds(container, 's1')).toEqual(['u1', 'u2', 'u3']);
    expect(ask).not.toHaveBeenCalled();
    // И свернуть обратно тоже без сети.
    fireEvent.click(moreBtn(container, 's1')!);
    expect(underIds(container, 's1')).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });

  it('строка нижнего уровня — ТА ЖЕ форма, что у верхней: один класс на оба уровня', () => {
    const { container } = feed({ kind: 'here', records: unders }, { urlState: makeWin('?lx=s1') });
    const classes = new Set([...container.querySelectorAll('.sk-feed__item[data-record-id]')].map(e => e.className));
    expect([...classes]).toEqual(['sk-feed__item']);
    // Уровень различается признаком, а не своей вёрсткой.
    expect(item(container, 's1').getAttribute('data-feed-level')).toBe('top');
    expect(item(container, 'u1').getAttribute('data-feed-level')).toBe('under');
  });

  it('уровней ровно два: у записи нижнего уровня своего нижнего не спрашивают', () => {
    const asked: string[] = [];
    render(
      <ListView
        config={cfg()}
        data={data([top])}
        urlState={makeWin('?lx=s1')}
        initial={{ view: 'feed' }}
        feedUnder={(r: KitRecord) => { asked.push(r.id); return r.id === 's1' ? { kind: 'here', records: unders } : null; }}
      />,
    );
    expect(asked).toContain('s1');
    expect(asked).not.toContain('u1');
  });
});

describe('K2-FEED-TWO-LEVEL · раскрытие живёт в адресе (состав п.3)', () => {
  it('раскрыли — в адресе появилось; свернули — ушло', () => {
    const win = makeWin();
    const { container } = feed({ kind: 'here', records: unders }, { urlState: win });
    fireEvent.click(moreBtn(container, 's1')!);
    expect(win.location.search).toContain('lx=s1');
    fireEvent.click(moreBtn(container, 's1')!);
    expect(win.location.search).not.toContain('lx=s1');
  });

  it('по ссылке с ?lx=s1 запись раскрыта сразу — перезагрузка не теряет раскрытия', () => {
    const { container } = feed({ kind: 'here', records: unders }, { urlState: makeWin('?lx=s1') });
    expect(underIds(container, 's1')).toEqual(['u1', 'u2', 'u3']);
  });

  it('по ссылке в раскрытое с НЕзагруженным нижним уровнем приложение получает запрос', () => {
    // Иначе «раскрытие переживает перезагрузку» было бы неправдой: по ссылке
    // пришли в раскрытую запись, а под ней снова кнопка «Ещё».
    const ask = vi.fn();
    feed({ kind: 'rest', count: 3 }, { onFeedUnder: ask, urlState: makeWin('?lx=s1') });
    expect(ask.mock.calls.map(c => c[0])).toEqual(['s1']);
  });

  it('запрос по ссылке идёт ОДИН раз, даже если источник всё ещё отвечает «не загружено»', () => {
    const ask = vi.fn();
    const { rerender } = feed({ kind: 'rest', count: 3 }, { onFeedUnder: ask, urlState: makeWin('?lx=s1') });
    rerender(
      <ListView
        config={cfg()}
        data={data()}
        urlState={makeWin('?lx=s1')}
        initial={{ view: 'feed' }}
        feedUnder={(r: KitRecord) => (r.id === 's1' ? { kind: 'rest', count: 3 } : null)}
        onFeedUnder={ask}
      />,
    );
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('K2-FEED-TWO-LEVEL · честные состояния нижнего уровня', () => {
  it('«нет прав» — причина словами и НИКАКОЙ кнопки повтора', () => {
    const { container } = feed({ kind: 'forbidden', reason: 'доступ закрыт' }, { onFeedUnder: vi.fn() });
    const g = group(container, 's1')!;
    expect(g.getAttribute('data-under')).toBe('denied');
    expect(g.querySelector('[data-note="denied"]')?.textContent).toContain('доступ закрыт');
    expect(moreBtn(container, 's1')).toBeNull();
  });

  it('«не дошло» — причина и повтор, и повтор правда зовёт приложение', () => {
    const ask = vi.fn();
    const { container } = feed({ kind: 'failed', reason: 'источник не ответил' }, { onFeedUnder: ask });
    const g = group(container, 's1')!;
    expect(g.getAttribute('data-under')).toBe('retry');
    expect(g.querySelector('[data-note="failed"]')?.textContent).toContain('источник не ответил');
    fireEvent.click(moreBtn(container, 's1')!);
    expect(ask).toHaveBeenCalledWith('s1');
  });

  it('«нет прав» и «не дошло» названы РАЗНЫМИ словами: лечатся они по-разному', () => {
    const a = feed({ kind: 'forbidden', reason: 'одна причина' });
    const denied = group(a.container, 's1')!.textContent;
    a.unmount();
    const b = feed({ kind: 'failed', reason: 'одна причина' });
    expect(group(b.container, 's1')!.textContent).not.toBe(denied);
  });

  it('«едет» — сказано, и второго запроса нажатие не делает', () => {
    const ask = vi.fn();
    const { container } = feed({ kind: 'loading' }, { onFeedUnder: ask });
    expect(group(container, 's1')!.getAttribute('data-under')).toBe('busy');
    fireEvent.click(moreBtn(container, 's1')!);
    expect(ask).not.toHaveBeenCalled();
  });

  it('«ничего не двигалось» — утверждение словами, а не пустое место, и кнопки нет', () => {
    const { container } = feed({ kind: 'here', records: [] }, { onFeedUnder: vi.fn() });
    const g = group(container, 's1')!;
    expect(g.querySelector('[data-note="nothing"]')).toBeTruthy();
    expect(moreBtn(container, 's1')).toBeNull();
  });

  it('«ничего не двигалось» и «не загружено» — разные состояния на экране', () => {
    const a = feed({ kind: 'here', records: [] }, { onFeedUnder: vi.fn() });
    const nothing = group(a.container, 's1')!.getAttribute('data-under');
    a.unmount();
    const b = feed({ kind: 'rest', count: 4 }, { onFeedUnder: vi.fn() });
    expect(group(b.container, 's1')!.getAttribute('data-under')).not.toBe(nothing);
  });

  it('показано не всё — названо числом, а не молча обрезано', () => {
    const { container } = feed({ kind: 'here', records: unders, total: 18 }, { urlState: makeWin('?lx=s1') });
    expect(item(container, 's1').querySelector('[data-note="cut"]')?.textContent).toMatch(/3.*18/);
  });

  it('запросить нижний уровень некому — кнопки нет вовсе', () => {
    // Кнопка, обещающая действие, которого нет, хуже её отсутствия (то же
    // правило, что у применения в DiffPreview и у тела записи).
    const { container } = feed({ kind: 'rest', count: 3 });
    expect(moreBtn(container, 's1')).toBeNull();
  });
});

describe('K2-FEED-TWO-LEVEL · граница K-14', () => {
  it('в правиле нижнего уровня нет предметных имён: уровни называет приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/list/feedUnder.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['спринт', 'задач', 'релиз', 'проект', 'решени', 'adr']) {
      expect(code.toLowerCase(), `в правиле нижнего уровня встречается «${word}»`).not.toContain(word);
    }
  });

  it('в ленте списка нет предметных имён тоже', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/list/ListView.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['спринт', 'задач', 'релиз', 'проект']) {
      expect(code.toLowerCase(), `в списке встречается «${word}»`).not.toContain(word);
    }
  });
});
