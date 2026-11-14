// Сторож (приёмка препрода 14.11.2026, «Völva» сбрасывалась на «Список» после перезагрузки): всё, что
// список пишет в адрес (writeListState), при загрузке восстанавливается (initialState). Раньше
// initialState знал только часть полей, и новые (lav, lm, lcd, llf) тихо терялись.
import { describe, expect, it } from 'vitest';
import { writeListState, type ListState, DEFAULT_LIST_STATE } from './listModel';
import { initialState } from './ListView';
import type { UrlWindow } from '../resilience/urlState';

const full: ListState = {
  ...DEFAULT_LIST_STATE,
  view: 'board', quick: 'q1', group: 'status', sort: { key: 'title', dir: 'desc' },
  filters: { status: ['todo'] }, ops: {}, text: 'поиск', closed: 'hide', group2: 'kind',
  month: '2026-11', calDate: '2026-11-14', libFilter: 'stale', appView: 'volva',
};

describe('адрес списка: записанное восстанавливается целиком', () => {
  it('каждое поле, которое пишется в адрес, читается обратно при загрузке', () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(writeListState(full))) if (v != null) params.set(k, String(v));
    const win = { location: { pathname: '/', search: '?' + params.toString(), hash: '' }, history: { pushState: () => {}, replaceState: () => {} } } as unknown as UrlWindow;
    const back = initialState(win, undefined);
    const written = Object.keys(writeListState(full)).filter(k => params.has(k));
    expect(written.length).toBeGreaterThanOrEqual(12);
    expect(writeListState(back)).toEqual(writeListState(full));
  });
});
