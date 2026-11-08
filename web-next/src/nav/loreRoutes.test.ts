// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13 — баги B-01, B-02, B-06, B-07 из Q-UXR-4
// (D-2026-UXR-BUGS-IN-REDESIGN), маршрутная часть каркаса v2.
//
// В v1 карта «тип → раздел» и разбор ссылки жили порознь (src/api/searchRoutes.ts
// и LorePage), и расходились молча: релиза в карте не было (B-02), у
// spec/doc/runbook раздел общий на три вида, а id без вида не открывал ничего
// (B-06), ?section=search&q= терял запрос (B-01), а q и фильтры уезжали в
// соседний раздел (B-07). Здесь пишущая и читающая стороны проверяются вместе,
// по всему каталогу типов поиска.
import { describe, expect, it } from 'vitest';
import { readUrlState, type UrlWindow } from '@seidr/kit';
import {
  SEARCH_HIT_TYPES, TYPE_ROUTE, readRoute, recordHref, searchHref, sectionHref,
} from './loreRoutes';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('B-02 · каждый тип поиска ведёт в свой раздел, релиз — в релизы', () => {
  it('у каждого типа из выдачи /lore/search есть маршрут', () => {
    for (const t of SEARCH_HIT_TYPES) expect(TYPE_ROUTE[t], `нет маршрута у типа ${t}`).toBeTruthy();
  });

  it('релиз открывается в «Релизах», а не в «Спринтах»', () => {
    const r = readRoute(params(recordHref('release', 'lore-v1.16.0')!));
    expect(r.sec).toBe('releases');
    expect(r.record).toEqual({ kind: 'release', id: 'lore-v1.16.0' });
  });

  it('неизвестный тип — null (честно «не умеем открыть»), а не тихий уход в дефолтный раздел', () => {
    expect(recordHref('martian', 'X-1')).toBeNull();
  });
});

describe('B-06 · spec/doc/runbook открывают запись, а не пустую панель', () => {
  it('ссылка несёт вид записи; разбор возвращает тот же вид и id', () => {
    for (const kind of ['spec', 'doc', 'runbook'] as const) {
      const r = readRoute(params(recordHref(kind, `${kind.toUpperCase()}-1`)!));
      expect(r.sec, kind).toBe('knowledge');
      expect(r.record, kind).toEqual({ kind, id: `${kind.toUpperCase()}-1` });
    }
  });

  it('туда-обратно по всему каталогу: запись = тот же тип и тот же id (включая «/» в id задачи)', () => {
    for (const t of SEARCH_HIT_TYPES) {
      const id = t === 'task' ? 'SPRINT_X/CO-11' : `${t}-id with space`;
      const r = readRoute(params(recordHref(t, id)!));
      expect(r.sec, t).toBe(TYPE_ROUTE[t].sec);
      expect(r.record, t).toEqual({ kind: t, id });
    }
  });

  it('раздел с записью, но без вида — не выдумывает вид', () => {
    expect(readRoute(new URLSearchParams('sec=knowledge&rec=X-1')).record).toBeNull();
  });
});

describe('B-01 · ?sec=search&q= не теряет запрос', () => {
  it('запрос туда-обратно, кириллица и пробелы внутри сохраняются', () => {
    const r = readRoute(params(searchHref('  релиз  весны ')));
    expect(r.sec).toBe('search');
    expect(r.q).toBe('релиз  весны');
  });

  it('пустой запрос — честно пустая строка, раздел поиска остаётся', () => {
    const r = readRoute(params(searchHref('')));
    expect(r.sec).toBe('search');
    expect(r.q).toBe('');
  });

  it('запрос читается и из «#»-фолбэка (песочница iframe, file://)', () => {
    const win: UrlWindow = {
      location: { pathname: '/', search: '', hash: '#sec=search&q=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7' },
      history: { pushState: () => {}, replaceState: () => {} },
    };
    expect(readRoute(readUrlState(win)).q).toBe('релиз');
  });
});

describe('B-07 · переход в другой раздел не тащит q и фильтры', () => {
  it('sectionHref снимает параметры прежнего раздела', () => {
    const cur = new URLSearchParams('sec=sprints&q=релиз&lf=%7B%7D&lq=done&rec=S-1&kind=sprint&tab=links');
    const p = params(sectionHref('adr', cur));
    expect(p.get('sec')).toBe('adr');
    for (const k of ['q', 'lf', 'lq', 'rec', 'kind', 'tab']) expect(p.get(k), k).toBeNull();
  });

  it('глобальные параметры (модуль) переживают переход', () => {
    const p = params(sectionHref('adr', new URLSearchParams('mod=lore&sec=sprints&q=x')));
    expect(p.get('mod')).toBe('lore');
  });

  it('ссылка на запись из поиска тоже не тащит q поиска', () => {
    const p = params(recordHref('adr', 'ADR-1', new URLSearchParams('sec=search&q=релиз'))!);
    expect(p.get('q')).toBeNull();
    expect(p.get('rec')).toBe('ADR-1');
  });
});
