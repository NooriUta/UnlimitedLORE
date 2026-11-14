// Кнопки kit без «родной» обвязки браузера (приёмка 14.11.2026, владелица: «дропдаун меню
// перекрашено в нормальный цвет у паспортов»). Меню «Ещё» вкладок паспорта рисовалось серыми
// кнопками user-agent (border: outset, серый фон): у .sk-tabs__more-item не было сброса рамки и
// фона, который есть у соседнего .sk-place__opt. Частный случай обобщён до правила: любая кнопка
// с классом kit начинает с нулевой рамки и прозрачного фона — забытый сброс в новом классе больше
// не показывает серую кнопку. Сброс с нулевой специфичностью (:where), поэтому любое правило класса
// (.sk-btn, .sk-tab, …) его перекрывает.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');

function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `правила ${selector} в seidr.css нет`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}

describe('кнопки kit без обвязки браузера', () => {
  it('базовый сброс: нулевая рамка, прозрачный фон, без appearance', () => {
    const body = rule(':where(button[class*="sk-"])');
    expect(body).toContain('border: 0');
    expect(body).toContain('background: none');
    expect(body).toContain('appearance: none');
  });

  it('сброс не перебивает правила классов — нулевая специфичность', () => {
    expect(css).not.toMatch(/(^|\n)button\[class\*="sk-"\]\s*\{/);
  });

  it('пункт «Ещё» паспорта — фон и рамка kit, а не браузера', () => {
    const body = rule('.sk-tabs__more-item');
    expect(body).toContain('border: 0');
    expect(body).toContain('background: none');
  });
});
