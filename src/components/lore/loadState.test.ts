import { describe, expect, it } from 'vitest';
import { loadStateOf } from './loadState';
import { LoreHttpError } from '../../api/lore';

// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-07, зона 2. Лента новостей при сбое делала
// setItems([]) и рисовала «Пока ничего не произошло»; useSlice не отдавал error
// вовсе. Правило: у загрузки четыре исхода, и «пусто» — только один из них.
describe('исход загрузки: ошибка ≠ пусто', () => {
  it('ещё грузится', () => {
    expect(loadStateOf(null, null).k).toBe('loading');
  });

  it('пришёл пустой список — это «пусто»', () => {
    expect(loadStateOf([], null).k).toBe('empty');
  });

  it('пришли строки', () => {
    expect(loadStateOf([1, 2], null)).toEqual({ k: 'ok', rows: [1, 2] });
  });

  it('сбой — это ошибка с кодом, даже если строк нет', () => {
    const s = loadStateOf([], new LoreHttpError(403, 'FORBIDDEN', ''));
    expect(s.k).toBe('error');
    if (s.k === 'error') { expect(s.status).toBe(403); expect(s.text).toContain('403'); }
  });

  it('ошибка важнее старых строк: экран не выдаёт прошлые данные за свежие', () => {
    expect(loadStateOf([1], new Error('сеть')).k).toBe('error');
  });
});
