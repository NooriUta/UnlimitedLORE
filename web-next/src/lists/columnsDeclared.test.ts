// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35 — сторож: каждая колонка экрана объявлена
// у типа (или это поле верхнего уровня / служебная колонка движка).
//
// Зачем. kit с S4-35 печатает в ячейке «нет у типа», когда тип объявил свои
// поля, а колонки среди них нет: в смешанном списке «—» читалось бы как
// «значения нет». Обратная сторона правила — колонка, которую экран показывает,
// но забыл объявить у типа, превратится в ложное «нет у типа» во ВСЕХ строках.
// Сторож ловит это до выкатки, а не на экране владелицы.
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS } from './screens';

// Поля записи верхнего уровня (kit/src/list/listModel.ts TOP_LEVEL) и колонки,
// которые движок рисует сам, не глядя в поля типа.
const ENGINE = new Set(['id', 'kind', 'title', 'status', 'updated_at', 'body_md', 'title+id', 'verdict', 'edges_count', 'actions', 'select']);
const ENGINE_PREFIX = ['progress:', 'sum:'];

describe('S4-35 · колонки экранов объявлены у своих типов', () => {
  for (const [id, screen] of Object.entries(LIST_SCREENS)) {
    it(`${id}: нет колонки, которая выйдет ложным «нет у типа»`, () => {
      const cfg = screen.config('ru');
      const declared = new Set(Object.values(cfg.kinds).flatMap(k => (k.fields ?? []).map(f => f.key)));
      const hasDeclared = Object.values(cfg.kinds).some(k => k.fields);
      const orphan = (cfg.list?.columns ?? [])
        .filter(c => !ENGINE.has(c) && !ENGINE_PREFIX.some(p => c.startsWith(p)))
        .map(c => (c.startsWith('fields.') ? c.slice(7) : c))
        .filter(c => hasDeclared && !declared.has(c));
      expect(orphan).toEqual([]);
    });
  }
});
