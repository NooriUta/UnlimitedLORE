// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09 — задачи в списке спринтов: колонка
// «задачи x/y» и раскрытие строки с задачами (задачи первыми), смена статуса
// задачи за ≤2 касания (StatusChip kit, S4-07). Жалоба владелицы: «не вижу
// задачи и статусы в два клика».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { createLoreClient, type LoreClient } from './loreClient';
import { STATUS_MATCH, planStatusOf, PLAN_STATUSES } from './taskStatus';
import { ABSENT_NUMBERS, ABSENT_ROW, UNKNOWN_STATE, loadSprintTotals } from './sprintTotals';
import { SprintTasks } from './SprintTasks';

beforeAll(() => { registerGameIcons(gameIcons); });

const here = dirname(fileURLToPath(import.meta.url));
const shared = JSON.parse(readFileSync(resolve(here, '../../../shared/lore-statuses.json'), 'utf8')) as {
  planStatuses: string[];
  statusMatch: Record<string, { marker: string; words: string[] }>;
};

type Json = Record<string, unknown>;
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
/** Фейковый fetch: маршрут по пути+слайсу, журнал вызовов. */
function fakeFetch(routes: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://lore.test');
    calls.push({ url, init });
    return routes(url, init);
  });
  return { fn, calls };
}
const client = (f: ReturnType<typeof fakeFetch>): LoreClient =>
  createLoreClient({ fetch: f.fn as unknown as typeof fetch, origin: 'http://lore.test' });

const task = (sprint: string, id: string, status_raw: string): Json =>
  ({ task_uid: `${sprint}/${id}`, task_id: id, title: `Задача ${id}`, status_raw, sprint_id: sprint, order_index: 1 });

describe('статус задачи из status_raw — словарь shared/lore-statuses.json', () => {
  it('маркер и слово читаются, неизвестное — unknown, а не todo', () => {
    expect(planStatusOf('✅ DONE')).toBe('done');
    expect(planStatusOf('📋 PLANNED')).toBe('planned');
    expect(planStatusOf('🔄 IN PROGRESS')).toBe('active');
    expect(planStatusOf('MERGED — влито')).toBe('done');
    expect(planStatusOf('🚫 CANCELLED')).toBe('cancelled');
    expect(planStatusOf('NOT DONE')).toBe('unknown');
    expect(planStatusOf(null)).toBe('unknown');
  });
  it('копия словаря не разошлась с shared (образ v2 shared/ не видит)', () => {
    expect(STATUS_MATCH).toEqual(shared.statusMatch);
    expect([...PLAN_STATUSES].sort()).toEqual([...shared.planStatuses].sort());
  });
});

/**
 * Переписано 09.11 вместе со сменой источника (S4-09, просьба владелицы про
 * суммарную оценку). Прежние проверки стояли на `loadSprintProgress`, который
 * считал x/y НА КЛИЕНТЕ по `tasks_of_sprints_batch`; модуль заменён на
 * `loadSprintTotals` поверх среза `sprint_totals`. Почему заменён, а не добавлен
 * рядом: одно число, посчитанное в двух местах, расходится — у kit это уже
 * случилось со статусными цветами в трёх местах (K-14). Плюс прежний срез нёс
 * `note_md` — 3,6 МБ на двадцать спринтов ради трёх чисел.
 *
 * Что проверки СОХРАНИЛИ дословно по смыслу: пачки по 20, упавшая пачка метит
 * только свои спринты, обрезанная выдача не выдаёт себя за полный подсчёт.
 * Что добавили: суммы, «не заполнено» вместо нуля и отсутствие строки.
 */
describe('итоги спринта: задач x/y, оценка Σ, факт Σ — считает сервер', () => {
  /** Строка итогов в форме сервера (LoreSprintTotals). */
  const totals = (sprint: string, o: {
    done?: number; of?: number;
    effort?: number | null; effortKnown?: number;
    actual?: number | null; actualKnown?: number;
    state?: string;
  }): Json => ({
    sprint_id: sprint,
    state: o.state ?? 'ok',
    tasks_total: { value: o.of ?? 0, known: o.of ?? 0, of: o.of ?? 0, done: o.done ?? 0 },
    effort_days_total: { value: o.effort ?? null, known: o.effortKnown ?? 0, of: o.of ?? 0 },
    actual_days_total: { value: o.actual ?? null, known: o.actualKnown ?? 0, of: o.of ?? 0 },
  });

  it('положительный контроль: прогресс и обе суммы приходят из одного запроса', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [totals('S0', { done: 1, of: 2, effort: 3.5, effortKnown: 2 })] }));
    const res = await loadSprintTotals(client(f), ['S0']);
    // Один запрос, а не три: три числа едут одной строкой.
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url.pathname).toBe('/lore/slice/sprint_totals');
    expect(res.get('S0')).toEqual({
      tasks: { done: 1, total: 2 },
      effort_total: { value: 3.5, known: 2, of: 2 },
      actual_total: { value: null, known: 0, of: 2 },
    });
  });

  it('пачки по 20; упавшая пачка метит ТОЛЬКО свои спринты, а не весь ответ', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `S${i}`);
    const f = fakeFetch(url => {
      const list = (url.searchParams.get('sprint_ids') ?? '').split(',');
      if (list.includes('S24')) return jsonRes({ error: 'LORE_UPSTREAM', detail: 'down' }, 502);
      return jsonRes({ rows: list.map(id => totals(id, { done: 1, of: 2, effort: 1, effortKnown: 1 })) });
    });
    const res = await loadSprintTotals(client(f), ids);
    expect(f.calls.map(c => c.url.pathname)).toEqual(['/lore/slice/sprint_totals', '/lore/slice/sprint_totals']);
    expect(f.calls[0].url.searchParams.get('sprint_ids')!.split(',')).toHaveLength(20);
    expect(res.get('S0')).toMatchObject({ tasks: { done: 1, total: 2 } });
    // Упавшая пачка: причина названа во ВСЕХ трёх полях, иначе часть строки
    // выглядела бы посчитанной.
    expect(res.get('S24')).toEqual({
      tasks: { error: expect.stringContaining('502') },
      effort_total: { error: expect.stringContaining('502') },
      actual_total: { error: expect.stringContaining('502') },
    });
  });

  it('обрезанная выдача: сумма помечена — иначе занижение выглядело бы точным', async () => {
    // Признак обрезки в ответе относится к СТРОКАМ ЗАДАЧ (тело собирается до
    // свёртки), то есть часть слагаемых сервер не видел.
    const f = fakeFetch(() => jsonRes({
      rows: [totals('S0', { done: 1, of: 1, effort: 2, effortKnown: 1 })], truncated: true, limit: 1,
    }));
    const res = await loadSprintTotals(client(f), ['S0']);
    expect(res.get('S0')).toEqual({
      tasks: { done: 1, total: 1, partial: true },
      effort_total: { value: 2, known: 1, of: 1, cut: true },
      actual_total: { value: null, known: 0, of: 1, cut: true },
    });
  });

  /** Помечена ли сумма спринта S0 как «складывали не всё». */
  const cutOf = (m: Map<string, Record<string, unknown>>): boolean =>
    (m.get('S0')?.effort_total as { cut?: boolean } | undefined)?.cut === true;

  /**
   * Признак берётся из СВОЕГО поля сервера `inputs_truncated` (#995), а не из
   * чужого `truncated`. Прежний путь держался на порядке кода: тело ответа
   * собиралось до свёртки, поэтому `truncated` случайно означал нужное. Своё
   * поле не зависит от того, где считается свёртка.
   */
  it('inputs_truncated: true — суммы помечены', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [totals('S0', { done: 0, of: 1 })], inputs_truncated: true }));
    expect(cutOf(await loadSprintTotals(client(f), ['S0']))).toBe(true);
  });

  it('inputs_truncated: false главнее прежнего признака — он про другое', async () => {
    // `truncated` после свёртки относится к строкам ИТОГОВ, а не к слагаемым.
    // Если сервер прямо говорит «слагаемые целы», верим ему, а не догадке.
    const f = fakeFetch(() => jsonRes({
      rows: [totals('S0', { done: 0, of: 1 })], inputs_truncated: false, truncated: true,
    }));
    expect(cutOf(await loadSprintTotals(client(f), ['S0']))).toBe(false);
  });

  it('страница с продолжением обрезкой НЕ считается — она режет строки итогов', async () => {
    // Исправление прежнего поведения: `SlicePage.apply` работает ПОСЛЕ свёртки,
    // то есть режет строки «по одной на спринт». Суммы в отданных строках полны.
    const f = fakeFetch(() => jsonRes({
      rows: [totals('S0', { done: 0, of: 1 })], inputs_truncated: false, page: { has_more: true, total: 9 },
    }));
    expect(cutOf(await loadSprintTotals(client(f), ['S0']))).toBe(false);
  });

  it('поля нет (сервер старее #995) — читается прежний признак, а не «не обрезано»', async () => {
    // Считать отсутствие ключа за «целы» было бы молчаливым допущением.
    const f = fakeFetch(() => jsonRes({ rows: [totals('S0', { done: 0, of: 1 })], truncated: 'unknown' }));
    expect(cutOf(await loadSprintTotals(client(f), ['S0']))).toBe(true);
  });

  it('полная выдача признака обрезки НЕ несёт', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [totals('S0', { done: 0, of: 1 })], inputs_truncated: false }));
    expect(cutOf(await loadSprintTotals(client(f), ['S0']))).toBe(false);
  });

  it('спринта нет в ответе — причина словами, а не тихий ноль', async () => {
    // Строка на КАЖДЫЙ запрошенный спринт — обещание сервера. Не выполнено —
    // говорим это: пустота прочиталась бы как «задач ноль».
    const f = fakeFetch(() => jsonRes({ rows: [totals('S0', { done: 1, of: 1 })] }));
    const res = await loadSprintTotals(client(f), ['S0', 'S1']);
    expect(res.get('S0')).toMatchObject({ tasks: { done: 1, total: 1 } });
    expect(res.get('S1')).toEqual({
      tasks: { error: ABSENT_ROW }, effort_total: { error: ABSENT_ROW }, actual_total: { error: ABSENT_ROW },
    });
  });

  it('чужое состояние строки — причина словами, а не числа наугад', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [{ ...totals('S0', { done: 1, of: 2 }), state: 'skipped' }] }));
    const res = await loadSprintTotals(client(f), ['S0']);
    expect(res.get('S0')).toEqual({
      tasks: { error: UNKNOWN_STATE }, effort_total: { error: UNKNOWN_STATE }, actual_total: { error: UNKNOWN_STATE },
    });
  });

  it('числа итогов не пришли — «не посчитано», а не 0/0 и не ноль', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [{ sprint_id: 'S0', state: 'ok' }] }));
    const res = await loadSprintTotals(client(f), ['S0']);
    expect(res.get('S0')).toEqual({
      tasks: { error: ABSENT_NUMBERS }, effort_total: { error: ABSENT_NUMBERS }, actual_total: { error: ABSENT_NUMBERS },
    });
  });

  it('пустой спринт: 0/0 — это ЧИСЛА, а не отказ', async () => {
    // «Задач ноль» сервер выражает числами, и это другое утверждение, чем
    // «спринт не посчитали».
    const f = fakeFetch(() => jsonRes({ rows: [totals('S0', { done: 0, of: 0 })] }));
    const res = await loadSprintTotals(client(f), ['S0']);
    expect(res.get('S0')).toMatchObject({ tasks: { done: 0, total: 0 }, effort_total: { known: 0, of: 0 } });
  });
});

describe('раскрытая строка: задачи спринта и статус за ≤2 касания', () => {
  it('задачи со статусами; касание чипа → касание статуса → POST /lore/status', async () => {
    const f = fakeFetch((url, init) => {
      if (url.pathname === '/lore/status') {
        return jsonRes({ ok: true, entity_type: 'task', id: 'SP/T1', old_status: 'planned', new_status: JSON.parse(String(init?.body)).status });
      }
      return jsonRes({ rows: [task('SP', 'T1', '📋 PLANNED'), task('SP', 'T2', '✅ DONE')], page: { has_more: false, fields_checked: true } });
    });
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    const list = await screen.findByRole('list', { name: 'Задачи спринта SP' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(f.calls[0].url.pathname).toBe('/lore/slice/tasks_of_sprint');
    expect(f.calls[0].url.searchParams.get('sprint_id')).toBe('SP');

    // касание 1: чип статуса задачи
    fireEvent.click(within(list).getAllByRole('button', { name: /^Статус: / })[0]);
    // касание 2: целевой статус
    fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    await waitFor(() => expect(f.calls.some(c => c.url.pathname === '/lore/status')).toBe(true));
    const post = f.calls.find(c => c.url.pathname === '/lore/status')!;
    expect(post.init?.method).toBe('POST');
    expect(JSON.parse(String(post.init?.body))).toEqual({ entity_type: 'task', id: 'SP/T1', status: 'active' });
  });

  // PU-23 (владелица 13.11: «выровнять названия задач»): код задачи переменной ширины (FIT-04,
  // AL-108, QUAL-1) шёл потоком, и название начиналось с разного x. Код — колонка одной ширины на
  // весь список, по самому длинному коду (моноширинный шрифт → ширина в ch точная); название —
  // своей колонкой, поэтому с одной вертикали. jsdom не меряет раскладку — проверяем устройство:
  // ширину колонки на списке и то, что код и название — отдельные ячейки строки.
  it('PU-23: код — колонка ширины самого длинного кода, название — своя колонка', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [task('SP', 'FIT-04', '📋 PLANNED'), task('SP', 'AL-108', '✅ DONE'), task('SP', 'QUAL-1', '✅ DONE')], page: { has_more: false, fields_checked: true } }));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    const list = await screen.findByRole('list', { name: 'Задачи спринта SP' });
    expect(list.style.getPropertyValue('--sprint-code-w')).toBe('6ch');
    for (const li of within(list).getAllByRole('listitem')) {
      const code = li.querySelector('.sprint-tasks__code');
      const title = li.querySelector('.sprint-tasks__title');
      expect(code, 'код — своя ячейка').not.toBeNull();
      expect(title?.previousElementSibling, 'название сразу за колонкой кода').toBe(code);
    }
  });

  // Владелица 08.11: «в шевронах дерева, если есть статус, не надо к иконке ещё и слова
  // приписывать — только подсказку». Вложенная строка под ▸ — иконка статуса, имя — в подсказке.
  it('во вложенных строках статус — только иконка, слово — в подсказке и для чтения', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [task('SP', 'T1', '✅ DONE')], page: { has_more: false, fields_checked: true } }));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    const list = await screen.findByRole('list', { name: 'Задачи спринта SP' });
    const chip = within(list).getByRole('button', { name: /^Статус: / });
    expect(chip.querySelector('.sk-schip__title')).toBeNull();
    expect(chip.getAttribute('title')).toMatch(/^Статус: /);
  });

  it('отказ сохранения — откат и причина на экране', async () => {
    const f = fakeFetch(url => url.pathname === '/lore/status'
      ? jsonRes({ error: 'FORBIDDEN', detail: 'admin role required' }, 403)
      : jsonRes({ rows: [task('SP', 'T1', '📋 PLANNED')] }));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    const list = await screen.findByRole('list', { name: 'Задачи спринта SP' });
    fireEvent.click(within(list).getByRole('button', { name: /^Статус: / }));
    fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('admin role required');
    expect(within(list).getByRole('button', { name: /^Статус: / }).getAttribute('data-status')).toBe('planned');
  });

  it('сбой загрузки задач — ошибка с «повторить», а не «задач нет»', async () => {
    const f = fakeFetch(() => jsonRes({ error: 'LORE_UPSTREAM', detail: 'db down' }, 502));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    expect(await screen.findByRole('button', { name: /Повторить/ })).toBeTruthy();
    expect(screen.queryByText(/Задач нет/)).toBeNull();
  });

  it('проверенный ноль — «задач нет»', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [], page: { has_more: false, fields_checked: true } }));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    expect(await screen.findByText('В спринте нет задач')).toBeTruthy();
  });
});

describe('маршрут /sprints', () => {
  it('routeOf узнаёт /sprints и /sprints/', async () => {
    const { routeOf } = await import('../App');
    expect(routeOf('/sprints')).toBe('sprints');
    expect(routeOf('/sprints/')).toBe('sprints');
    expect(routeOf('/kit')).toBe('kit');
    expect(routeOf('/')).toBe('home');
  });
});

// Экран «Спринты» (x/y, раскрытие, сбой списка) — теперь общий ListScreen:
// паритет — web-next/src/pages/ListScreen.sprints.test.tsx (S4-22).
