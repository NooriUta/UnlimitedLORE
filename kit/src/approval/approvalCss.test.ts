// K-11: стиль согласования — в едином слое seidr.css, только токены.
// jsdom раскладку не считает, поэтому проверяем правила в файле (с положительным контролем).
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

it('положительный контроль: правило .sk-btn найдено', () => {
  expect(rule('.sk-btn')).toMatch(/min-height:\s*max\(var\(--tap\)/);
});

it('кнопка статуса — цель не меньше --tap и цвет статуса через переменную', () => {
  const body = rule('.sk-appr__btn');
  expect(body).toMatch(/min-height:\s*max\(var\(--tap\)/);
  expect(body).toMatch(/var\(--appr-c/);
});

it('блок sk-appr* без сырых hex и px-шрифтов', () => {
  const start = css.indexOf('/* ---------- K-11');
  expect(start).toBeGreaterThan(0);
  const block = css.slice(start);
  expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(block).not.toMatch(/font-size:\s*\d/);
  expect(rule('.sk-appr__reason')).toMatch(/font-size:\s*var\(--fs-/);
  expect(rule('.sk-appr-log th')).toMatch(/text-transform:\s*uppercase/);
});
