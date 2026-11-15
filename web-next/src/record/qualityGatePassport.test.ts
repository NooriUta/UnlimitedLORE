// SPRINT_LORE_MODEL_DOCS_TIDY/MD-04, второй заход по QG — раздел и паспорт v2 гейта качества.
// До него: recordHref('quality_gate') — null, гейт из поиска и связей не открывался («у типа нет
// раздела»), увидеть его можно было только на странице QG v1. Повод — SPRINT_QG_REBUILD
// (ADR-LORE-053 D7): состояния жизненного цикла, проект-владелец и поля снятия должны быть видны.
import { describe, expect, it } from 'vitest';
import { readRoute, recordHref, sectionOfType } from '../nav/loreRoutes';
import { V2_SECTIONS } from '../shell/v2Config';
import { LIST_SCREENS } from '../lists/screens';
import { qualityGateRecord } from '../lists/records';
import { PASSPORT_OF } from '../pages/ListScreen';
import { PASSPORT_TYPES } from './passportAdapters';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('MD-04 · гейт качества — раздел и паспорт', () => {
  it('тип — раздел оболочки, адрес записи и паспорт фасада', () => {
    expect(V2_SECTIONS as readonly string[]).toContain('quality_gate');
    expect(sectionOfType('quality_gate')).toBe('quality_gate');
    const h = recordHref('quality_gate', 'QG-LORE-SCHEMA');
    expect(h, 'recordHref(quality_gate) — null: гейт из поиска и связей вёл в никуда').toBe('/?mod=forseti&sec=quality_gate&open=QG-LORE-SCHEMA');
    expect(readRoute(params(h!)).record).toEqual({ kind: 'quality_gate', id: 'QG-LORE-SCHEMA' });
    expect(PASSPORT_TYPES as readonly string[]).toContain('quality_gate');
  });

  it('щелчок по строке раздела открывает паспорт, а не отказ «паспорта нет»', () => {
    expect(Object.keys(LIST_SCREENS)).toContain('quality_gates');
    expect((PASSPORT_OF as Record<string, string>).quality_gates).toBe('quality_gate');
  });

  it('проект остаётся последним типом паспорта (как у фасада)', () => {
    expect(PASSPORT_TYPES[PASSPORT_TYPES.length - 1]).toBe('project');
  });

  it('строка среза quality_gates → запись kit: состояние и итог прогона — разные поля', () => {
    expect(qualityGateRecord({
      qg_id: 'QG-LORE-SCHEMA', name: 'Схема', status: 'active', last_run_status: 'FAIL',
      component_id: 'LORE', components: ['LORE'], projects: ['NooriUta/UnlimitedLORE'], sprint_id: 'SPRINT_QG_REBUILD',
    })).toMatchObject({
      id: 'QG-LORE-SCHEMA', kind: 'quality_gate', title: 'Схема', status: '',
      fields: { state: 'active', lastRun: 'FAIL', component: 'LORE', components: ['LORE'], project: ['NooriUta/UnlimitedLORE'], sprint: 'SPRINT_QG_REBUILD' },
    });
  });

  it('гейт без проекта-владельца и без названия: проект пуст, а не выдуман; название — код', () => {
    const r = qualityGateRecord({ qg_id: 'QG-2' });
    expect(r.title).toBe('QG-2');
    expect(r.fields.project, 'проект пуст').toBeFalsy();
    expect(r.fields.state).toBe('');
  });
});
