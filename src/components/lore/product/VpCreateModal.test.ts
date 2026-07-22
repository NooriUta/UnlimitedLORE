import { describe, it, expect } from 'vitest';
import { normalizeVpId } from './VpCreateModal';

describe('PL-18B · id новой боли/выгоды', () => {
  it('дописывает недостающий префикс', () => {
    // Без префикса запись завелась бы успешно и стала бы НЕВИДИМОЙ в
    // собственном реестре: и цвет, и выбор паспорта ветвятся ровно по нему.
    expect(normalizeVpId('pain', 'lore-manual-handoff')).toBe('PAIN-LORE-MANUAL-HANDOFF');
    expect(normalizeVpId('gain', 'lore-linked-releases')).toBe('GAIN-LORE-LINKED-RELEASES');
  });

  it('не удваивает уже поставленный префикс', () => {
    expect(normalizeVpId('pain', 'PAIN-X')).toBe('PAIN-X');
    expect(normalizeVpId('pain', 'pain-x')).toBe('PAIN-X');
  });

  it('пробелы становятся дефисами, края обрезаются', () => {
    expect(normalizeVpId('gain', '  меньше рутины ')).toBe('GAIN-МЕНЬШЕ-РУТИНЫ');
  });

  it('пустой ввод остаётся пустым, а не превращается в голый префикс', () => {
    // Иначе кнопка «Создать» разблокировалась бы на пустом поле и завела
    // запись с id «PAIN-» — мусор, который потом надо искать и удалять.
    expect(normalizeVpId('pain', '')).toBe('');
    expect(normalizeVpId('pain', '   ')).toBe('');
  });
});
