// SPRINT_UXR_S5_RECORD_TASKS/S5-01 · липкие вкладки и строка-вердикт — стиль в
// едином слое seidr.css, только токены. jsdom раскладку не считает, поэтому
// проверяем правила в файле (с положительным контролем).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('S5-01 · липкие вкладки', () => {
  it('положительный контроль: правило .sk-rec-head найдено', () => {
    expect(rule('.sk-rec-head')).toMatch(/display:\s*flex/);
  });

  it('полоса вкладок записи — position: sticky, фон токеном, поверх тела', () => {
    const body = rule('.sk-rec__tabs > .sk-tabs');
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*var\(--rec-sticky-top/);
    expect(body).toMatch(/background:\s*var\(--/);
    expect(body).toMatch(/z-index:/);
  });

  it('кнопка «задачи» — цель не меньше --tap; блок без сырых hex и px-шрифтов', () => {
    expect(rule('.sk-rec-facts__btn')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    const start = css.indexOf('/* ---------- S5-01');
    expect(start).toBeGreaterThan(0);
    const end = css.indexOf('/* ---------- ', start + 10);
    const block = css.slice(start, end > 0 ? end : undefined);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/font-size:\s*\d/);
  });
});
