// Иконки значений и поля фасетов доходят до списка
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05 + S4-25, находка 09.11).
//
// `loreFilters.ts` оказался ещё одним случаем «написано и не вызывается»:
// `LORE_FILTER_FIELDS`, `SPRINT_FILTERS`, `TASK_FILTERS`, `loreValueIcon` и
// `tasksWithSprintRelease` не упоминались ни в одном экране. Списки задавали
// свои фильтры прямо в конфиге (`filters: ['status','project','components',
// 'release']`), а `valueIcon` в `ListView` не передавался вовсе — значит
// иконки значений из прототипа v4 (релиз — книга, компонент — шестерёнка,
// проект — замок, P0 — пламя) человек не видел.
//
// Беда не «иконок нет», а ДВА НАБОРА ИМЁН одного и того же поля: пока они
// живут в двух местах, они расходятся молча. Поэтому фильтры экранов берутся
// из `LORE_FILTER_FIELDS`, и тест держит это: один источник имён — одна правда.
//
// Отдельно проверяется, что иконка находится по обоим написаниям ключа:
// фасеты зовут поле `fields.release`, а колонка таблицы — `release`; оба
// доходят до `loreValueIcon`, и ни одно не должно остаться без иконки.
import { describe, expect, it } from 'vitest';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { LIST_SCREENS } from './screens';
import { LORE_FILTER_FIELDS, loreValueIcon } from './loreFilters';

registerGameIcons(gameIcons);

const sprintFilters = () => LIST_SCREENS.sprints.config('ru').list?.filters ?? [];
const adrFilters = () => LIST_SCREENS.adrs.config('ru').list?.filters ?? [];

describe('S4-05 · имена полей фасетов — из одного места', () => {
  it('положительный контроль: у списков есть фасеты', () => {
    expect(sprintFilters().length).toBeGreaterThan(2);
    expect(adrFilters().length).toBeGreaterThan(2);
  });

  it('фасеты спринтов названы теми же ключами, что знает loreFilters', () => {
    expect(sprintFilters()).toEqual([
      'status',
      LORE_FILTER_FIELDS.release,
      LORE_FILTER_FIELDS.project,
      LORE_FILTER_FIELDS.component,
    ]);
  });

  it('фасеты ADR — тоже из общего набора', () => {
    expect(adrFilters()).toEqual(['status', LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project, TAGS]);
  });

  it('у каждого фасета, кроме статуса и тегов, есть иконка значения', () => {
    for (const key of [...sprintFilters(), ...adrFilters()]) {
      if (NO_ICON.has(key)) continue;
      expect(loreValueIcon(key, 'какое-то-значение'), `${key}: иконки нет`).not.toBeNull();
    }
  });

  // Решение владелицы 11.11.2026 (SPRINT_UXR_S9_SCALE_OPT/S9-03, вариант «в»):
  // у значения тега иконки нет. В v1 её не было, а выдумывать нельзя (S4-25).
  // Исключение названо здесь, а не заглушено общим «пропустить, если нет».
  it('тег — без иконки по решению владелицы, и это ровно одно исключение', () => {
    expect(loreValueIcon(TAGS, 'ux')).toBeNull();
    expect([...NO_ICON]).toEqual(['status', TAGS]);
  });
});

const TAGS = 'fields.tags';
const NO_ICON = new Set(['status', TAGS]);

describe('S4-25 · иконка находится по обоим написаниям ключа', () => {
  it('фасет зовёт поле «fields.release», колонка — «release»; иконка одна и та же', () => {
    expect(loreValueIcon('fields.release', 'lore-v1.18.0')).toEqual(loreValueIcon('release', 'lore-v1.18.0'));
    expect(loreValueIcon('release', 'lore-v1.18.0')).toEqual({ icon: 'open-book', color: 'var(--suc)' });
  });

  it('то же для компонентов, проектов и вех', () => {
    expect(loreValueIcon('components', 'LORE')).toEqual({ icon: 'cog', color: 'var(--inf)' });
    expect(loreValueIcon('project', 'AIDA/UnlimitedLORE')?.color).toBe('var(--acc)');
    expect(loreValueIcon('milestone', 'M-1')?.color).toBe('var(--wrn)');
  });

  it('пустое значение — без иконки, статус и вид — из словаря конфига', () => {
    expect(loreValueIcon('release', '')).toBeNull();
    expect(loreValueIcon('status', 'done')).toBeUndefined();
    expect(loreValueIcon('kind', 'sprint')).toBeUndefined();
  });
});
