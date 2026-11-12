// Список статусов в паспорте — ЦИКЛ ТИПА из модели, а не все оси сразу
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// Жалоба владелицы на проде v1.17.7, меню статуса задачи: «В работе» дважды,
// есть чужие статусы («Предложено», «Скоро», «Исправлено», «Достигнуто»,
// «Отложено»), и НЕТ «Запланировано».
//
// ПРИЧИНА — мой код, и указала её серверная сессия, проверив обе стороны:
// `loreStatuses()` строил `config.statuses` из `KNOWN_STATUSES` kit, то есть
// из ВСЕХ осей разом. Отсюда и чужие статусы, и два «В работе» (`active` и
// `in_progress` — обе строки «В работе» в локали). А «Запланировано» не
// предлагалось потому, что это текущий статус записи, — и это НЕ баг.
//
// Сервер при этом отдаёт цикл КАЖДОГО типа: `/lore/model` → `statuses.<type>.
// entries` с `allow`. У задачи свой цикл, у спринта свой, у ADR свой.
//
// Здесь закрепляется: берём цикл типа; модели нет — остаётся умолчание
// приложения, и об этом СКАЗАНО, а не замолчано.
import { describe, expect, it } from 'vitest';
import { fetchTypeStatuses } from './passportStatuses';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const net = (body: unknown, status = 200) => (async () => json(body, status)) as unknown as typeof fetch;

/** Цикл задачи — ровно то, что серверная сессия намерила на проде: 10 кодов. */
const TASK_CYCLE = [
  { code: 'todo', title: 'К работе', category: 'todo', icon: 'hourglass', color: 'var(--t3)', order: 1, allow: ['active', 'cancelled'] },
  { code: 'planned', title: 'Запланировано', category: 'todo', icon: 'calendar', color: 'var(--inf)', order: 2, allow: ['active'] },
  { code: 'active', title: 'В работе', category: 'in_progress', icon: 'progression', color: 'var(--acc)', order: 3, allow: ['done', 'blocked', 'planned'] },
  { code: 'done', title: 'Готово', category: 'finished', icon: 'divided-spiral', color: 'var(--suc)', order: 4, allow: [] },
];

const model = (statuses: Record<string, unknown>) => ({
  format: 'model/0', version: '2026-11-09T00:00:00Z', statuses,
});

describe('S4-STATUS-AXIS-CONFIG · статусы паспорта — цикл типа', () => {
  it('положительный контроль: пришёл цикл задачи — ровно его коды, в его порядке', async () => {
    const r = await fetchTypeStatuses('task', { fetchImpl: net(model({ task: { entries: TASK_CYCLE } })) });
    expect(r.items.map(s => s.code)).toEqual(['todo', 'planned', 'active', 'done']);
    expect(r.notes).toEqual([]);
  });

  it('ЧУЖИХ статусов в цикле нет — это и была жалоба', async () => {
    const r = await fetchTypeStatuses('task', { fetchImpl: net(model({ task: { entries: TASK_CYCLE } })) });
    for (const alien of ['proposed', 'reached', 'fixed', 'upcoming', 'deferred', 'in_progress']) {
      expect(r.items.map(s => s.code), alien).not.toContain(alien);
    }
  });

  it('двух статусов с одинаковой подписью в цикле типа не бывает', async () => {
    const r = await fetchTypeStatuses('task', { fetchImpl: net(model({ task: { entries: TASK_CYCLE } })) });
    const titles = r.items.map(s => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('allow доходит: из «В работе» можно вернуться в «Запланировано»', async () => {
    // Ровно то, чего владелице не хватало. «Запланировано» не предлагалось,
    // когда оно само было текущим статусом, — это правило, а не поломка.
    const r = await fetchTypeStatuses('task', { fetchImpl: net(model({ task: { entries: TASK_CYCLE } })) });
    expect(r.items.find(s => s.code === 'active')?.allow).toContain('planned');
  });

  it('у каждого типа СВОЙ цикл: спрашиваем adr — получаем adr', async () => {
    const doc = model({
      task: { entries: TASK_CYCLE },
      adr: { entries: [{ code: 'proposed', title: 'Предложено', category: 'todo', icon: 'quill-ink', color: 'var(--t3)' }] },
    });
    const r = await fetchTypeStatuses('adr', { fetchImpl: net(doc) });
    expect(r.items.map(s => s.code)).toEqual(['proposed']);
  });

  it('циклы ВСЕХ типов — для чужих строк паспорта (владелица 11.11: «в дочерних табличных видах не подтягиваются правильные иконки»)', async () => {
    const doc = model({
      task: { entries: TASK_CYCLE },
      sprint: { entries: [{ code: 'active', title: 'Идёт', category: 'in_progress', icon: 'run', color: 'var(--inf)' }] },
    });
    const r = await fetchTypeStatuses('sprint', { fetchImpl: net(doc) });
    expect(r.items.map(s => s.code)).toEqual(['active']);
    expect(r.byKind?.task?.find(s => s.code === 'active')?.icon).toBe('progression');
    expect(r.byKind?.sprint?.[0].icon).toBe('run');
  });

  it('модель не прочиталась — пусто плюс НАЗВАННАЯ причина, а не тихий откат', async () => {
    const r = await fetchTypeStatuses('task', { fetchImpl: net({ error: 'DISABLED' }, 501) });
    expect(r.items).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/умолчани/i);
    expect(r.notes.join(' ')).toMatch(/501/);
  });

  it('в модели нет цикла для этого типа — сказано, какого типа не хватило', async () => {
    const r = await fetchTypeStatuses('milestone', { fetchImpl: net(model({ task: { entries: TASK_CYCLE } })) });
    expect(r.items).toEqual([]);
    expect(r.notes.join(' ')).toContain('milestone');
  });

  it('дыры оформления в цикле названы, но статус НЕ выбрасывается', async () => {
    // Так на проде выглядят adr-статусы draft/deferred: статья есть, иконки
    // нет. Спрятать статус значило бы оставить запись без чипа вовсе.
    const doc = model({ adr: { entries: [{ code: 'draft', title: 'Черновик', category: 'todo', icon: null, color: null }] } });
    const r = await fetchTypeStatuses('adr', { fetchImpl: net(doc) });
    expect(r.items.map(s => s.code)).toEqual(['draft']);
    expect(r.notes.join(' ')).toMatch(/цвет|значок/i);
  });
});

// S4-35 / ADR-LORE-049: вместе с циклом статусов из той же модели берётся
// показ колонок типа — `types.<тип>.fields[].display`. kit его разбирал и
// никто не применял.
describe('S4-35 · показ колонок типа из модели', () => {
  const withTypes = {
    ...model({ sprint: { entries: TASK_CYCLE } }),
    types: { sprint: { label: 'Спринт', fields: [
      { key: 'release', label: 'Релиз', kind: 'ref', visibility: 'visible', display: { priority: 4, width: 's', overflow: 'none' } },
      { key: 'goal', label: 'Цель', kind: 'text', visibility: 'visible', display: { priority: 2, width: 'm', overflow: 'ellipsis' } },
    ] } },
  };

  it('display типа приходит вместе со статусами', async () => {
    const r = await fetchTypeStatuses('sprint', { fetchImpl: net(withTypes) });
    expect(r.display).toEqual({
      release: { priority: 4, width: 's', overflow: 'none' },
      goal: { priority: 2, width: 'm', overflow: 'ellipsis' },
    });
  });

  it('положительный контроль: в модели нет типов — display нет, а не пустой объект', async () => {
    const r = await fetchTypeStatuses('sprint', { fetchImpl: net(model({ sprint: { entries: TASK_CYCLE } })) });
    expect(r.display).toBeUndefined();
  });
});
