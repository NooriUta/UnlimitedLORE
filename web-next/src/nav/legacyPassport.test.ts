// Старые адреса отдельных страниц паспорта → оболочка, запись во весь экран
// («да» владелицы 09.11 на перевод задачи и спринта в оболочку).
import { describe, expect, it } from 'vitest';
import { legacyPassportHref } from './loreRoutes';

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
