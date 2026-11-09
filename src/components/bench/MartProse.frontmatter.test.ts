import { describe, expect, it } from 'vitest';
import { withInit } from './MartProse';

// Прод 09.11, ADR-MINILORE-007: «Parse error on line 1: ---config: layout». Фронтматтер
// диаграммы (правило владелицы 08.11) обязан остаться первым — init встаёт после него.
const FM = '---\nconfig:\n  layout: elk\n---\nflowchart TB\n  A --> B';
const INIT = '%%{init: {"theme":"base"}}%%';

describe('v1 MartProse: init не встаёт перед фронтматтером', () => {
  it('фронтматтер первым, init сразу после', () => {
    const out = withInit(FM, INIT);
    expect(out.startsWith('---\nconfig:\n  layout: elk\n---\n')).toBe(true);
    expect(out).toContain(`---\n${INIT}\nflowchart TB`);
  });
  it('без фронтматтера — init первой строкой, как раньше', () => {
    expect(withInit('sequenceDiagram\n  A->>B: x', INIT)).toBe(`${INIT}\nsequenceDiagram\n  A->>B: x`);
  });
});
