// SPRINT_LORE_MEASURE_TRUTH/MT-SPRINT-SIZE-GUARD на препроде (пишущий, @writes): «заведение 36-й задачи в спринт
// отвечает отказом со словами, а в спринт с 34 задачами — проходит». Владелица 21.11.2026: «внеси в ограничение
// добавки новых задач в спринт наличие в спринте 35 задач — у нас пухнут мега спринты» (LoreSprintTaskResource,
// SPRINT_TASK_LIMIT = 35, отменённые не в счёт).
//
// Только TEST-данные (writeGuard.ts): спринт TEST_SPRINT_SIZE_GUARD и задачи TEST-SG-NN. Идемпотентно: спринт и
// задачи прошлых прогонов переиспользуются; полный спринт (35) — одна TEST-задача отменяется (cancelled не в счёт),
// и снова 34. Удаления задач в API нет — задачи остаются постоянными тестовыми.
import { expect, test } from '@playwright/test';
import { keepLoginFresh, openStand, requireStand, shot } from './stand.ts';
import { preprodTestWriteRefusal, TEST_ID_RE, WRITES_TAG } from './writeGuard.ts';
import { call, ensureTestProject, TEST_PROJECT_A } from './testData.ts';

test.beforeEach(() => requireStand());
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

const SPRINT = 'TEST_SPRINT_SIZE_GUARD';
const LIMIT = 35;
const taskId = (n: number) => `TEST-SG-${String(n).padStart(2, '0')}`;

interface TaskRow { task_uid?: string; task_id?: string; status_raw?: string | null }
const isCancelled = (t: TaskRow) => /cancel/i.test(String(t.status_raw ?? ''));

test('SG-01 Предел 35 задач спринта: при 34 заведение проходит, 36-я — отказ со словами (SPRINT_LORE_MEASURE_TRUTH/MT-SPRINT-SIZE-GUARD)', { tag: WRITES_TAG }, async ({ page }) => {
  test.setTimeout(600_000);
  const refusal = preprodTestWriteRefusal(process.env.LORE_STAND_URL?.trim(),
    { writer: test.info().tags.includes(WRITES_TAG), ids: [SPRINT, taskId(1), TEST_PROJECT_A] });
  test.skip(refusal !== null, `запись не выполняется: ${refusal}`);
  const note = (d: string) => test.info().annotations.push({ type: 'note', description: d });

  await openStand(page, '/news', page.locator('[data-testid^="news-row-"], .sk-empty, h1'));
  // Спринт — идемпотентно (есть — переиспользуем), под TEST-проектом.
  await ensureTestProject(page, TEST_PROJECT_A);
  const exists = (await call(page, 'GET', `/lore/record/sprint/${SPRINT}`)).status === 200;
  if (!exists) {
    const c = await call(page, 'POST', '/lore/sprint/create', { sprint_id: SPRINT, name: 'Тестовый спринт: предел 35 задач (смоук стенда)', git_project: TEST_PROJECT_A });
    expect(c.status, `завести ${SPRINT}: ${c.text}`).toBe(200);
  } else note(`${SPRINT} уже был — переиспользован`);

  const tasks = async (): Promise<TaskRow[]> => {
    const r = await call(page, 'GET', `/lore/slice/tasks_of_sprint?sprint_id=${SPRINT}&limit=1000`);
    expect(r.status, `tasks_of_sprint ${SPRINT}: ${r.text}`).toBe(200);
    const body = r.body as unknown;
    return (Array.isArray(body) ? body : ((r.body?.rows ?? []) as unknown[])) as TaskRow[];
  };
  const create = (n: number) => {
    const id = taskId(n);
    expect(id, 'только TEST-коды').toMatch(TEST_ID_RE);
    return call(page, 'POST', '/lore/task', { sprint_id: SPRINT, task_id: id, title: `Тестовая задача ${id} (предел спринта)`, work_class: 'enb' });
  };

  let all = await tasks();
  for (const t of all) expect(String(t.task_id ?? t.task_uid ?? ''), 'в тестовом спринте только TEST-задачи').toMatch(/TEST-SG-\d+$/);
  let active = all.filter(t => !isCancelled(t));
  // Полный (35 и больше) — отменить лишние TEST-задачи до 34: отменённые не в счёт.
  while (active.length >= LIMIT) {
    const victim = active[active.length - 1];
    const uid = String(victim.task_uid);
    expect(uid, 'отменяем только TEST-задачу').toMatch(/TEST-SG-\d+$/);
    const s = await call(page, 'POST', '/lore/status', { entity_type: 'task', id: uid, status: 'cancelled', reason: 'смоук стенда MT-SPRINT-SIZE-GUARD: освобождаю место до 34 (TEST-данные)' });
    expect(s.status, `отменить ${uid}: ${s.text}`).toBe(200);
    note(`отменена ${uid}, чтобы снова было 34`);
    all = await tasks();
    active = all.filter(t => !isCancelled(t));
  }
  // Добить до 34 новыми кодами (занятые, в том числе отменённые, не повторяем).
  const used = new Set(all.map(t => Number(/TEST-SG-(\d+)$/.exec(String(t.task_id ?? t.task_uid))?.[1] ?? 0)));
  let next = 1;
  const freshId = () => { while (used.has(next)) next++; used.add(next); return next; };
  while (active.length < LIMIT - 1) {
    const r = await create(freshId());
    expect(r.status, `добить до 34: ${r.text}`).toBe(200);
    active = (await tasks()).filter(t => !isCancelled(t));
  }
  expect(active.length, 'в спринте 34 задачи (без отменённых)').toBe(LIMIT - 1);

  // При 34 — заведение проходит (35-я).
  const ok = await create(freshId());
  expect(ok.status, `при 34 заведение проходит: ${ok.text}`).toBe(200);
  expect((await tasks()).filter(t => !isCancelled(t)).length, 'стало 35').toBe(LIMIT);

  // 36-я — отказ 400 со словами про предел 35; задача не появилась.
  const n36 = freshId();
  const no = await create(n36);
  expect(no.status, `36-я задача: ${no.text}`).toBe(400);
  expect(no.text, 'отказ называет предел').toMatch(/предел 35/);
  expect(no.text, 'и что отменённые не в счёт').toMatch(/отменённые не в счёт/);
  expect((await tasks()).some(t => String(t.task_uid).endsWith(taskId(n36))), 'отказанная задача не легла').toBe(false);
});
