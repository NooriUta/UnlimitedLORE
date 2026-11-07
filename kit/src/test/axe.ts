// axe-проверка для рендер-тестов элементов (S4-00b). Контраст в jsdom не
// считается (нет раскладки и вычисленных цветов) — его проверяет S4-12 в
// браузере; здесь — роли, имена, ARIA-атрибуты, вложенность интерактива.
import axe from 'axe-core';

export async function axeViolations(root: Element): Promise<string[]> {
  const res = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return res.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(' | ')})`);
}
