import { describe, it, expect } from 'vitest';
import { mergeParam, readParam, mergeSetParam, readSetParam, switchParam } from './useUrlState';

describe('mergeParam — слияние одного параметра состояния экрана в URL', () => {
  it('ставит ключ, не трогая чужие параметры (section/passport/q)', () => {
    const p = new URLSearchParams('section=analytics&passport=X&q=foo');
    const next = mergeParam(p, 'atab', 'sprints', 'overview');
    expect(next.get('atab')).toBe('sprints');
    expect(next.get('section')).toBe('analytics');
    expect(next.get('passport')).toBe('X');
    expect(next.get('q')).toBe('foo');
  });

  it('значение по умолчанию удаляет ключ', () => {
    const p = new URLSearchParams('section=analytics&atab=sprints');
    const next = mergeParam(p, 'atab', 'overview', 'overview');
    expect(next.has('atab')).toBe(false);
    expect(next.toString()).toBe('section=analytics');
  });

  it('null и пустая строка тоже удаляют ключ', () => {
    const p = new URLSearchParams('rel=v1.2.0&section=releases');
    expect(mergeParam(p, 'rel', null, '').has('rel')).toBe(false);
    expect(mergeParam(p, 'rel', '', '').has('rel')).toBe(false);
  });

  it('не мутирует исходный объект', () => {
    const p = new URLSearchParams('section=releases');
    mergeParam(p, 'rel', 'v1', '');
    expect(p.toString()).toBe('section=releases');
  });

  it('перезаписывает существующее значение, а не дублирует ключ', () => {
    const p = new URLSearchParams('btab=obzor&btab=plan');
    const next = mergeParam(p, 'btab', 'pubs', 'obzor');
    expect(next.getAll('btab')).toEqual(['pubs']);
  });

  it('сохраняет порядок чужих параметров', () => {
    const p = new URLSearchParams('section=tyr&q=a&z=1');
    expect(mergeParam(p, 'ttab', 'runs', 'plan').toString()).toBe('section=tyr&q=a&z=1&ttab=runs');
  });
});

describe('readParam — чтение с дефолтом и белым списком', () => {
  it('нет ключа → дефолт', () => {
    expect(readParam(new URLSearchParams(''), 'atab', 'overview')).toBe('overview');
  });
  it('значение из URL', () => {
    expect(readParam(new URLSearchParams('atab=qg'), 'atab', 'overview')).toBe('qg');
  });
  it('значение вне белого списка → дефолт (мусор в URL не ломает экран)', () => {
    expect(readParam(new URLSearchParams('atab=bogus'), 'atab', 'overview', ['overview', 'qg'])).toBe('overview');
    expect(readParam(new URLSearchParams('atab=qg'), 'atab', 'overview', ['overview', 'qg'])).toBe('qg');
  });
});

describe('mergeSetParam / readSetParam — мультивыбор фильтра', () => {
  it('пишет каждое значение отдельным повтором ключа (запятая в имени не ломает)', () => {
    const p = new URLSearchParams('section=x');
    const next = mergeSetParam(p, 'bst', new Set(['draft', 'Рубрика, вторая']));
    expect(next.getAll('bst')).toEqual(['draft', 'Рубрика, вторая']);
    expect(next.get('section')).toBe('x');
    expect([...readSetParam(next, 'bst')]).toEqual(['draft', 'Рубрика, вторая']);
  });
  it('пустой набор удаляет ключ', () => {
    const p = new URLSearchParams('bst=a&bst=b&q=1');
    expect(mergeSetParam(p, 'bst', new Set()).toString()).toBe('q=1');
  });
  it('нет ключа → пустой набор', () => {
    expect(readSetParam(new URLSearchParams(''), 'bst').size).toBe(0);
  });
});

describe('switchParam — смена раздела сбрасывает состояние экранов', () => {
  const OWNED = ['atab', 'rel'];
  it('другой раздел: ставит его и удаляет ключи экранов, чужое не трогает', () => {
    const p = new URLSearchParams('section=analytics&atab=qg&rel=v1&q=x');
    switchParam(p, 'section', 'releases', OWNED);
    expect(p.toString()).toBe('section=releases&q=x');
  });
  it('тот же раздел: ключи экранов остаются', () => {
    const p = new URLSearchParams('section=analytics&atab=qg');
    switchParam(p, 'section', 'analytics', OWNED);
    expect(p.get('atab')).toBe('qg');
  });
});
