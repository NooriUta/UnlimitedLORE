import { describe, expect, it } from 'vitest';
import { TYPE_SECTION, TYPE_LABEL_RU, searchHitHref, searchScreenHref, typeLabel } from './searchRoutes';

// SRCH-08: единая карта маршрутов поиска.
//
// До этого модуля карт было ТРИ, и расходились они по существу: палитра шапки
// вела `decision` в раздел без паспорта, `task` — в список спринтов без
// указания какого, `spec` — через `&spec=` вместо `&passport=`, а экран поиска
// для тех же типов открывал паспорт. Один и тот же результат приводил в разные
// места в зависимости от того, откуда искали, — и не ловилось ничем, потому что
// обе ветки «работали».
//
// Тесты держат не конкретные ссылки, а инварианты: карты полны, каждый тип
// ведёт в паспорт, а неизвестный не проваливается в тупик.

describe('карта маршрутов поиска', () => {
  it('у каждого типа есть и раздел, и подпись — иначе хит покажется сырым кодом', () => {
    for (const type of Object.keys(TYPE_SECTION)) {
      expect(TYPE_LABEL_RU[type], `нет подписи у типа ${type}`).toBeTruthy();
    }
    for (const type of Object.keys(TYPE_LABEL_RU)) {
      expect(TYPE_SECTION[type], `нет раздела у типа ${type}`).toBeTruthy();
    }
  });

  it('ссылка ведёт в ПАСПОРТ, а не в общий список раздела', () => {
    // Именно этим палитра и грешила: «раздел тот» при том, что сущность
    // приходилось искать глазами.
    for (const type of Object.keys(TYPE_SECTION)) {
      const href = searchHitHref(type, 'X-1');
      expect(href, type).toContain('passport=');
      expect(href, type).toContain(`section=${TYPE_SECTION[type]}`);
    }
  });

  it('у задачи паспорт — её спринт: своей глубокой ссылки у неё нет', () => {
    expect(searchHitHref('task', 'SPRINT_X/T05'))
      .toBe('/lore?section=sprints&passport=SPRINT_X');
  });

  it('идентификатор экранируется — иначе слэши и кириллица ломают URL', () => {
    expect(searchHitHref('adr', 'ADR/LORE 022')).toContain('ADR%2FLORE%20022');
  });

  /**
   * Неизвестный тип не должен вести на план-борд: он не входит в разделы с
   * фильтром, параметр запроса там никем не читается — переход выглядел как
   * «поиск ничего не сделал».
   */
  it('неизвестный тип ведёт в спринты, а не в тупик', () => {
    const href = searchHitHref('нечто-новое', 'X-1');
    expect(href).toContain('section=sprints');
    expect(href).not.toContain('section=plan');
  });

  it('Enter без выбранной строки ведёт на экран поиска с запросом', () => {
    expect(searchScreenHref('остервальдер'))
      .toBe(`/lore?section=search&q=${encodeURIComponent('остервальдер')}`);
    // Пустой запрос — просто экран поиска, без болтающегося пустого параметра.
    expect(searchScreenHref('   ')).toBe('/lore?section=search');
  });

  it('подпись неизвестного типа — сам тип, а не пустота', () => {
    expect(typeLabel('use_case')).toBe('US');
    expect(typeLabel('нечто-новое')).toBe('нечто-новое');
  });

  /**
   * `feature` остаётся в карте, хотя после PL-28 поиск такого типа больше не
   * отдаёт: старые ссылки и закладки — отдают, и вести их в никуда было бы
   * регрессом на ровном месте.
   */
  it('устаревший тип feature всё ещё ведёт в свой раздел', () => {
    expect(searchHitHref('feature', 'FEAT-GITCYCLE'))
      .toBe('/lore?section=features&passport=FEAT-GITCYCLE');
  });
});
