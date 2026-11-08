// axe-проверка рендер-тестов web-next (S4-01) — та же, что у kit (kit/src/test/axe.ts).
// Контраст в jsdom не считается (нет раскладки и вычисленных цветов) — его
// проверяет браузерный прогон; здесь — роли, имена, ARIA, вложенность интерактива.
import axe from 'axe-core';

export async function axeViolations(root: Element): Promise<string[]> {
  const res = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return res.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(' | ')})`);
}
