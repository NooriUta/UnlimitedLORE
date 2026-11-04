import { describe, it, expect } from 'vitest';

/**
 * STYLE-01: шкала `--fs-*` обходилась числом в сотнях мест.
 *
 * Тест инвертированный — читает ИСХОДНИКИ и ищет числовые размеры, совпадающие
 * со ступенью шкалы. Такое число не «почти токен», а его копия: правка ступени
 * в tokens.css оставила бы копии на месте, и шкала перестала бы быть единой
 * точкой правки, продолжая выглядеть ею.
 *
 * Размеры ВНЕ шкалы (9.5, 22, 48 — микро-подписи и KPI-цифры) не запрещаем:
 * это осознанные исключения, и запрет вынудил бы плодить ступени под каждый
 * единичный случай.
 */
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Ступени шкалы из tokens.css — числа, которые обязаны писаться токеном. */
const SCALE = [9, 10, 11, 12, 13, 14, 20, 24];

/**
 * Monaco и другие НЕ-CSS потребители принимают число по своему контракту:
 * это опция редактора, а не стиль DOM-узла, и токен туда не подставить.
 */
const EXEMPT = ['/components/tyr/components/TestEditor.tsx'];

describe('STYLE-01 · шкала размеров', () => {
  it('ступень шкалы не пишется числом', () => {
    const re = new RegExp(`fontSize: (${SCALE.join('|')})(?=[,\\s}])`, 'g');
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (EXEMPT.some(e => path.includes(e))) continue;
      const found = src.match(re);
      if (found) offenders.push(`${path}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders, 'используйте var(--fs-*) — иначе правка шкалы не дойдёт до этих мест').toEqual([]);
  });

  // SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-10: ниже нижней ступени шкалы (9) текст не
  // читается — 7 и 8 стояли в аналитике и шевроне компонентов. Шкала не
  // запрещала их: она ловила только СВОИ ступени, а 7/8 в неё не входят.
  it('размер шрифта меньше нижней ступени (9) не пишется вовсе', () => {
    const re = /fontSize: ([0-8](?:\.\d+)?)(?=[,\s}])/g;
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (EXEMPT.some(e => path.includes(e))) continue;
      const found = src.match(re);
      if (found) offenders.push(`${path}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders, 'меньше var(--fs-2xs) не читается — поднимите до токена').toEqual([]);
  });

  // AH-10: `${color}55` при color='var(--acc)' даёт невалидное `var(--acc)55` —
  // браузер молча выбрасывает всё свойство (у чипов BRAGI-плана пропали рамка и
  // фон). Hex-альфа к переменной не приклеивается; прозрачность — color-mix.
  it('к цветовой переменной не приклеивают hex-альфу (`${x}55`)', () => {
    const re = /\$\{[A-Za-z_.?]*[cC]olou?r[A-Za-z_]*\}[0-9a-fA-F]{2}\b/g;
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      const found = src.match(re);
      if (found) offenders.push(`${path}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders, 'используйте color-mix(in srgb, ${color} N%, transparent)').toEqual([]);
  });

  it('сам тест видит исходники — иначе он «зелёный» ни на чём', () => {
    // Без этой проверки сломавшийся glob дал бы пустой набор файлов, и страж
    // молча перестал бы что-либо стеречь, оставаясь зелёным.
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });
});
