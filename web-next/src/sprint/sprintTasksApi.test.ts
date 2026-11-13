// SPRINT_UXR_S5_RECORD_TASKS/S5-02 — данные вкладки «Задачи»: чтение слайсов
// tasks_of_sprint + phases_of_sprint и запись через существующие эндпоинты
// задачи (POST /lore/status, POST /lore/task/edit). Ошибки не глотаются:
// статус HTTP доезжает до экрана (403 → «нет прав», остальное → «ошибка»).
import { describe, expect, it, vi } from 'vitest';
import { classifyError, errorDetail } from '@seidr/kit';
import { editTask, loadSprintTasks, LoreHttpError, setTaskStatus, toTaskRow } from './sprintTasksApi';

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url, 'http://x').pathname;
    const r = routes[path];
    if (!r) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const apiTask = {
  task_uid: 'u1', task_id: 'S5-02', title: 'Вкладка задач', order_index: 2, phase_uid: 'ph-1',
  status_raw: 'todo', effort_days: 1.5, note_md: null, component_ids: null,
  executor_agent: 'claude', reviewer_agent: null, task_type: 'feature', work_class: 'enb',
};

describe('toTaskRow', () => {
  it('переводит строку слайса в строку таблицы', () => {
    expect(toTaskRow(apiTask)).toEqual({
      uid: 'u1', id: 'S5-02', title: 'Вкладка задач', status: 'todo', phase: 'ph-1',
      effortDays: 1.5, executor: 'claude', reviewer: null, taskType: 'feature', workClass: 'enb', order: 2,
    });
  });

  // S4-36: класс работы приезжает из того же среза, что и тип задачи. Без него
  // строка не покажет плашку, а отсутствие класса — обычное дело (не ошибка).
  it('класса работы нет в срезе — null, а не пустая строка', () => {
    const { work_class: _omit, ...withoutClass } = apiTask;
    expect(toTaskRow(withoutClass).workClass).toBeNull();
  });

  it('класс работы не теряется и не переименовывается', () => {
    expect(toTaskRow({ ...apiTask, work_class: 'uc' }).workClass).toBe('uc');
  });
});

describe('loadSprintTasks', () => {
  it('читает оба слайса по sprint_id; метаданные полноты слайса задач сохраняются', async () => {
    const { impl, calls } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { body: { rows: [apiTask], truncated: true, limit: 500 } },
      '/lore/slice/phases_of_sprint': { body: { rows: [{ phase_uid: 'ph-1', phase_id: 'P1', order_index: 1, title: 'Разведка' }] } },
    });
    const res = await loadSprintTasks('SPRINT_X', undefined, impl);
    expect(calls.map(c => c.url).sort()).toEqual([
      '/lore/slice/phases_of_sprint?sprint_id=SPRINT_X',
      '/lore/slice/tasks_of_sprint?sprint_id=SPRINT_X',
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe('S5-02');
    expect(res.phases).toEqual([{ uid: 'ph-1', id: 'P1', title: 'Разведка', order: 1 }]);
    expect(res.truncated).toBe(true);
    expect(res.limit).toBe(500);
  });

  it('403 — LoreHttpError со статусом: kit классифицирует как «нет прав»', async () => {
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { status: 403, body: { error: 'FORBIDDEN', detail: 'вне ваших проектов' } },
      '/lore/slice/phases_of_sprint': { body: { rows: [] } },
    });
    const err = await loadSprintTasks('S', undefined, impl).catch(e => e);
    expect(err).toBeInstanceOf(LoreHttpError);
    expect(classifyError(err)).toBe('forbidden');
  });

  it('сбой слайса фаз — это сбой загрузки, а не «задачи без фаз»', async () => {
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { body: { rows: [apiTask] } },
      '/lore/slice/phases_of_sprint': { status: 500, body: { error: 'LORE_UPSTREAM', detail: 'db down' } },
    });
    const err = await loadSprintTasks('S', undefined, impl).catch(e => e);
    expect(classifyError(err)).toBe('error');
    expect(errorDetail(err)).toMatch(/HTTP 500/);
    expect(errorDetail(err)).toMatch(/db down/);
  });

  it('не-JSON ответ (SPA-заглушка прокси) — ошибка, а не пустая выдача', async () => {
    const impl = vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(loadSprintTasks('S', undefined, impl as unknown as typeof fetch)).rejects.toBeInstanceOf(LoreHttpError);
  });
});

describe('setTaskStatus', () => {
  it('POST /lore/status {entity_type:task, id:task_uid, status}', async () => {
    const { impl, calls } = fakeFetch({ '/lore/status': { body: { ok: true, new_status: 'done' } } });
    await setTaskStatus('u1', 'done', impl);
    expect(calls[0].url).toBe('/lore/status');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ entity_type: 'task', id: 'u1', status: 'done' });
  });

  it('409 (гейт ревьюера) — ошибка с текстом сервера', async () => {
    const { impl } = fakeFetch({ '/lore/status': { status: 409, body: { error: 'CONFLICT', detail: 'reviewer must differ' } } });
    const err = await setTaskStatus('u1', 'done', impl).catch(e => e);
    expect(errorDetail(err)).toBe('HTTP 409 · reviewer must differ');
  });
});

describe('editTask', () => {
  const row = toTaskRow(apiTask);

  it('POST /lore/task/edit: title всегда (бэкенд требует), неизменённое — null («не трогать»)', async () => {
    const { impl, calls } = fakeFetch({ '/lore/task/edit': { body: { ok: true, task_uid: 'u1' } } });
    await editTask(row, { effortDays: 3 }, impl);
    expect(calls[0].url).toBe('/lore/task/edit');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      task_uid: 'u1', title: 'Вкладка задач', note_md: null, effort_days: 3,
    });
  });

  // PU-17: роли — рёбра заявленных личностей, правка только выбором в паспорте задачи; строки ролей
  // из правки строки не уходят вовсе (null на сервере значил «не трогать», но поле в теле — приглашение к тексту).
  it('изменённый заголовок уходит значением; строк ролей в теле нет (PU-17)', async () => {
    const { impl, calls } = fakeFetch({ '/lore/task/edit': { body: { ok: true } } });
    await editTask(row, { title: 'Новое' }, impl);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.title).toBe('Новое');
    expect('reviewer_agent' in body).toBe(false);
    expect('executor_agent' in body).toBe(false);
  });
});
