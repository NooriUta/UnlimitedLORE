// Числа задач, ПОСЧИТАННЫЕ СЕРВЕРОМ, важнее пересчёта по рёбрам (S9-12 / S4-36).
//
// Дефект прода v1.17.8 (CJM соседней сессии 09.11.2026): в паспорте спринта
// «Задач нет», а в списке у того же спринта 48/55. Живой ответ
// /lore/record/sprint/SPRINT_AIDA_PREPROD_MIGRATION отдавал
// `facts.tasks = {done 48, total 56, open 7}` — то есть ответ был правильный,
// а клиент его не использовал: считал по рёбрам, которых в `links` нет (задачи
// приходят в `parts[]`).
//
// Почему именно «числа от сервера сильнее»: выборка у клиента бывает
// обрезанной (meta.data_state, state truncated), а итог сервер считает по
// корпусу. Пересчёт по видимым рёбрам тогда занижает — и занижает МОЛЧА, что
// хуже, чем «не смогли проверить». Поэтому заданные числа побеждают, но только
// они: ошибка блока по-прежнему сильнее любых чисел.
import { describe, expect, it } from 'vitest';
import { recordFacts } from './facts';
import type { KitCtx, KitRecord } from '../core/contract';

const sprint: KitRecord = { id: 'SPRINT_X', kind: 'sprint', title: 'Спринт', status: 'active', fields: {} };

function ctx(opts: { edges?: KitCtx['data']['edges']; records?: KitRecord[]; errors?: { block: string; reason: string }[] } = {}) {
  return {
    data: {
      records: [sprint, ...(opts.records ?? [])],
      edges: opts.edges ?? [],
      journal: [],
      meta: { generated_at: '2026-11-09T00:00:00.000Z', ...(opts.errors ? { errors: opts.errors } : {}) },
    },
    config: {
      statuses: { items: [
        { code: 'done', title: 'Готово', category: 'done' },
        { code: 'active', title: 'В работе', category: 'active' },
        { code: 'cancelled', title: 'Отменено', category: 'cancelled' },
      ] },
    },
  } as unknown as KitCtx;
}

const SPEC = { childEdge: 'PART_OF', childDir: 'in' as const, now: '2026-11-09' };

describe('S4-36 · задачи: числа сервера против пересчёта по рёбрам', () => {
  it('положительный контроль: без заданных чисел считается по рёбрам', () => {
    const t = recordFacts(sprint, ctx({
      edges: [{ from: 'T-1', to: 'SPRINT_X', type: 'PART_OF' }, { from: 'T-2', to: 'SPRINT_X', type: 'PART_OF' }],
      records: [
        { id: 'T-1', kind: 'task', title: 'Раз', status: 'done', fields: {} },
        { id: 'T-2', kind: 'task', title: 'Два', status: 'active', fields: {} },
      ],
    }), SPEC).tasks;
    expect(t).toMatchObject({ state: 'ok', done: 1, total: 2, open: 1 });
  });

  it('сервер посчитал 48/56 — показываем 48/56, а не 1/2 по видимым рёбрам', () => {
    const t = recordFacts(sprint, ctx({
      edges: [{ from: 'T-1', to: 'SPRINT_X', type: 'PART_OF' }, { from: 'T-2', to: 'SPRINT_X', type: 'PART_OF' }],
      records: [
        { id: 'T-1', kind: 'task', title: 'Раз', status: 'done', fields: {} },
        { id: 'T-2', kind: 'task', title: 'Два', status: 'active', fields: {} },
      ],
    }), { ...SPEC, counts: { done: 48, total: 56, open: 7 } }).tasks;
    expect(t).toMatchObject({ state: 'ok', done: 48, total: 56, open: 7 });
  });

  it('числа есть, а рёбер нет — всё равно 48/56: «Задач нет» было бы неправдой', () => {
    const t = recordFacts(sprint, ctx(), { ...SPEC, counts: { done: 48, total: 56, open: 7 } }).tasks;
    expect(t).toMatchObject({ state: 'ok', done: 48, total: 56 });
  });

  it('open не прислали — считаем сами как total − done, без выдумок', () => {
    const t = recordFacts(sprint, ctx(), { ...SPEC, counts: { done: 2, total: 5 } }).tasks;
    expect(t).toMatchObject({ state: 'ok', done: 2, total: 5, open: 3 });
  });

  it('проверенный ноль остаётся нулём: сервер прислал 0/0 — «Задач нет»', () => {
    const t = recordFacts(sprint, ctx(), { ...SPEC, counts: { done: 0, total: 0 } }).tasks;
    expect(t).toEqual({ state: 'none' });
  });

  it('блок задач не прочитался — ошибка сильнее любых чисел', () => {
    const t = recordFacts(sprint, ctx({ errors: [{ block: 'tasks', reason: 'tasks_of_sprint: 502' }] }),
      { ...SPEC, counts: { done: 48, total: 56 } }).tasks;
    expect(t).toMatchObject({ state: 'error', reason: 'tasks_of_sprint: 502' });
  });

  it('вида «задачи» у записи нет (childEdge не задан) — факта нет даже с числами', () => {
    expect(recordFacts(sprint, ctx(), { counts: { done: 1, total: 2 }, now: '2026-11-09' }).tasks).toBeNull();
  });
});
