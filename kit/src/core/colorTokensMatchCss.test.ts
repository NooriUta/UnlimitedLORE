// Сторож: белый список цветов валидатора не расходится с темой
// (находка 09.11 по вопросу владелицы).
//
// **Повод.** Приложение добавило статус `ready_for_deploy` — обычный статус
// LORE, у которого в теме kit ДАВНО есть свой токен `--st-ready_for_deploy`
// (строки 62 и 205 `seidr.css`). Валидатор ядра отказал: «цвет только токеном
// из acc, suc, …, st-todo», и `st-ready_for_deploy` в этом списке не было.
//
// То есть kit держал список статусов в ДВУХ местах — в теме и в валидаторе, —
// и они разошлись. Снаружи это выглядело так: приложение не может пользоваться
// цветом, который kit для него же и завёл.
//
// Вопрос владелицы 09.11 был ровно об этом: «зачем тебе словарь статусов на
// своей стороне, если это задача уже конкретного приложения». Сторож не
// отвечает на вопрос целиком (разделение словарей — SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG),
// но закрывает его худшее следствие: расхождение двух списков внутри kit
// больше не пройдёт молча.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KIT_COLOR_TOKENS } from './validate';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
// Третье место, где kit держит тот же список: JSON-схема конфига. Расхождение
// нашлось ровно так — тема знала токен, валидатор нет, схема тоже нет.
const schema = readFileSync(`${process.cwd()}/src/core/schema/kit-config.schema.json`, 'utf8');

/** Токены статусов, объявленные темой: `--st-<код>`. */
function statusTokensInCss(): string[] {
  const found = new Set<string>();
  for (const m of css.matchAll(/--(st-[a-z_]+)\s*:/g)) found.add(m[1]);
  // `--st-c` — служебная переменная чипа, а не статус; в белый список цветов
  // конфига она не входит и входить не должна.
  found.delete('st-c');
  return [...found].sort();
}

const whitelisted = () => KIT_COLOR_TOKENS.filter(t => t.startsWith('st-')).slice().sort();

describe('сторож: цвета статусов в валидаторе и в теме — один список', () => {
  it('положительный контроль: тема и список вообще прочитаны', () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(statusTokensInCss().length).toBeGreaterThan(5);
    expect(whitelisted().length).toBeGreaterThan(5);
  });

  it('каждый статусный токен темы разрешён валидатором', () => {
    const missing = statusTokensInCss().filter(t => !(whitelisted() as string[]).includes(t));
    expect(missing, `тема объявляет токен, а валидатор его не принимает: ${missing.join(', ')}`).toEqual([]);
  });

  it('валидатор не разрешает того, чего в теме нет', () => {
    const extra = whitelisted().filter(t => !statusTokensInCss().includes(t));
    expect(extra, `валидатор принимает токен, которого тема не объявляет: ${extra.join(', ')}`).toEqual([]);
  });
});

// Список живёт в ТРЁХ местах, и это и есть суть замечания владелицы 09.11:
// «зачем тебе словарь статусов на своей стороне, если это задача конкретного
// приложения… так же как и палитра». Пока список внутри kit, его надо хотя бы
// держать одним — поэтому схема сверяется с валидатором так же, как тема.
describe('сторож: схема конфига знает те же цвета, что валидатор', () => {
  it('положительный контроль: схема прочитана и содержит перечень', () => {
    expect(schema).toContain('st-done');
  });

  it('каждый статусный токен валидатора есть в схеме', () => {
    const missing = KIT_COLOR_TOKENS
      .filter(t => t.startsWith('st-'))
      .filter(t => !schema.includes(t));
    expect(missing, `валидатор принимает токен, схема — нет: ${missing.join(', ')}`).toEqual([]);
  });
});
