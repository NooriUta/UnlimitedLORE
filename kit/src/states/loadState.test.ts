// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00c — честные состояния загрузки.
// «Пусто» ≠ «ошибка» ≠ «нет прав» ≠ «обрезано»: каждое — свой исход, и ни одно
// не выдаёт себя за другое. Полноту выдачи читаем из метаданных, которые бэкенд
// уже отдаёт (S1: SlicePage → page{total,has_more,fields_checked,warning},
// AidaLoreResource.sliceBody → truncated:true|"unknown" + limit + hint,
// outside_scope — «запись есть, но вне ваших проектов»).
import { describe, expect, it } from 'vitest';
import { classifyError, completeness, deriveLoadState } from './loadState';

describe('completeness — метаданные полноты S1', () => {
  it('без метаданных — полная выдача', () => {
    expect(completeness(undefined, 3)).toEqual({ kind: 'complete', shown: 3 });
    expect(completeness({ rows: [] } as never, 0)).toEqual({ kind: 'complete', shown: 0 });
  });

  it('page.has_more — страница: показано from–to из total', () => {
    const c = completeness({ page: { limit: 50, offset: 50, total: 180, has_more: true } }, 50);
    expect(c).toEqual({ kind: 'paged', shown: 50, offset: 50, total: 180 });
  });

  it('последняя страница (has_more=false) — полная', () => {
    expect(completeness({ page: { limit: 50, offset: 150, total: 180, has_more: false } }, 30).kind).toBe('complete');
  });

  it('truncated:true — потолок сервера; total из page тогда врёт и не используется', () => {
    const c = completeness({ truncated: true, limit: 1000, hint: 'обрезано', page: { total: 1000, has_more: false } }, 1000);
    expect(c).toEqual({ kind: 'capped', shown: 1000, limit: 1000, hint: 'обрезано' });
  });

  it('truncated:"unknown" — база не сообщает, полна ли выдача', () => {
    expect(completeness({ truncated: 'unknown', hint: 'нечем' }, 1000)).toEqual({ kind: 'unknown', shown: 1000, hint: 'нечем' });
  });

  it('0 строк при fields_checked=false — поля не проверены (не «данных нет»)', () => {
    const c = completeness({ page: { total: 0, has_more: false, fields_checked: false, warning: 'w' } }, 0);
    expect(c).toEqual({ kind: 'unverified', shown: 0, hint: 'w' });
  });
});

describe('classifyError — нет прав отдельно от сбоя', () => {
  it('403 по status или response.status — forbidden', () => {
    expect(classifyError({ status: 403 })).toBe('forbidden');
    expect(classifyError({ response: { status: 403 } })).toBe('forbidden');
    expect(classifyError({ code: 'FORBIDDEN' })).toBe('forbidden');
  });
  it('прочее (502, сеть, 401) — error', () => {
    expect(classifyError({ status: 502 })).toBe('error');
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('error');
    expect(classifyError({ status: 401 })).toBe('error');
    expect(classifyError('строка')).toBe('error');
  });
});

describe('deriveLoadState — loading|empty|error|forbidden|partial|ok', () => {
  it('ещё нет данных — loading', () => {
    expect(deriveLoadState({ loading: true })).toBe('loading');
  });
  it('ошибка — error, 403 — forbidden (даже если идёт перезагрузка)', () => {
    expect(deriveLoadState({ loading: true, error: { status: 502 } })).toBe('error');
    expect(deriveLoadState({ error: { status: 403 } })).toBe('forbidden');
  });
  it('0 строк и выдача полная — empty (проверенный ноль)', () => {
    expect(deriveLoadState({ rows: [] })).toBe('empty');
    expect(deriveLoadState({ rows: [], meta: { page: { total: 0, has_more: false, fields_checked: true } } })).toBe('empty');
  });
  it('0 строк, но запись есть вне ваших проектов — forbidden, не empty', () => {
    expect(deriveLoadState({ rows: [], meta: { outside_scope: { id: 'X', verdict: 'outside_scope' } } })).toBe('forbidden');
  });
  it('0 строк при непроверенных полях — partial, не empty', () => {
    expect(deriveLoadState({ rows: [], meta: { page: { total: 0, fields_checked: false } } })).toBe('partial');
  });
  it('строки есть и выдача полная — ok', () => {
    expect(deriveLoadState({ rows: [1, 2] })).toBe('ok');
  });
  it('строки есть, но обрезано/страница/неизвестно — partial', () => {
    expect(deriveLoadState({ rows: [1], meta: { truncated: true, limit: 1 } })).toBe('partial');
    expect(deriveLoadState({ rows: [1], meta: { truncated: 'unknown' } })).toBe('partial');
    expect(deriveLoadState({ rows: [1], meta: { page: { total: 9, has_more: true } } })).toBe('partial');
  });
  it('перезагрузка поверх данных — показываем данные, а не скелет', () => {
    expect(deriveLoadState({ loading: true, rows: [1] })).toBe('ok');
  });
});
