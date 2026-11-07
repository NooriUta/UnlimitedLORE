// axe-проверка для рендер-тестов элементов (S4-00b). Контраст в jsdom не
// считается (нет раскладки и вычисленных цветов) — его гейт S4-12 стоит на
// токенах (styles/contrast.test.ts); здесь — роли, имена, ARIA, вложенность интерактива.
import axe from 'axe-core';

export async function axeViolations(root: Element): Promise<string[]> {
  const res = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return res.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(' | ')})`);
}
