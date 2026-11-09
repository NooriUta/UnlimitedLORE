// Сторож приложения: написанное дошло до экрана
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35, S4-05 — урок 09.11).
//
// Двойник `kit/src/wired.test.ts`, но для v2. Повод тот же и свежий: весь
// `lists/loreFilters.ts` — иконки значений фасетов из прототипа v4 и
// наследование релиза задачи от спринта — был написан, покрыт тестами и НЕ
// вызывался ни одним экраном. `valueIcon` в `ListView` не передавался вовсе,
// поэтому иконок человек не видел, а имена фасетов жили в двух местах и
// молча разошлись.
//
// Почему обычные тесты это не ловят: они проверяют РАСЧЁТ, а не то, что
// расчётом кто-то пользуется. И выглядит такое хуже, чем «не сделано»: по
// задаче всё закрыто, снаружи — отсутствие возможности.
//
// Список явный, а не «все экспорты»: автоматический обход дал бы шум из типов
// и утилит. Добавляя сюда имя, вы обещаете, что возможность подключена.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = `${process.cwd()}/src`;

/** Исходники приложения, кроме тестов. */
function appFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'test' || name === 'i18n') continue;
      appFiles(p, out);
      continue;
    }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
    if (name.includes('.test.')) continue;
    out.push(p);
  }
  return out;
}

const files = appFiles();
const code = files.map(f => ({ f, text: readFileSync(f, 'utf8') }));

/** Где имя встречается, кроме файла, который его объявляет. */
function callers(symbol: string, declaredIn: string): string[] {
  return code
    .filter(({ f, text }) => !f.endsWith(declaredIn) && new RegExp(`\\b${symbol}\\b`).test(text))
    .map(({ f }) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
}

/** Возможность: имя, файл-объявление и зачем она нужна человеку. */
const MUST_BE_WIRED: readonly { symbol: string; declaredIn: string; why: string }[] = [
  { symbol: 'loreValueIcon', declaredIn: 'lists/loreFilters.ts', why: 'иконки значений фасетов и ячеек — релиз, компонент, проект, приоритет (S4-25)' },
  { symbol: 'LORE_FILTER_FIELDS', declaredIn: 'lists/loreFilters.ts', why: 'имена фасетов — один набор на экраны и на иконки (S4-05)' },
  { symbol: 'loadRecordContract', declaredIn: 'record/recordSource.ts', why: 'паспорт берётся с боевого фасада, а не эмулируется (S4-MODEL-PASSPORT-LIST)' },
  { symbol: 'saveRelation', declaredIn: 'record/relationSave.ts', why: 'связи записи привязываются и отвязываются (S4-MODEL-PASSPORT-LIST)' },
  { symbol: 'draftSlot', declaredIn: 'api/drafts.ts', why: '«Восстановить черновик от ЧЧ:ММ» у MD-поля (S5-09)' },
  { symbol: 'fetchHistory', declaredIn: 'record/historySource.ts', why: 'вкладка «История» записи (S5-11)' },
  { symbol: 'createLiveS2Client', declaredIn: 'api/liveS2.ts', why: 'личные настройки, виды и память — с сервера, а не из браузера (S5-14)' },
  { symbol: 'shellRecentList', declaredIn: 'palette/shellRecent.ts', why: '«Недавнее» палитры — тот же список, что в меню (S4-14)' },
  { symbol: 'loadSprintTotals', declaredIn: 'sprints/sprintTotals.ts', why: 'итоги спринта в списке: задач x/y, оценка Σ дн, факт Σ дн (S4-09)' },
];

describe('сторож приложения: написанное дошло до экрана', () => {
  it('положительный контроль: исходники v2 найдены и прочитаны', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(code.every(({ text }) => text.length > 0)).toBe(true);
  });

  it.each(MUST_BE_WIRED)('$symbol вызывается из приложения — $why', ({ symbol, declaredIn }) => {
    const used = callers(symbol, declaredIn);
    expect(used, `${symbol} (${declaredIn}) не вызывается ниоткуда: возможность есть в коде и недоступна человеку`).not.toEqual([]);
  });

  it('пути объявлений существуют — иначе сторож станет ложно-зелёным', () => {
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
