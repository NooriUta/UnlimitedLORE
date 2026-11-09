// Многозначные поля списка остаются многозначными
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05, находка 09.11).
//
// Повод: серверная сессия заметила, что `project`, `components`, `release`,
// `milestone` у спринта (и `tags` у ADR) проходят через `joined()` — список
// рёбер склеивается в одну строку «A, B». Проверил пробой: так и есть.
//
// Почему это не косметика:
//   • фасет «Компоненты» показывает ОДНО значение «LORE, FORSETI» вместо двух,
//     и выбрать один компонент нельзя;
//   • фильтр «релиз = lore-v1.18.0» не находит спринт с двумя релизами:
//     склеенная строка не равна ни одному из них;
//   • «без релиза» при этом работает, потому что склейка пустого списка — ''.
//     Поэтому беда и не бросалась в глаза: половина кнопок работала.
//
// Склейка не нужна даже для показа: `ListView.valueCell` сам рисует каждое
// значение своим чипом через `valuesOf`. То есть `joined()` только терял
// данные — ради вида, который и так получается лучше без неё.
//
// Проверка идёт через модель kit (`valuesOf`, `applyFilterSet`, `facetOf`) —
// теми же функциями, которыми список фильтрует и считает фасеты.
import { describe, expect, it } from 'vitest';
import { applyFilterSet, facetOf, valuesOf, type FilterSet } from '@seidr/kit';
import { adrRecord, sprintRecord } from './records';

const SPRINT_A = {
  sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '🔄 IN PROGRESS',
  git_projects: ['AIDA/UnlimitedLORE', 'AIDA/miniLORE'],
  components: ['LORE', 'FORSETI'],
  release_ids: ['lore-v1.17.4', 'lore-v1.18.0'],
  milestone_ids: ['M-1'],
  priority: 1,
};
const SPRINT_B = {
  sprint_id: 'SPRINT_B', name: 'Спринт Б', status_raw: '📋 PLANNED',
  git_projects: ['AIDA/UnlimitedLORE'], components: ['LORE'], release_ids: [], milestone_ids: [],
};

const only = (key: string, values: string[]): FilterSet => ({
  fields: { [key]: { op: 'any', values } },
});

const records = [sprintRecord(SPRINT_A), sprintRecord(SPRINT_B)];

describe('S4-05 · список: массив остаётся массивом', () => {
  it('положительный контроль: записи собрались, статусы канонические', () => {
    expect(records.map(r => [r.id, r.status])).toEqual([['SPRINT_A', 'active'], ['SPRINT_B', 'planned']]);
  });

  it('компоненты — два значения, а не одна склейка', () => {
    expect(valuesOf(records[0], 'fields.components')).toEqual(['LORE', 'FORSETI']);
  });

  it('проекты, релизы и вехи — тоже списками', () => {
    expect(valuesOf(records[0], 'fields.project')).toEqual(['AIDA/UnlimitedLORE', 'AIDA/miniLORE']);
    expect(valuesOf(records[0], 'fields.release')).toEqual(['lore-v1.17.4', 'lore-v1.18.0']);
    expect(valuesOf(records[0], 'fields.milestone')).toEqual(['M-1']);
  });

  it('фильтр по ОДНОМУ релизу находит спринт с двумя — это и было сломано', () => {
    const found = applyFilterSet(records, only('fields.release', ['lore-v1.18.0']));
    expect(found.map(r => r.id)).toEqual(['SPRINT_A']);
  });

  it('фильтр по одному компоненту находит оба спринта', () => {
    const found = applyFilterSet(records, only('fields.components', ['LORE']));
    expect(found.map(r => r.id)).toEqual(['SPRINT_A', 'SPRINT_B']);
  });

  it('«без релиза» по-прежнему работает: пустой список — это пустое значение', () => {
    const found = applyFilterSet(records, only('fields.release', ['']));
    expect(found.map(r => r.id)).toEqual(['SPRINT_B']);
  });

  it('фасет «Релиз» показывает значения по отдельности и считает пустые', () => {
    const f = facetOf(records, { fields: {} }, 'fields.release');
    expect(f.values).toEqual([
      { value: 'lore-v1.17.4', count: 1 },
      { value: 'lore-v1.18.0', count: 1 },
    ]);
    expect(f.empty).toBe(1);
    expect(f.total).toBe(2);
  });

  it('у многозначного поля сумма счётчиков больше числа записей — это не ошибка', () => {
    const f = facetOf(records, { fields: {} }, 'fields.components');
    const sum = f.values.reduce((n, v) => n + v.count, 0);
    // SPRINT_A попадает и в LORE, и в FORSETI: запись считается в каждом своём
    // значении. Сторож сумм, если его когда-нибудь напишут, должен это знать.
    expect(sum).toBeGreaterThan(records.length);
    expect(f.values.find(v => v.value === 'LORE')?.count).toBe(2);
  });

  it('у ADR теги и проекты тоже списками', () => {
    const r = adrRecord({ adr_id: 'ADR-1', name: 'Решение', status: 'accepted', tags: ['ui', 'api'], git_projects: ['AIDA/UnlimitedLORE'] });
    expect(valuesOf(r, 'fields.tags')).toEqual(['ui', 'api']);
    expect(valuesOf(r, 'fields.project')).toEqual(['AIDA/UnlimitedLORE']);
  });

  it('пусто остаётся пустым, а не строкой «»: иначе «без релиза» сломается', () => {
    expect(valuesOf(records[1], 'fields.release')).toEqual([]);
    expect(records[1].fields.release).toEqual([]);
  });
});
