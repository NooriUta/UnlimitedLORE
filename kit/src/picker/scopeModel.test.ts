// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03 — модель выбора нескольких проектов:
// поиск, «все мои», «только этот», параметр URL. Чистые функции — без React.
import { describe, expect, it } from 'vitest';
import {
  filterScopeOptions, formatScopeParam, mineScope, onlyScope, orderScopeOptions,
  parseScopeParam, summarizeScope, toggleScope, unknownScopeIds,
} from './scopeModel';
import type { ScopeOption } from './scopeModel';

const OPTS: ScopeOption[] = [
  { id: 'unlimitedlore', title: 'Unlimited LORE', mine: true },
  { id: 'aida-root', title: 'AIDA monorepo' },
  { id: 'mobilepoc', title: 'miniLORE', mine: true },
  { id: 'tyr', title: 'TYR' },
];

describe('S4-03 · поиск проектов', () => {
  it('пустой запрос — все проекты как есть', () => {
    expect(filterScopeOptions(OPTS, '   ').map(o => o.id)).toEqual(OPTS.map(o => o.id));
  });
  it('ищет по коду и по названию без учёта регистра', () => {
    expect(filterScopeOptions(OPTS, 'LORE').map(o => o.id)).toEqual(['unlimitedlore', 'mobilepoc']);
    expect(filterScopeOptions(OPTS, 'aida').map(o => o.id)).toEqual(['aida-root']);
  });
  it('кириллица и ё ищутся (не ASCII-only)', () => {
    const ru: ScopeOption[] = [{ id: 'p1', title: 'Ёлка' }, { id: 'p2', title: 'Сосна' }];
    expect(filterScopeOptions(ru, 'елк').map(o => o.id)).toEqual(['p1']);
  });
  it('ничего не нашлось — пустой список, а не все', () => {
    expect(filterScopeOptions(OPTS, 'zzz')).toEqual([]);
  });
});

describe('S4-03 · действия выбора', () => {
  it('toggle добавляет и снимает, порядок — порядок добавления', () => {
    expect(toggleScope([], 'tyr')).toEqual(['tyr']);
    expect(toggleScope(['tyr'], 'aida-root')).toEqual(['tyr', 'aida-root']);
    expect(toggleScope(['tyr', 'aida-root'], 'tyr')).toEqual(['aida-root']);
  });
  it('«только этот» — ровно один проект', () => {
    expect(onlyScope('tyr')).toEqual(['tyr']);
  });
  it('«все мои» — проекты с ролью, в порядке списка', () => {
    expect(mineScope(OPTS)).toEqual(['unlimitedlore', 'mobilepoc']);
  });
  it('мои — первыми, дальше по алфавиту; без ролей — просто по алфавиту', () => {
    expect(orderScopeOptions(OPTS, true).map(o => o.id)).toEqual(['mobilepoc', 'unlimitedlore', 'aida-root', 'tyr']);
    expect(orderScopeOptions(OPTS, false).map(o => o.id)).toEqual(['aida-root', 'mobilepoc', 'tyr', 'unlimitedlore']);
  });
});

describe('S4-03 · подпись выбора', () => {
  it('пустой выбор — «все проекты» (фильтра нет)', () => {
    expect(summarizeScope([], OPTS, true)).toEqual({ kind: 'all' });
  });
  it('один — его название', () => {
    expect(summarizeScope(['tyr'], OPTS, true)).toEqual({ kind: 'one', id: 'tyr', title: 'TYR' });
  });
  it('один, но его нет в списке — код, а не пустота', () => {
    expect(summarizeScope(['ghost'], OPTS, true)).toEqual({ kind: 'one', id: 'ghost', title: 'ghost' });
  });
  it('ровно мои — «все мои», только если роли проверены', () => {
    expect(summarizeScope(['mobilepoc', 'unlimitedlore'], OPTS, true)).toEqual({ kind: 'mine', count: 2 });
    expect(summarizeScope(['mobilepoc', 'unlimitedlore'], OPTS, false)).toEqual({ kind: 'many', count: 2 });
  });
  it('несколько — число', () => {
    expect(summarizeScope(['tyr', 'aida-root', 'mobilepoc'], OPTS, true)).toEqual({ kind: 'many', count: 3 });
  });
});

describe('S4-03 · выбор в URL', () => {
  it('туда и обратно; пустой — параметра нет', () => {
    expect(formatScopeParam(['a', 'b'])).toBe('a,b');
    expect(formatScopeParam([])).toBeNull();
    expect(parseScopeParam('a,b')).toEqual(['a', 'b']);
    expect(parseScopeParam(null)).toEqual([]);
  });
  it('мусор в адресе — пробелы, пустые и дубли отбрасываются', () => {
    expect(parseScopeParam(' a , ,b,a ')).toEqual(['a', 'b']);
  });
  it('выбранные, которых нет в списке, — видны отдельно, а не выброшены молча', () => {
    expect(unknownScopeIds(['tyr', 'ghost'], OPTS)).toEqual(['ghost']);
  });
});
