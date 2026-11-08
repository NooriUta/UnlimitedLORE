// @vitest-environment jsdom
// axe-core — один экземпляр на процесс: второй axe.run, пока идёт первый, падает
// «Axe is already running». В CI так и вышло (#869, 07.11): тяжёлый тест списка
// под нагрузкой раннера пережил свой таймаут, его axe-прогон ещё шёл — и уронил
// следующий тест. Хелпер обязан ставить прогоны в очередь, а не гонять их вперемешку.
import { describe, expect, it } from 'vitest';
import { axeViolations } from './axe';

function block(label: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<button type="button">${label}</button>`;
  document.body.appendChild(el);
  return el;
}

describe('axeViolations — прогоны в очередь', () => {
  it('два одновременных вызова оба доходят до результата', async () => {
    const [a, b] = await Promise.all([axeViolations(block('раз')), axeViolations(block('два'))]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });

  it('упавший прогон не запирает очередь для следующих', async () => {
    await expect(axeViolations(null as unknown as Element)).rejects.toBeTruthy();
    expect(await axeViolations(block('после сбоя'))).toEqual([]);
  });
});
