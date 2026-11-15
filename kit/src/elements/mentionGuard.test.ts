// Сторож K4-MENTION-LOOK (SPRINT_UXR_S13_KIT4): ссылка на чужую запись рисуется
// ТОЛЬКО через ObjectMention — тогда у каждого упоминания значок и цвет его вида.
//
// Как держит: ищет в kit/src (без тестов) голые <a> со ссылкой на запись
// (`href={ctx.href(…)}` / `href={href(…)}`). Каждое такое место — либо в эталоне
// ниже с причиной (это САМА запись в своём списке, а не упоминание чужой), либо
// красный. Эталон храповиком: место ушло из файла — убери строку, иначе красный.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Файл → сколько голых ссылок на запись разрешено и почему. */
const ALLOWED: Record<string, { n: number; why: string }> = {
  'list/ListView.tsx': { n: 2, why: 'название и код САМОЙ записи в строке списка — не упоминание чужой' },
  'record/KindBlock.tsx': { n: 1, why: 'название записи-строки вложенного блока — сама запись' },
  'record/RecordGraph.tsx': { n: 1, why: 'узел SVG эго-графа: цвет — сектором ребра, это узел, а не упоминание в тексте' },
  'views/calendar/CalendarMonth.tsx': { n: 1, why: 'запись в своей ячейке календаря' },
  'views/library/LibraryView.tsx': { n: 1, why: 'кнопка «Открыть» у документа библиотеки' },
  'views/timeline/TimelineLanes.tsx': { n: 2, why: 'подпись полосы записи на таймлайне' },
  'views/tree/TreeView.tsx': { n: 1, why: 'название узла дерева — сама запись' },
};

const RAW = /<a\b[^>]*href=\{(?:ctx\.)?href\(/g;

function scan(): Record<string, number> {
  const root = join(process.cwd(), 'src');
  const out: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'test') walk(p); continue; }
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      const n = (readFileSync(p, 'utf8').match(RAW) ?? []).length;
      if (n) out[relative(root, p).split(sep).join('/')] = n;
    }
  };
  walk(root);
  return out;
}

describe('сторож: упоминание записи — только через ObjectMention', () => {
  const found = scan();
  it('положительный контроль: сканер видит голые ссылки (эталон не пуст)', () => {
    expect(Object.keys(found).length).toBeGreaterThan(0);
  });
  it('нет голой ссылки на запись вне эталона', () => {
    const leaks = Object.entries(found).filter(([f, n]) => n > (ALLOWED[f]?.n ?? 0)).map(([f, n]) => `${f}: ${n}`);
    expect(leaks, 'нарисуйте упоминание через ObjectMention').toEqual([]);
  });
  it('эталон сжимается вместе с кодом', () => {
    const stale = Object.entries(ALLOWED).filter(([f, a]) => (found[f] ?? 0) < a.n).map(([f]) => f);
    expect(stale, 'уберите строку эталона').toEqual([]);
  });
  it('места упоминаний зовут ObjectMention', () => {
    for (const f of ['record/fmt.tsx', 'record/RecordLinks.tsx', 'record/RecordPeek.tsx', 'record/RelationField.tsx', 'record/ValueChips.tsx', 'record/RecordGraph.tsx', 'list/ListView.tsx']) {
      expect(readFileSync(join(process.cwd(), 'src', f), 'utf8'), f).toMatch(/<ObjectMention\b/);
    }
  });
});
