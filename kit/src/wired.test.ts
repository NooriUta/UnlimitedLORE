// Сторож: возможность, написанная как модель, обязана быть вызвана из
// компонента (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35, урок 09.11).
//
// Повод — два случая в один день. Выбор колонок (`ColumnsChoice`) и личные
// ширины (`readWidths`/`writeWidths`/`widthsFor`) были написаны, покрыты
// тестами и НИ ОТКУДА не вызывались: ни один `.tsx` их не упоминал. Задача
// S4-35 стояла «ready_for_deploy», а в интерфейсе ни выбрать колонки, ни
// потянуть ширину было нельзя. Тем же оказалась вкладка «История» (S5-11):
// компонент есть, `RecordView.history` не передавал никто.
//
// Почему обычные тесты это не ловят: они проверяют РАСЧЁТ, а не то, что
// расчётом кто-то пользуется. И выглядит такое хуже, чем «не сделано»: по
// задаче всё закрыто, снаружи — отсутствие возможности.
//
// Поэтому список ниже — явный, а не «все экспорты»: автоматический обход дал
// бы шум из типов и утилит, а здесь перечислено то, что ОБЯЗАНО доходить до
// человека. Добавляя сюда имя, вы обещаете, что возможность подключена; если
// она подключается не в kit, а в приложении, место подключения называется в
// `appOnly` с причиной.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = `${process.cwd()}/src`;

/** Все .tsx компонентов kit, кроме тестов и витрин. */
function componentFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'test') continue;
      componentFiles(p, out);
      continue;
    }
    if (!name.endsWith('.tsx')) continue;
    if (name.includes('.test.') || name.endsWith('.test-helper.ts')) continue;
    out.push(p);
  }
  return out;
}

const files = componentFiles();
const code = files.map(f => ({ f, text: readFileSync(f, 'utf8') }));

/** Где имя встречается, кроме файла, который его объявляет. */
function callers(symbol: string, declaredIn: string): string[] {
  return code
    .filter(({ f, text }) => !f.endsWith(declaredIn) && new RegExp(`\\b${symbol}\\b`).test(text))
    .map(({ f }) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
}

/** Возможность: имя, файл-объявление и зачем она нужна человеку. */
const MUST_BE_WIRED: readonly { symbol: string; declaredIn: string; why: string }[] = [
  { symbol: 'ColumnsChoice', declaredIn: 'list/ColumnsChoice.tsx', why: 'выбор колонок в списке и в таблице задач (S4-35)' },
  { symbol: 'readWidths', declaredIn: 'list/columnWidths.ts', why: 'личная ширина колонок читается при открытии списка (S4-35)' },
  { symbol: 'writeWidths', declaredIn: 'list/columnWidths.ts', why: 'ширина запоминается после перетаскивания (S4-35)' },
  { symbol: 'widthsFor', declaredIn: 'list/columnWidths.ts', why: 'ширины применяются к таблице и не применяются на телефоне (S4-35)' },
  { symbol: 'columnsFromUrl', declaredIn: 'list/columnsUrl.ts', why: 'набор колонок приходит из адреса — им делятся ссылкой (S4-35)' },
  { symbol: 'RecordHistory', declaredIn: 'record/RecordHistory.tsx', why: 'вкладка «История» записи (S5-11)' },
  { symbol: 'RelationTable', declaredIn: 'record/RelationTable.tsx', why: 'связи таблицей с общими колонками (S4-37)' },
  { symbol: 'DataStateBlock', declaredIn: 'record/DataStateBlock.tsx', why: 'блок «что проверено / что не смогли» (S4-30)' },
  { symbol: 'navClick', declaredIn: 'core/navClick.ts', why: 'пункты меню и крошки — ссылки, а не кнопки (S4-28, S4-MENU-STATES)' },
  { symbol: 'urlStateHref', declaredIn: 'resilience/urlState.ts', why: 'у ссылки есть адрес до перехода (S4-28)' },
];

describe('сторож: написанное дошло до человека', () => {
  it('положительный контроль: компоненты kit найдены и прочитаны', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(code.every(({ text }) => text.length > 0)).toBe(true);
  });

  it.each(MUST_BE_WIRED)('$symbol вызывается из компонента — $why', ({ symbol, declaredIn }) => {
    const used = callers(symbol, declaredIn);
    expect(used, `${symbol} (${declaredIn}) не вызывается ни из одного компонента kit: возможность есть в коде и недоступна человеку`).not.toEqual([]);
  });

  it('сторож проверяет имя, а не тип: переименование объявления его не обманет', () => {
    // Если файл-объявление переехал, callers() начнёт считать и его сам файл,
    // и сторож станет ложно-зелёным. Поэтому проверяем, что каждый declaredIn
    // действительно существует среди исходников.
    for (const { symbol, declaredIn } of MUST_BE_WIRED) {
      const exists = (() => {
        try {
          return statSync(join(SRC, declaredIn)).isFile();
        } catch {
          return false;
        }
      })();
      expect(exists, `${symbol}: файл ${declaredIn} не найден — поправьте путь в списке`).toBe(true);
    }
  });
});
