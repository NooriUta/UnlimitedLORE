// Фасеты и разрезы списков LORE подписаны (SPRINT_UXR_S13_KIT4/K4-FACET-LABELS).
//
// Валидатор kit теперь называет фасет или разрез по полю без подписи
// (`facet-without-label`): на экране такой ключ стоял сырым словом. Здесь —
// что ни у одного раздела LORE, ни в одной локали, такого пропуска нет, и что
// ключи `list` разделов kit знает (`unknown-key` под `list.`).
import { describe, expect, it } from 'vitest';
import { validateKitConfig } from '@seidr/kit/core';
import { LIST_SCREENS } from './screens';
import type { ListScreenId } from './screens';

const ids = Object.keys(LIST_SCREENS) as ListScreenId[];

describe('K4-FACET-LABELS · у фасетов и разрезов LORE есть подписи', () => {
  it('положительный контроль: разделов много, и у них есть фасеты', () => {
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.some(id => (LIST_SCREENS[id].config('ru').list?.filters ?? []).length > 0)).toBe(true);
  });

  for (const lang of ['ru', 'en'] as const) {
    it.each(ids)(`%s (${lang}): ни фасета, ни разреза без подписи; ключи list знакомы kit`, id => {
      const v = validateKitConfig(LIST_SCREENS[id].config(lang));
      const bad = v.warnings.filter(w => w.code === 'facet-without-label'
        || (w.code === 'unknown-key' && w.path.startsWith('list.')));
      expect(bad.map(w => w.message)).toEqual([]);
    });
  }
});
