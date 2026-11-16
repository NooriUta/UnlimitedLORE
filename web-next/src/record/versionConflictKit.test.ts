// saveMerging переехал в kit (K5-PASSPORT-FROM-MODEL, шаг 4) и узнаёт отказ «версия разошлась»
// по форме ошибки. Положительный контроль: настоящий VersionConflict LORE эту форму имеет —
// иначе слияние на 409 молча перестало бы работать (человек снова переносил бы правку руками).
import { describe, expect, it } from 'vitest';
import { versionConflictOf } from '@seidr/kit/content';
import { VersionConflict } from './passportSave';

describe('VersionConflict LORE ↔ saveMerging kit', () => {
  it('отказ LORE распознан, кто правил — передан', () => {
    expect(versionConflictOf(new VersionConflict('v2', 'omiloreadmin', 'запись изменили'))).toEqual({ updatedBy: 'omiloreadmin' });
  });
  it('другая ошибка — не конфликт версий', () => {
    expect(versionConflictOf(new Error('сеть'))).toBeNull();
  });
});
