// axe-проверка для рендер-тестов элементов (S4-00b). Контраст в jsdom не
// считается (нет раскладки и вычисленных цветов) — его гейт S4-12 стоит на
// токенах (styles/contrast.test.ts); здесь — роли, имена, ARIA, вложенность интерактива.
import axe from 'axe-core';

// axe-core — один экземпляр на процесс: второй axe.run во время первого падает
// «Axe is already running». Прогон, переживший таймаут своего теста (тяжёлый
// список под нагрузкой CI), ронял СЛЕДУЮЩИЙ тест (#869, 07.11). Поэтому все
// прогоны идут цепочкой; сбой одного звена цепь не рвёт (catch ниже).
let queue: Promise<unknown> = Promise.resolve();

export function axeViolations(root: Element): Promise<string[]> {
  const run = queue
    .then(() => axe.run(root, { rules: { 'color-contrast': { enabled: false } } }))
    .then(res => res.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(' | ')})`));
  queue = run.catch(() => undefined);
  return run;
}
