// Оговорки раздела читаются целиком и на телефоне (B4 ревью 10.11.2026).
//
// Находка ревью: баннер «показаны открытые задачи…» на 412 px обрезан у края.
// Текст сюда приходит ИЗ ДАННЫХ — имена срезов, коды записей, сообщения
// сервера, — то есть строки без пробелов и без предела длины. Без переноса по
// любому месту такая строка уезжает за правый край, и половину оговорки никто
// не прочитает; а оговорка написана ровно для того, чтобы её прочитали.
//
// Второе: это `<ul>`, и браузер рисовал диски-маркеры — под них и держался
// левый отступ. Маркеры тут лишние, каждая строка и так в рамке.
//
// Почему тест читает CSS, а не браузер: Playwright у нас локальный (решение
// владелицы «тесты локально»), в CI его нет. Правило это держится одной
// строкой, и сторож должен ловить её пропажу в CI.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/pages/ListScreen.css'), 'utf8');

/** Тело правила по селектору (первое вхождение). */
function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `правила ${selector} в ListScreen.css нет — поправьте сторож`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}

describe('B4 · оговорки раздела не обрезаются краем', () => {
  it('положительный контроль: файл прочитан и правило найдено', () => {
    expect(css.length).toBeGreaterThan(200);
    expect(rule('.list-screen__warn')).toContain('border');
  });

  it('длинная строка без пробелов переносится, а не уезжает за край', () => {
    const body = rule('.list-screen__warn');
    expect(body, 'без overflow-wrap длинный id не переносится').toMatch(/overflow-wrap:\s*anywhere/);
    expect(body).toMatch(/word-break:\s*break-word/);
  });

  it('маркеров списка нет: каждая оговорка и так в рамке', () => {
    expect(rule('.list-screen__warn')).toMatch(/list-style:\s*none/);
  });

  it('и сам блок не распирает полосу: min-width: 0 (урок S9-12)', () => {
    expect(rule('.list-screen__warn')).toMatch(/min-width:\s*0/);
  });
});
