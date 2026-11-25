// Лента паспортов: режим и окно показа (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Прототип принят владельцем 25.11.2026 («паспорт bp01 делай»):
// docs/prototypes/bp-01-passport-feed.html. Числа — оттуда: догрузка по 4,
// автоматически до 12 полных паспортов, в «Контексте» — до 40, дальше кнопкой.
import { describe, expect, it } from 'vitest';
import {
  FEED_AUTO_CONTEXT, FEED_AUTO_FULL, FEED_PAGE,
  feedAutoLimit, feedModeSwitchShown, feedMoreShown, feedShownOf, feedTail, readFeedMode, readFeedShown,
} from './feedPaging';

describe('BP-01 · числа прототипа', () => {
  it('по 4, до 12 полных, до 40 в контексте', () => {
    expect(FEED_PAGE).toBe(4);
    expect(FEED_AUTO_FULL).toBe(12);
    expect(FEED_AUTO_CONTEXT).toBe(40);
    expect(feedAutoLimit('full')).toBe(12);
    expect(feedAutoLimit('context')).toBe(40);
  });
});

describe('BP-01 · сколько показать', () => {
  it('без числа в адресе — первая порция в 4 записи', () => {
    expect(feedShownOf(null, 30, 'full', true)).toBe(4);
  });
  it('число из адреса держится, но не больше, чем записей', () => {
    expect(feedShownOf(16, 30, 'full', true)).toBe(16);
    expect(feedShownOf(99, 7, 'context', true)).toBe(7);
  });
  it('мусор и ноль в адресе — первая порция, а не пустая лента', () => {
    expect(feedShownOf(0, 30, 'context', true)).toBe(4);
    expect(feedShownOf(-3, 30, 'context', true)).toBe(4);
    expect(feedShownOf(Number.NaN, 30, 'context', true)).toBe(4);
  });
  it('прокрутку не видно (нет IntersectionObserver) — сразу до предела автодогрузки', () => {
    expect(feedShownOf(null, 30, 'full', false)).toBe(12);
    expect(feedShownOf(null, 60, 'context', false)).toBe(40);
    expect(feedShownOf(null, 5, 'context', false)).toBe(5);
  });
});

describe('BP-01 · хвост ленты', () => {
  it('показано всё — «это вся лента»', () => {
    expect(feedTail(10, 10, 'full')).toEqual({ kind: 'all' });
  });
  it('ниже предела — автодогрузка', () => {
    expect(feedTail(8, 30, 'full')).toEqual({ kind: 'auto' });
    expect(feedTail(36, 60, 'context')).toEqual({ kind: 'auto' });
  });
  it('на пределе — кнопка «Показать ещё» на следующую порцию', () => {
    expect(feedTail(12, 30, 'full')).toEqual({ kind: 'more', n: 4 });
    expect(feedTail(40, 42, 'context')).toEqual({ kind: 'more', n: 2 });
  });
  it('кнопка добавляет порцию, но не больше, чем записей', () => {
    expect(feedMoreShown(12, 30)).toBe(16);
    expect(feedMoreShown(28, 30)).toBe(30);
  });
});

describe('BP-01 · смена режима', () => {
  it('в «Полные паспорта» — не больше 12: тяжёлые записи разом не грузим', () => {
    expect(feedModeSwitchShown('full', 40)).toBe(12);
    expect(feedModeSwitchShown('full', 8)).toBe(8);
  });
  it('в «Контекст» — сколько было', () => {
    expect(feedModeSwitchShown('context', 12)).toBe(12);
  });
});

describe('BP-01 · адрес', () => {
  it('режим: full — полные, всё прочее — контекст', () => {
    expect(readFeedMode(new URLSearchParams('lfm=full'))).toBe('full');
    expect(readFeedMode(new URLSearchParams('lfm=zzz'))).toBe('context');
    expect(readFeedMode(new URLSearchParams(''))).toBe('context');
  });
  it('число: целое положительное, иначе — не названо', () => {
    expect(readFeedShown(new URLSearchParams('lfn=12'))).toBe(12);
    expect(readFeedShown(new URLSearchParams('lfn=abc'))).toBeNull();
    expect(readFeedShown(new URLSearchParams(''))).toBeNull();
  });
});
