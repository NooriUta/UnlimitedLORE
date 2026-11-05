import { describe, expect, it } from 'vitest';
import { checkNewDictType } from './dictTypeInput';

// RM-P11: новый dict_type рождался мёртвым — список типов строился из
// существующих строк, тип с нулём записей в интерфейсе не появлялся, а агенту
// dict_set запрещён правилом «словари правит человек». Вход для человека —
// поле «Новый тип». Проверка кода — здесь.
describe('checkNewDictType', () => {
  const types = ['area', 'product', 'task_status'];

  it('пустой ввод — ничего не предлагает', () => {
    expect(checkNewDictType('', types)).toEqual({ kind: 'empty' });
    expect(checkNewDictType('   ', types)).toEqual({ kind: 'empty' });
  });

  it('корректный новый код — можно завести', () => {
    expect(checkNewDictType('release_kind', types)).toEqual({ kind: 'new', code: 'release_kind' });
  });

  it('пробелы по краям обрезаются', () => {
    expect(checkNewDictType('  channel_kind ', types)).toEqual({ kind: 'new', code: 'channel_kind' });
  });

  it('тип уже есть — открыть существующий, а не завести второй', () => {
    expect(checkNewDictType('product', types)).toEqual({ kind: 'exists', code: 'product' });
  });

  // RM-X1: id с пробелом и глифом («M2 ✓ core») не набирался с клавиатуры и
  // переименовывался миграцией. Запрет на вводе дешевле миграции потом.
  it.each([
    ['пробел внутри', 'release kind'],
    ['кириллица', 'вид_релиза'],
    ['заглавные', 'ReleaseKind'],
    ['дефис', 'release-kind'],
    ['начинается с цифры', '1kind'],
    ['начинается с подчёркивания', '_kind'],
    ['глиф', 'kind✓'],
  ])('отбивается: %s', (_why, code) => {
    expect(checkNewDictType(code, types)).toEqual({ kind: 'bad' });
  });
});
