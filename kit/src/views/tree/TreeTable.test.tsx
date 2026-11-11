// @vitest-environment jsdom
// Иерархия — деревом с ОДИНАКОВЫМИ столбцами на всех уровнях
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED, развитие K-09).
//
// Контракт владелицы: «исключение — иерархия. Её рисуют деревом с одинаковыми
// столбцами на всех уровнях. У нас это уровень 1 → уровень 2 → уровень 3.
// Среднего уровня может не быть: тогда третий встаёт на уровень 2. Записи
// третьего уровня, у которых среднего нет, хотя у соседей он есть, идут
// отдельной группой на уровне 2».
//
// Тесты держат ПРАВИЛА, не случаи:
//   • столбцы ОДНИ: один заголовок, и у строки любого уровня ячеек ровно
//     столько, сколько столбцов. Разъехавшаяся по уровням таблица — не
//     «однородная», как её ни назови;
//   • `optional` уровень, которого нет, не меняет РАЗМЕТКУ: глубже лежащие
//     записи поднимаются на его место;
//   • «уровня нет» ≠ «нет прав» ≠ «сбой» ≠ «обрезано» ≠ «пусто» — пять разных
//     утверждений и пять разных формулировок. Проверяется попарно: совпали
//     тексты — правило нарушено, даже если каждый по отдельности читается;
//   • родитель назван, но не выдан — запись не всплывает молча в корень.
//
// Предметных имён LORE здесь нет (K-14): уровни приходят ДАННЫМИ, и в тестах
// это чужое приложение — курс → модуль → урок.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx } from '../../core/contract';
import { KitLangProvider } from '../../i18n';
import { definedClasses, usedClasses } from '../../test/cssClasses';
import { TreeTable, treeTableLines, type TreeFlatRow, type TreeLevel, type TreeLevelState } from './TreeTable';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const config: KitConfig = {
  modules: [],
  menu: { groups: [] },
  kinds: {
    course: { title: 'Курс', icon: 'book-cover' },
    unit: { title: 'Модуль', icon: 'stone-block' },
    lesson: { title: 'Урок', icon: 'quill-ink', fields: [{ key: 'mins', title: 'Минут', type: 'number' }] },
  },
  statuses: {
    items: [
      { code: 'open', title: 'Идёт', category: 'in_progress', icon: 'play-button', color: 'var(--acc)' },
      { code: 'done', title: 'Пройден', category: 'finished', icon: 'check-mark', color: 'var(--suc)' },
    ],
  },
  roles: { reader: { canEdit: false, canStatus: false }, teacher: { canEdit: true, canStatus: true } },
};

const LEVELS: TreeLevel[] = [{ kind: 'course' }, { kind: 'unit', optional: true }, { kind: 'lesson' }];
const COLUMNS = ['status', 'id', 'title', 'fields.mins'];

function ctxOf(role = 'reader'): KitCtx {
  return {
    config,
    role,
    data: { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-10T00:00:00Z' } },
    href: id => `?open=${id}`,
    esc: s => s,
    md: s => s,
  };
}

/** Полный случай: курс → два модуля → по уроку, и один урок прямо под курсом. */
const FULL: TreeFlatRow[] = [
  { key: 'C-1', kind: 'course', parent: null, title: 'Руны', status: 'open' },
  { key: 'U-1', kind: 'unit', parent: 'C-1', title: 'Футарк', status: 'open' },
  { key: 'L-1', kind: 'lesson', parent: 'U-1', title: 'Феху', status: 'done', mins: 20 },
  { key: 'U-2', kind: 'unit', parent: 'C-1', title: 'Гальдр', status: 'open' },
  { key: 'L-2', kind: 'lesson', parent: 'U-2', title: 'Уруз', status: 'open', mins: 30 },
  { key: 'L-9', kind: 'lesson', parent: 'C-1', title: 'Вводный', status: 'open', mins: 10 },
];

/** Среднего уровня нет вовсе: уроки сразу под курсом. */
const NO_MIDDLE: TreeFlatRow[] = [
  { key: 'C-1', kind: 'course', parent: null, title: 'Руны', status: 'open' },
  { key: 'L-1', kind: 'lesson', parent: 'C-1', title: 'Феху', status: 'done', mins: 20 },
  { key: 'L-2', kind: 'lesson', parent: 'C-1', title: 'Уруз', status: 'open', mins: 30 },
];

interface ShowOpts {
  rows?: TreeFlatRow[];
  levelState?: Record<string, TreeLevelState>;
  levels?: TreeLevel[];
  columns?: string[];
  role?: string;
}

function show({ rows = FULL, levelState, levels = LEVELS, columns = COLUMNS, role = 'reader' }: ShowOpts = {}) {
  return render(
    <KitLangProvider lang="ru">
      <TreeTable levels={levels} columns={columns} rows={rows} levelState={levelState} ctx={ctxOf(role)} />
    </KitLangProvider>,
  );
}

const grid = () => screen.getByRole('table');
const recRows = () => Array.from(grid().querySelectorAll('tr[data-line="record"]'));
const levelOf = (id: string) => recRows().find(tr => (tr as HTMLElement).dataset.id === id)?.getAttribute('aria-level');
const order = () => recRows().map(tr => (tr as HTMLElement).dataset.id);

describe('S4-TREE-NESTED · TreeTable — дерево с однородными столбцами', () => {
  it('положительный контроль: дерево собралось из ПЛОСКОГО списка, порядок книги', () => {
    show();
    expect(order()).toEqual(['C-1', 'U-1', 'L-1', 'U-2', 'L-2', 'L-9']);
    expect(levelOf('C-1')).toBe('1');
    expect(levelOf('U-1')).toBe('2');
    expect(levelOf('L-1')).toBe('3');
  });

  it('столбцы ОДНИ на все уровни: заголовок один, ячеек у любой строки — по числу столбцов', () => {
    show();
    expect(grid().querySelectorAll('thead')).toHaveLength(1);
    const heads = Array.from(grid().querySelectorAll('thead th')).map(th => th.textContent?.trim());
    expect(heads).toEqual(['Статус', 'Код', 'Запись', 'Минут']);
    for (const tr of recRows()) {
      expect(tr.querySelectorAll('td'), `${(tr as HTMLElement).dataset.id}`).toHaveLength(COLUMNS.length);
    }
  });

  it('набор столбцов задаёт вызывающий — и он один для всех уровней', () => {
    show({ columns: ['title', 'status'] });
    for (const tr of recRows()) expect(tr.querySelectorAll('td')).toHaveLength(2);
  });

  it('среднего уровня нет (state=none): записи глубже встают на уровень 2, разметка та же', () => {
    show({ rows: NO_MIDDLE, levelState: { unit: 'none' } });
    expect(levelOf('L-1')).toBe('2');
    expect(levelOf('L-2')).toBe('2');
    for (const tr of recRows()) expect(tr.querySelectorAll('td')).toHaveLength(COLUMNS.length);
  });

  it('«уровня нет» — проверенный факт: он пропускается МОЛЧА, без оговорки', () => {
    const { container } = show({ rows: NO_MIDDLE, levelState: { unit: 'none' } });
    expect(container.querySelectorAll('.sk-ttab__note')).toHaveLength(0);
  });

  it('записи глубокого уровня у родителя С промежуточным — ОТДЕЛЬНОЙ группой на уровне 2', () => {
    show();
    const group = grid().querySelector('tr[data-line="group"]');
    expect(group).toBeTruthy();
    expect(group?.getAttribute('aria-level')).toBe('2');
    // Подпись явная и называет уровень, которого у этих записей нет.
    expect(group?.textContent).toContain('Модуль');
    // И они НЕ подмешаны к первой группе промежуточного уровня: группа идёт после обоих модулей.
    const ids = order();
    expect(ids.indexOf('L-9')).toBeGreaterThan(ids.indexOf('L-2'));
    expect(levelOf('L-9')).toBe('3');
  });

  it('группа «вне уровня» не появляется, когда промежуточного уровня нет ни у кого', () => {
    show({ rows: NO_MIDDLE, levelState: { unit: 'none' } });
    expect(grid().querySelectorAll('tr[data-line="group"]')).toHaveLength(0);
  });

  it('состояния уровня звучат РАЗНЫМИ словами: нет прав ≠ сбой ≠ обрезано ≠ пусто', () => {
    const textOf = (levelState?: Record<string, TreeLevelState>, rows?: TreeFlatRow[]) => {
      const { container, unmount } = show({ levelState, rows });
      const t = container.textContent ?? '';
      unmount();
      return t;
    };
    const denied = textOf({ unit: 'denied' });
    const error = textOf({ unit: 'error' });
    const truncated = textOf({ unit: 'truncated' });
    const empty = textOf(undefined, []);
    const words = [denied, error, truncated, empty];
    for (const w of words) expect(w.trim().length).toBeGreaterThan(10);
    expect(new Set(words).size).toBe(4);
    // Каждое состояние названо своим словом, а не общим «что-то не так».
    expect(denied).toMatch(/прав|доступ/i);
    expect(error).toMatch(/не удалось|сбой/i);
    expect(truncated).toMatch(/не полностью|обрезан/i);
  });

  it('сбой и запрет уровня НЕ убирают уровень молча — оговорка видна', () => {
    for (const state of ['denied', 'error', 'truncated'] as const) {
      const { container, unmount } = show({ levelState: { unit: state } });
      const note = container.querySelector('.sk-ttab__note');
      expect(note, state).toBeTruthy();
      expect(note?.getAttribute('data-state'), state).toBe(state);
      unmount();
    }
  });

  it('«уровня нет», а записи уровня пришли — противоречие названо, а не сглажено', () => {
    // Источник сказал «проверено, уровня нет», но ряды этого вида в выдаче
    // есть. Молча показать их значило бы согласиться сразу с двумя взаимно
    // исключающими утверждениями.
    const { container } = show({ rows: FULL, levelState: { unit: 'none' } });
    const note = container.querySelector('.sk-ttab__note');
    expect(note).toBeTruthy();
    expect(note?.getAttribute('data-state')).toBe('none-contradicted');
    expect(note?.textContent).toContain('Модуль');
  });

  it('незнакомое состояние уровня не проходит молча', () => {
    const { container } = show({ levelState: { unit: 'сломалось' as TreeLevelState } });
    const note = container.querySelector('.sk-ttab__note');
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain('сломалось');
  });

  it('родитель назван, но не выдан — запись не всплывает молча в корень', () => {
    const rows: TreeFlatRow[] = [
      { key: 'C-1', kind: 'course', parent: null, title: 'Руны', status: 'open' },
      { key: 'L-7', kind: 'lesson', parent: 'U-404', title: 'Сирота', status: 'open', mins: 5 },
    ];
    show({ rows, levelState: { unit: 'denied' } });
    // Запись видна — не потеряна…
    expect(order()).toContain('L-7');
    // …но не притворяется записью первого уровня: над ней явная группа.
    const group = grid().querySelector('tr[data-line="group"][data-group="orphan"]');
    expect(group).toBeTruthy();
    expect(group?.textContent?.trim().length ?? 0).toBeGreaterThan(5);
    expect(levelOf('L-7')).not.toBe('1');
  });

  it('смена статуса — существующим StatusSlot: с правом кнопка, без права плашка', () => {
    const { container: ro } = show({ role: 'reader' });
    expect(ro.querySelector('.sk-schip--btn')).toBeNull();
    expect(ro.querySelector('.sk-rec-status')).toBeTruthy();
    const { container: rw } = show({ role: 'teacher' });
    expect(rw.querySelector('.sk-schip--btn')).toBeTruthy();
  });

  it('уровни не заданы — честный отказ словами, а не пустая таблица', () => {
    const { container } = show({ levels: [] });
    expect(container.textContent).toMatch(/уровн/i);
    expect(container.querySelector('tr[data-line="record"]')).toBeNull();
  });

  it('уровень сворачивается: дети уходят из разметки, столбцы не меняются', () => {
    show();
    const toggle = grid().querySelector<HTMLButtonElement>('tr[data-id="C-1"] .sk-ttab__toggle');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    expect(order()).toEqual(['C-1']);
    expect(recRows()[0].querySelectorAll('td')).toHaveLength(COLUMNS.length);
  });

  it('все классы sk-… таблицы описаны в seidr.css (единый слой, S4-00e)', () => {
    const defined = definedClasses(css);
    const { container } = show({ levelState: { unit: 'truncated' } });
    const missing = [...usedClasses(container.innerHTML)].filter(c => c.startsWith('sk-') && !defined.has(c));
    expect(missing).toEqual([]);
  });
});

describe('S4-TREE-NESTED · treeTableLines — правило без React', () => {
  it('порядок строк: родитель, его промежуточные уровни, затем группа «вне уровня»', () => {
    const lines = treeTableLines(FULL, LEVELS, null);
    expect(lines.map(l => (l.type === 'record' ? l.record.id : `группа:${l.group}`))).toEqual([
      'C-1', 'U-1', 'L-1', 'U-2', 'L-2', 'группа:outside', 'L-9',
    ]);
  });

  it('уровень строки — её место в иерархии, а не порядок вида в levels', () => {
    const lines = treeTableLines(NO_MIDDLE, LEVELS, null);
    const l1 = lines.find(l => l.type === 'record' && l.record.id === 'L-1');
    expect(l1 && l1.type === 'record' && l1.level).toBe(2);
  });

  it('свёрнутый узел не отдаёт своих детей', () => {
    const lines = treeTableLines(FULL, LEVELS, new Set(['C-1']));
    expect(lines.filter(l => l.type === 'record').map(l => l.type === 'record' && l.record.id)).toEqual(['C-1']);
  });
});

// Телефон (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE, SPEC-SEIDRKIT-ADAPTIVE-TEST
// §3 п.5): замер v1.17.13, паспорт спринта 360×800 — вкладка «Задачи» была
// таблицей 699 px внутри 302, «Запись» сжата до 69 px, читать можно только
// листая вбок. В v1 здесь список карточек (D-2026-UXR-MOBILE-FOLLOWS-V1).
// Правило то же, что у списка: узко — карточки, столбцы — парами «подпись —
// значение», уровень — отступом, свёртка ветки работает.
describe('TreeTable на телефоне — карточками, без таблицы', () => {
  const phone = (rows = FULL) => render(
    <KitLangProvider lang="ru">
      <TreeTable levels={LEVELS} columns={COLUMNS} rows={rows} ctx={ctxOf()} narrow />
    </KitLangProvider>,
  );

  it('положительный контроль: широко — таблица', () => {
    const { container } = render(
      <KitLangProvider lang="ru"><TreeTable levels={LEVELS} columns={COLUMNS} rows={FULL} ctx={ctxOf()} narrow={false} /></KitLangProvider>,
    );
    expect(container.querySelector('table.sk-ttab__table')).toBeTruthy();
    expect(container.querySelector('.sk-ttab__cards')).toBeNull();
  });

  it('узко — нет таблицы, на каждую запись карточка, группа — заголовком', () => {
    const { container } = phone();
    expect(container.querySelector('table')).toBeNull();
    const cards = [...container.querySelectorAll('.sk-ttab__cards [data-line="record"]')];
    expect(cards.map(c => c.getAttribute('data-id'))).toEqual(['C-1', 'U-1', 'L-1', 'U-2', 'L-2', 'L-9']);
    expect(container.querySelector('.sk-ttab__cards [data-line="group"]')).toBeTruthy();
  });

  it('узко — уровень виден отступом, а столбцы — подписями', () => {
    const { container } = phone();
    const l1 = container.querySelector<HTMLElement>('[data-id="L-1"]')!;
    expect(l1.getAttribute('aria-level')).toBe('3');
    expect(l1.style.getPropertyValue('--tree-depth')).toBe('2');
    expect([...l1.querySelectorAll('dt')].map(d => d.textContent)).toContain('Минут');
  });

  it('узко — свёртка ветки работает', () => {
    const { container } = phone();
    fireEvent.click(screen.getByRole('button', { name: /Руны/ }));
    expect([...container.querySelectorAll('[data-line="record"]')].map(c => c.getAttribute('data-id'))).toEqual(['C-1']);
  });
});
