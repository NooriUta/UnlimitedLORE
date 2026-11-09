import { describe, expect, it } from 'vitest';
import { withInit } from './MartProse';

// Владелица 09.11.2026: «начал ломаться рендеринг mermaid диаграмм … а тестов у вас на него видимо нет».
// Прод, ADR-MINILORE-007: «Parse error on line 1: ---config: layout». Правило владелицы 08.11 — каждая
// диаграмма с фронтматтером `---\nconfig:\n  layout: elk\n---`, а MartProse ставил строку %%{init}%%
// ПЕРЕД ним: mermaid узнаёт фронтматтер только в самом начале текста, иначе читает его как граф.
const FM = '---\nconfig:\n  layout: elk\n---\nflowchart TB\n  A["запрос"] --> B["ответ"]';
const INIT = '%%{init: {"theme":"base"}}%%';

describe('MartProse: строка init не встаёт перед фронтматтером', () => {
  it('фронтматтер остаётся первым, init — сразу после него', () => {
    const out = withInit(FM, INIT);
    expect(out.startsWith('---\nconfig:\n  layout: elk\n---\n')).toBe(true);
    expect(out).toContain(`---\n${INIT}\nflowchart TB`);
  });

  it('без фронтматтера init идёт первой строкой, как раньше', () => {
    expect(withInit('erDiagram\n  A ||--o{ B : has', INIT)).toBe(`${INIT}\nerDiagram\n  A ||--o{ B : has`);
  });

  it('фронтматтер с CRLF и отступом перед ним тоже остаётся первым', () => {
    const out = withInit('\n---\r\nconfig:\r\n  layout: elk\r\n---\r\nflowchart TB\r\n  A --> B', INIT);
    expect(out.startsWith('---')).toBe(true);
    expect(out.indexOf(INIT)).toBeGreaterThan(out.indexOf('layout: elk'));
  });
});
