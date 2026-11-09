// Ключ записи в пути запроса: слэш живой, решётка кодируется
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS, паспорта типов 09.11).
//
// Повод настоящий и найден замером, а не воображением: ключ релиза —
// `release_uid` вида `NooriUta/UnlimitedLORE#v1.17.4` (живая выдача среза
// `releases`, 455 записей). В нём ДВА слэша и решётка одновременно.
//
// Два факта, оба по коду, и они тянут в разные стороны:
//   1. слэш кодировать НЕЛЬЗЯ — шаблон пути фасада `{type}/{id: .+}` жадный, и
//      именно поэтому паспорт задачи с ключом «спринт/код» работает сегодня;
//   2. решётку кодировать НАДО — браузер режет «#» как якорь и хвост не
//      отправляет, то есть сервер получит валидный путь ДРУГОЙ записи.
//
// Второе и есть худший исход: не ошибка, а тихая подмена записи. Поэтому тест
// проверяет обе стороны, а не одну.
import { describe, expect, it } from 'vitest';
import { recordPath } from '../api/liveRecord';

describe('recordPath: ключ записи в пути', () => {
  it('положительный контроль: обычный ключ не меняется', () => {
    expect(recordPath('ADR-LORE-049')).toBe('ADR-LORE-049');
    expect(recordPath('S4-09')).toBe('S4-09');
  });

  it('слэш остаётся живым — на нём держится паспорт задачи', () => {
    expect(recordPath('SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09')).toBe('SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09');
  });

  it('решётка уходит как %23 — иначе браузер отрежет хвост', () => {
    expect(recordPath('NooriUta/UnlimitedLORE#v1.17.4')).toBe('NooriUta/UnlimitedLORE%23v1.17.4');
  });

  it('слэш и решётка вместе: закодирована только решётка', () => {
    const out = recordPath('AIDA/miniLore_serverside#v0.3.128');
    expect(out).toBe('AIDA/miniLore_serverside%23v0.3.128');
    // Слэшей столько же, сколько было: ни один не превратился в %2F.
    expect(out.split('/')).toHaveLength(2);
    expect(out).not.toContain('%2F');
  });

  it('пробел и вопросительный знак тоже кодируются — они ломают запрос', () => {
    expect(recordPath('A B')).toBe('A%20B');
    expect(recordPath('A?b')).toBe('A%3Fb');
  });

  it('пустой ключ — пустая строка, а не «undefined» в пути', () => {
    expect(recordPath('')).toBe('');
  });
});
