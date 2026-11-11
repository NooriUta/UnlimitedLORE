// Старые адреса отдельных страниц паспорта → оболочка, запись во весь экран
// («да» владелицы 09.11 на перевод задачи и спринта в оболочку).
import { describe, expect, it } from 'vitest';
import { legacyHashHref, legacyPassportHref } from './loreRoutes';

describe('старые адреса паспорта ведут в оболочку', () => {
  it('задача: ?section=tasks&passport=S/T → раздел «Задачи», во весь экран', () => {
    expect(legacyPassportHref('?section=tasks&passport=SPRINT_A%2FT-1'))
      .toBe('/?mod=forseti&sec=task&open=SPRINT_A%2FT-1&place=full');
  });

  it('спринт: ?section=sprints&passport=S → раздел «Спринты», во весь экран, вкладка «Задачи»', () => {
    expect(legacyPassportHref('?section=sprints&passport=SPRINT_X&tab=tasks&group=status'))
      .toBe('/?mod=forseti&sec=sprint&open=SPRINT_X&place=full&tab=tasks');
  });

  it('не старый адрес паспорта — null (ничего не переписываем)', () => {
    for (const s of ['', '?section=sprints', '?section=adrs&passport=ADR-1', '?mod=forseti&sec=task&open=X']) {
      expect(legacyPassportHref(s), s).toBeNull();
    }
  });
});

// D-22 (аудит 09.11, SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28): ссылка v1 на задачу
// якорем — `#SPRINT_X/S4-11` — в v2 игнорировалась: открывалась главная.
describe('D-22 · якорь «#СПРИНТ/КОД» открывает задачу', () => {
  it('#SPRINT_A/T-1 без open в запросе → раздел «Задачи» с этой задачей', () => {
    expect(legacyHashHref('', '#SPRINT_A/T-1')).toBe('/?mod=forseti&sec=task&open=SPRINT_A%2FT-1');
  });

  it('якорь, закодированный браузером, тоже понимается', () => {
    expect(legacyHashHref('', '#SPRINT_A%2FT-1')).toBe('/?mod=forseti&sec=task&open=SPRINT_A%2FT-1');
  });

  it('якорь v2 рядом с открытой записью — не трогаем (это место прокрутки, а не ссылка)', () => {
    expect(legacyHashHref('?mod=forseti&sec=task&open=SPRINT_A%2FT-1', '#SPRINT_A/T-1')).toBeNull();
  });

  it('не «спринт/код» — null: параметры в якоре, пустой якорь, одиночный id', () => {
    for (const h of ['', '#', '#open=X&sec=task', '#SPRINT_A', '#a/b/c']) {
      expect(legacyHashHref('', h), h).toBeNull();
    }
  });
});
