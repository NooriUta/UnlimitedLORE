// SPRINT_UXR_S5_RECORD_TASKS/S5-05 — сторож CSS меры чтения.
//
// Живой замер (web-next/e2e/read-measure.spec.ts, 1280 px) нашёл: ширина строки
// менялась при переключении вкладок паспорта — 449 / 443 / 409 / 406 px. Мера
// `--rec-col` — процент от статьи `.sk-rec`, а статья во весь экран имела
// только `max-width` и сжималась по содержимому вкладки (744 → 679 px).
// e2e в CI не идёт (решение владелицы «тесты локально»), поэтому условие
// закреплено здесь: статья во весь экран обязана занимать всю ширину до предела.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const rule = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('S5-05 · статья во весь экран не сжимается по содержимому вкладки', () => {
  const full = rule(".sk-dock[data-placement='full'] .sk-rec");

  it('положительный контроль: правило статьи во весь экран есть', () => {
    expect(full).toMatch(/max-width:\s*var\(--rec-frame\)/);
  });

  it('ширина статьи задана (100%), а не берётся от содержимого', () => {
    expect(full).toMatch(/(^|;)\s*width:\s*100%/);
  });
});
