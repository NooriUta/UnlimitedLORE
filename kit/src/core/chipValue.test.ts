// Значение-чип: объект с кодом и подписью вместо строки
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, половина kit).
//
// ПОВОД — смена контракта, уже уехавшая в develop. Серверная сессия 10.11.2026:
// `values.projects` и `values.components` были `string[]`, стали списком
// объектов `{id, label, inherited_from}`. Её же предупреждение дословно: «где
// поле рисуется в „Свойствах" строкой, читайте .label/.id, иначе выйдет
// [object Object]».
//
// У нас выходило не «[object Object]», а JSON целиком: `valueKey` и `valueText`
// падали в `JSON.stringify`. Это ХУЖЕ: строка выглядит данными, ссылка по такому
// «коду» ведёт в никуда, а в фасете каждый чип становится отдельным значением —
// то есть фильтр по проекту ломается молча.
//
// Поэтому главный тест здесь — не вид, а то, что объект НЕ ДОЕЗЖАЕТ до экрана
// строкой. Он защищает не от будущей ошибки, а от уже случившейся.
import { describe, expect, it } from 'vitest';
import { VALUE_CHIPS_INLINE, asChip, chipId, chipLabel, isChipList } from './chipValue';
import { valueText } from '../record/fmt';

const chip = (id: string, label?: string | null, from?: { type: string; id: string } | null) =>
  ({ id, ...(label === undefined ? {} : { label }), ...(from === undefined ? {} : { inherited_from: from }) });

describe('S4-29 · разбор значения-чипа', () => {
  it('потолок ряда назван одним местом и равен трём', () => {
    expect(VALUE_CHIPS_INLINE, 'число серверной сессии: первые 3 и «ещё N»').toBe(3);
  });

  it('объект с кодом — чип; код и подпись читаются', () => {
    const c = asChip(chip('NooriUta/UnlimitedLORE', 'UnlimitedLORE'));
    expect(c).not.toBeNull();
    expect(chipId(c!)).toBe('NooriUta/UnlimitedLORE');
    expect(chipLabel(c!)).toBe('UnlimitedLORE');
  });

  it('подписи нет — показываем КОД, а не пустоту и не выдуманное слово', () => {
    expect(chipLabel(asChip(chip('LORE'))!)).toBe('LORE');
    expect(chipLabel(asChip(chip('LORE', null))!)).toBe('LORE');
    expect(chipLabel(asChip(chip('LORE', '   '))!)).toBe('LORE');
  });

  it('строка чипом не считается — прежний путь не ломается', () => {
    expect(asChip('NooriUta/UnlimitedLORE')).toBeNull();
    expect(asChip(42)).toBeNull();
    expect(asChip(null)).toBeNull();
  });

  it('объект БЕЗ кода чипом не считается: подписать его нечем', () => {
    expect(asChip({ label: 'без кода' })).toBeNull();
    expect(asChip({ id: '' })).toBeNull();
    expect(asChip({ id: '   ' })).toBeNull();
    expect(asChip({ id: 7 })).toBeNull();
  });

  it('унаследованный чип несёт свой источник, свой — не несёт', () => {
    expect(asChip(chip('LORE', 'LORE', { type: 'sprint', id: 'SPRINT_X' }))!.inherited_from)
      .toEqual({ type: 'sprint', id: 'SPRINT_X' });
    expect(asChip(chip('LORE', 'LORE', null))!.inherited_from ?? null).toBeNull();
  });

  it('битый источник — это НЕ «своё»: признак наследования теряться не должен', () => {
    // Источник без типа или без кода читать нечем, но утверждение «значение
    // пришло не от самой записи» остаётся верным — иначе унаследованный чип
    // выдадим за собственный.
    const c = asChip({ id: 'LORE', inherited_from: { type: '', id: '' } })!;
    expect(c.inherited_from).not.toBeNull();
  });

  it('список чипов узнаётся по первому пригодному элементу, а не по всем', () => {
    expect(isChipList([chip('A', 'А')])).toBe(true);
    expect(isChipList(['A', 'B'])).toBe(false);
    expect(isChipList([])).toBe(false);
    // Смешанный список бывает на стыке версий: один объект уже есть — значит
    // путь чипов, а строки в нём станут чипами без подписи.
    expect(isChipList(['A', chip('B', 'Б')])).toBe(true);
  });
});

// Обратная проверка показала, что эта починка не была покрыта ВООБЩЕ: снимаю
// разбор чипа в valueText — ни один тест не краснеет. А путь живой: тем же
// valueText печатаются значения в журнале правок и в подсказках, и там чип
// выезжал JSON-ом. Поэтому проверка отдельная, а не «заодно».
describe('S4-29 · значение словами: журнал и подсказки', () => {
  it('чип печатается подписью, а не JSON-ом', () => {
    expect(valueText({ id: 'NooriUta/UnlimitedLORE', label: 'UnlimitedLORE' })).toBe('UnlimitedLORE');
  });

  it('подписи нет — печатается код', () => {
    expect(valueText({ id: 'LORE', label: null })).toBe('LORE');
  });

  it('обычный объект по-прежнему JSON — прежнее поведение не тронуто', () => {
    expect(valueText({ a: 1 })).toBe('{"a":1}');
  });

  it('пустое значение по-прежнему «—»', () => {
    expect(valueText(null)).toBe('—');
  });
});
