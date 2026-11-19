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

  // Ключ репозитория — адрес `https://хост/владелец/имя` (D-2026-MIG-REPOSITORY-ORGANIZATION). Сервер склеивает
  // пустой сегмент `//` в `/` ДО сопоставления пути: `https%3A//git…` доходит как `https:/git…`, не проходит
  // REPO_URL и даёт 400 «id contains illegal characters» (проба ryzenai :9192, 19.11.2026: `https%3A//…` → 400,
  // `https%3A/%2F…` → 200). Правило общее: пустых сегментов в пути быть не должно — второй слэш подряд уходит как %2F.
  it('двойной слэш (адрес репозитория) не оставляет пустого сегмента — второй слэш как %2F', () => {
    const out = recordPath('https://git.seidrstudio.pro/AIDA/MIDGARD');
    expect(out).toBe('https%3A/%2Fgit.seidrstudio.pro/AIDA/MIDGARD');
    expect(out).not.toContain('//');
  });

  it('любая серия слэшей подряд — без пустых сегментов', () => {
    expect(recordPath('a///b')).toBe('a/%2F%2Fb');
    expect(recordPath('SPRINT_X/CO-11')).toBe('SPRINT_X/CO-11');
  });

  it('пустой ключ — пустая строка, а не «undefined» в пути', () => {
    expect(recordPath('')).toBe('');
  });
});
