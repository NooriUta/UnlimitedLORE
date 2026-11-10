// SPRINT_UXR_S5_RECORD_TASKS/S5-11: стиль вкладки «История» — в едином слое
// seidr.css, только токены, цели касания ≥44px на сенсоре (через --tap).
// jsdom раскладку не считает — проверяем правила в файле, с положительным контролем.
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

it('положительный контроль: правило .sk-btn найдено и держит --tap', () => {
  expect(rule('.sk-btn')).toMatch(/min-height:\s*max\(var\(--tap\)/);
});

it('выбор версии и «сравнить с» — цели не меньше --tap', () => {
  expect(rule('.sk-rec-history__pick')).toMatch(/min-height:\s*max\(var\(--tap\)/);
  expect(rule('.sk-rec-history__select')).toMatch(/min-height:\s*max\(var\(--tap\)/);
});

it('блок sk-rec-history* без сырых hex и px-шрифтов; агент — тоном --inf', () => {
  const start = css.indexOf('/* ---------- S5-11');
  expect(start).toBeGreaterThan(0);
  const end = css.indexOf('/* ═══', start);
  const block = css.slice(start, end > start ? end : undefined);
  expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(block).not.toMatch(/font-size:\s*\d/);
  expect(rule(".sk-rec-history__author[data-kind='agent']")).toMatch(/var\(--inf\)/);
  expect(rule('.sk-rec-history__cmp')).toMatch(/text-transform:\s*uppercase/);
});

it('S9-09: фильтры, переключатель свёртки и разворот серии — цели не меньше --tap, серия тоном --inf', () => {
  expect(rule('.sk-rec-history__toggle')).toMatch(/min-height:\s*max\(var\(--tap\)/);
  expect(rule('.sk-rec-history__runmore')).toMatch(/min-height:\s*max\(var\(--tap\)/);
  expect(rule('.sk-rec-history__runpill')).toMatch(/var\(--inf\)/);
  expect(rule('.sk-rec-history__filters')).toMatch(/flex-wrap:\s*wrap/);
});
