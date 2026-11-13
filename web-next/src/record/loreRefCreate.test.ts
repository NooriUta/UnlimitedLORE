// Карточка «Новый» мини-окна ссылок (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW): поля — из
// модели LORE (MD-REQUIRED), правила — слова владелицы 11.11.2026:
//   «если зависимость — можно и без неё, а если это родитель — родитель должен быть»;
//   «автор — кто пишет, не надо лишнего поля, это правило»;
//   «исполнителя выбирает или кнопка себя по умолчанию».
import { describe, expect, it, vi } from 'vitest';
import { createSpecFor, createLoreRecord, CREATABLE, type ModelType } from './loreRefCreate';

/** Подмножество /lore/model types.task.fields — форма LoreRecordRegistry.fieldJson. */
const TASK: ModelType = {
  type: 'task',
  fields: [
    { key: 'title', label: 'Название', kind: 'text', group: 'head', required: true, required_level: 'block' },
    { key: 'status', label: 'Статус', kind: 'enum', group: 'head' },
    { key: 'code', label: 'Код', kind: 'text', group: 'head' },
    { key: 'sprint', label: 'Спринт', kind: 'ref', group: 'props', ref: { type: 'sprint', rel: 'PART_OF', dir: 'out' }, relation: 'composition' },
    { key: 'phase', label: 'Фаза', kind: 'ref', group: 'props', ref: { type: 'phase', rel: 'IN_PHASE', dir: 'out' }, relation: 'attribute' },
    { key: 'components', label: 'Компоненты', kind: 'ref', group: 'props', multi: true, ref: { type: 'component', rel: 'TAGGED_WITH', dir: 'out' }, relation: 'attribute' },
    { key: 'author', label: 'Автор', kind: 'text', group: 'props' },
    { key: 'executor', label: 'Исполнитель', kind: 'text', group: 'props' },
    { key: 'reviewer', label: 'Принимающий', kind: 'text', group: 'props' },
    { key: 'effort', label: 'Оценка', kind: 'number', group: 'props', required_level: 'warn' },
    { key: 'realizes_uc', label: 'Сценарий (UC)', kind: 'ref', group: 'props', multi: true, ref: { type: 'use_case', rel: 'REALIZES', dir: 'out' }, relation: 'realization' },
  ],
};
const ctx = { me: 'arharaga', parents: { sprint: 'SPRINT_X' } };

describe('MD-WINDOW · карточка «Новый» из модели', () => {
  it('задача: код, название, родитель-спринт из контекста, исполнитель «я» с кнопкой «Себя»; автора нет', () => {
    const spec = createSpecFor('task', TASK, ctx, 'ru');
    if (!('fields' in spec)) throw new Error('denied');
    expect(spec.fields.map(f => [f.key, f.required ?? null])).toEqual([
      ['title', 'block'], ['code', 'block'], ['sprint', 'block'], ['executor', 'block'], ['effort', 'warn'],
    ]);
    expect(spec.fields.find(f => f.key === 'sprint')!.value).toBe('SPRINT_X');
    expect(spec.fields.find(f => f.key === 'executor')).toMatchObject({ value: 'arharaga', self: 'arharaga' });
    expect(spec.fields.some(f => f.key === 'author' || f.key === 'reviewer')).toBe(false);
  });

  it('зависимости (attribute, realization) не обязательны и в карточку не просятся', () => {
    const spec = createSpecFor('task', TASK, ctx, 'ru');
    if (!('fields' in spec)) throw new Error('denied');
    expect(spec.fields.some(f => ['phase', 'components', 'realizes_uc'].includes(f.key))).toBe(false);
  });

  it('родителя в контексте нет — поле пустое, но обязательное', () => {
    const spec = createSpecFor('task', TASK, { me: 'arharaga', parents: {} }, 'ru');
    if (!('fields' in spec)) throw new Error('denied');
    expect(spec.fields.find(f => f.key === 'sprint')).toMatchObject({ required: 'block' });
    expect(spec.fields.find(f => f.key === 'sprint')!.value).toBeUndefined();
  });

  it('решение: ADR в модели — зависимость (aggregation), не родитель: из контекста подставлен, но не обязателен', () => {
    const DECISION: ModelType = { type: 'decision', fields: [
      { key: 'title', label: 'Название', kind: 'text', group: 'head' },
      { key: 'adr', label: 'ADR', kind: 'ref', group: 'props', ref: { type: 'adr', rel: 'DECIDED_IN', dir: 'out' }, relation: 'aggregation' },
    ] };
    const inAdr = createSpecFor('decision', DECISION, { me: 'arharaga', parents: { adr: 'ADR-LORE-050' } }, 'ru');
    if (!('fields' in inAdr)) throw new Error('denied');
    expect(inAdr.fields.find(f => f.key === 'adr')).toEqual({ key: 'adr', label: 'ADR', value: 'ADR-LORE-050' });
    const free = createSpecFor('decision', DECISION, { me: 'arharaga', parents: {} }, 'ru');
    if (!('fields' in free)) throw new Error('denied');
    expect(free.fields.some(f => f.key === 'adr')).toBe(false);
  });

  it('модель не загрузилась — сказано словами, а не форма наугад', () => {
    const spec = createSpecFor('task', undefined, ctx, 'ru');
    expect('denied' in spec && spec.denied).toMatch(/модел/i);
  });

  it('тип, который из текста не заводится, — честный отказ, а не форма', () => {
    const spec = createSpecFor('sprint', { type: 'sprint', fields: [] }, ctx, 'ru');
    expect('denied' in spec).toBe(true);
    expect(CREATABLE).toEqual(['task', 'spec', 'adr', 'decision']);
  });

  it('кто пишет — неизвестен (не вошли) — заводить задачу нельзя: автор — правило, а не поле', () => {
    const spec = createSpecFor('task', TASK, { me: null, parents: {} }, 'ru');
    expect('denied' in spec && spec.denied).toMatch(/вход/i);
  });
});

describe('MD-WINDOW · заведение записи на сервере', () => {
  // Проверка «записи с таким кодом нет» (GET фасада) отвечает 404; запись (POST) — телом body.
  const ok = (body: unknown) => vi.fn(async (u: string, i?: RequestInit) => (i?.method === 'POST'
    ? new Response(JSON.stringify(body), { status: 200 })
    : new Response('{}', { status: u.startsWith('/lore/record/') ? 404 : 200 })));
  const posts = (f: ReturnType<typeof ok>) => f.mock.calls.filter(c => c[1]?.method === 'POST');

  it('задача: POST /lore/task, автор — кто пишет, исполнитель — выбранный; ответ — ссылка SPRINT/CODE', async () => {
    const f = ok({ ok: true, task_uid: 'SPRINT_X/T-9', task_id: 'T-9' });
    const r = await createLoreRecord('task', { title: 'Новая', code: 'T-9', sprint: 'SPRINT_X', executor: 'vasilisk' }, ctx, f);
    expect(posts(f)[0][0]).toBe('/lore/task');
    expect(JSON.parse(String(posts(f)[0][1]!.body))).toEqual({
      sprint_id: 'SPRINT_X', task_id: 'T-9', title: 'Новая', author_agent: 'arharaga', executor_agent: 'vasilisk',
    });
    expect(r).toEqual({ ok: true, item: { id: 'SPRINT_X/T-9', type: 'task', title: 'Новая' } });
  });

  it('решение: родитель-ADR уходит в adr_id', async () => {
    const f = ok({ ok: true, decision_id: 'D-1' });
    await createLoreRecord('decision', { title: 'Правило', code: 'D-1', adr: 'ADR-LORE-050' }, ctx, f);
    expect(posts(f)[0][0]).toBe('/lore/decision');
    expect(JSON.parse(String(posts(f)[0][1]!.body))).toMatchObject({ decision_id: 'D-1', title: 'Правило', adr_id: 'ADR-LORE-050' });
  });

  it('спека и ADR — свои пути и имена полей сервера', async () => {
    const f = ok({ ok: true });
    await createLoreRecord('spec', { title: 'Спека', code: 'SPEC-X' }, ctx, f);
    await createLoreRecord('adr', { title: 'Решение архитектуры', code: 'ADR-X' }, ctx, f);
    expect(posts(f).map(c => c[0])).toEqual(['/lore/spec', '/lore/adr']);
    expect(JSON.parse(String(posts(f)[0][1]!.body))).toMatchObject({ spec_id: 'SPEC-X', title: 'Спека' });
    expect(JSON.parse(String(posts(f)[1][1]!.body))).toMatchObject({ adr_id: 'ADR-X', name: 'Решение архитектуры' });
  });

  it('сервер отказал (4xx или ok:false с причиной) — причина словами, окно не закрывается', async () => {
    const bad = vi.fn(async (u: string) => new Response(JSON.stringify({ ok: false, outcome: 'noop', reason: 'задача не создана: такой код уже есть' }), { status: u.startsWith('/lore/record/') ? 404 : 400 }));
    expect(await createLoreRecord('task', { title: 'X', code: 'T-1', sprint: 'S', executor: 'arharaga' }, ctx, bad))
      .toEqual({ ok: false, reason: 'задача не создана: такой код уже есть' });
    const noop = ok({ ok: false, reason: 'нет прав' });
    expect(await createLoreRecord('spec', { title: 'X', code: 'S-1' }, ctx, noop)).toEqual({ ok: false, reason: 'нет прав' });
  });

  it('сервер пишет upsert: код уже занят — POST не уходит, причина словами (иначе запись перепишется)', async () => {
    const f = vi.fn(async (u: string, i?: RequestInit) => new Response('{}', { status: i?.method === 'POST' ? 200 : u.startsWith('/lore/record/') ? 200 : 200 }));
    const r = await createLoreRecord('spec', { title: 'X', code: 'SPEC-TAKEN' }, ctx, f);
    expect(f.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/уже есть/) });
    expect(f.mock.calls[0][0]).toBe('/lore/record/spec/SPEC-TAKEN');
  });

  it('проверить, свободен ли код, не смогли — POST не уходит («не смогли» ≠ «свободно»)', async () => {
    const f = vi.fn(async (_u: string, i?: RequestInit) => new Response('{}', { status: i?.method === 'POST' ? 200 : 502 }));
    const r = await createLoreRecord('adr', { title: 'X', code: 'ADR-Q' }, ctx, f);
    expect(f.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/не смогли проверить/i) });
  });
});
