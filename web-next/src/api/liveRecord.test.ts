// Боевой паспорт: GET /lore/record → LoreRecord1
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST, ADR-LORE-048 п. 5).
//
// Тест написан против ФОРМЫ СЕРВЕРА, снятой с кода, а не против клиентского
// типа. Повод — находка 09.11 по графу: `record/backlinksGraph.ts` объявлял
// себя заглушкой, но транспорт уже был живой, и разбор шёл по несуществующему
// контракту (`edge_type` вместо `edge`, `id` вместо `ref_id`). Получились узлы
// с `undefined` вместо кодов. Повторять это нельзя, поэтому ответы здесь
// собраны по `LoreRecordResource.envelope` / `LoreRecordRegistry.schemaJson`.
//
// Расхождения, которые этот слой обязан перевести (сверено по коду бэкенда):
//
//   клиентский LoreRecord1          сервер /lore/record
//   record.version: число           СТРОКА — valid_from открытого состояния
//   meta.loaded_at                  нет: сервер не говорит, когда прочитал
//   meta.sources: массив            meta.sources = {block: [...]}, отдельно meta.data_state
//   schema.tabs                     нет: вкладки — поведение (ADR-LORE-048), есть relations[].place
//   schema.relations[].count        нет: считается из links
//   facts.tasks {done,total}        {done,total,open}
import { describe, expect, it } from 'vitest';
import { fetchLoreRecord, recordFromServer, RecordNotFound, RecordForbidden, RecordShape } from './liveRecord';

const LOADED = '2026-11-09T04:00:00.000Z';

/** Ответ сервера на спринт — ключи и вложенность как в LoreRecordResource. */
const sprintBody = () => ({
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_A', title: 'Спринт А', status: 'active', version: '2026-11-08T10:00:00Z' },
  values: { title: 'Спринт А', status: 'active', context_md: 'контекст', track: 'UXR' },
  parts: [{ key: 'tasks', label: 'Задачи', items: [{ id: 'SPRINT_A/A-1', title: 'Задача', status: 'done' }] }],
  links: [
    { rel: 'HAS_TASK', dir: 'out', id: 'SPRINT_A/A-1', type: 'task', title: 'Задача', status: 'done' },
    { rel: 'DEPENDS_ON', dir: 'out', id: 'SPRINT_B', type: 'sprint', title: 'Спринт Б', status: 'active' },
  ],
  perms: { can_edit: true, can_status: true, can_create: true, status_next: ['done'], reason: null },
  facts: { tasks: { done: 1, total: 1, open: 0 } },
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'sprint-icon',
    fields: [
      { key: 'title', label: 'Название', label_key: 'f.title', kind: 'text', group: 'head', required: true, editable: true, write: { field: 'name' } },
      { key: 'track', label: 'Дорожка', label_key: 'f.track', kind: 'ref', group: 'props', section: 'Планирование', required: false, editable: true, write: null },
      { key: 'context_md', label: 'Контекст', label_key: 'f.context', kind: 'md', group: 'body', required: false, editable: true, write: { field: 'context_md' } },
    ],
    layout: {},
    relations: [
      { key: 'tasks', label: 'Задачи', relation: 'aggregation', rel: 'HAS_TASK', dir: 'out', target_type: 'task', place: 'link_tab', manageable: false },
      { key: 'depends_on', label: 'Зависит от', relation: 'dependency', rel: 'DEPENDS_ON', dir: 'out', target_type: 'sprint', place: 'links', manageable: true },
    ],
  },
  meta: {
    facade: 'server',
    sources: { block: ['tasks', 'adrs'] },
    data_state: [
      { source: 'tasks_of_sprint', part: 'tasks', state: 'ok' },
      { source: 'adrs_of_task', part: 'adrs', state: 'forbidden', reason: 'проектный скоуп' },
    ],
  },
});

const reply = (body: unknown, status = 200) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('S4-MODEL-PASSPORT-LIST · форма сервера → контракт паспорта', () => {
  it('положительный контроль: разбор даёт объект контракта, а не пустышку', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.contract).toBe('lore.record/1');
    expect(c.record).toMatchObject({ type: 'sprint', id: 'SPRINT_A', title: 'Спринт А', status: 'active' });
    expect(c.meta.facade).toBe('server');
  });

  it('версия — строка сервера, а не число и не null: без неё не работает защита от затирания', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.record.version).toBe('2026-11-08T10:00:00Z');
  });

  it('когда прочитали — время клиента: сервер об этом не говорит, и выдумывать его за сервер нельзя', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.meta.loaded_at).toBe(LOADED);
  });

  it('data_state приходит состояниями: «нет прав» остаётся «нет прав»', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    const forbidden = c.meta.sources.find(s => s.block === 'adrs_of_task · adrs');
    expect(forbidden?.state).toBe('forbidden');
    expect(forbidden?.reason).toBe('проектный скоуп');
    expect(c.meta.sources.find(s => s.block === 'tasks_of_sprint · tasks')?.state).toBe('ok');
  });

  it('вкладки строит клиент по relations[].place: модель вкладок не знает', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.schema.tabs.map(t => [t.key, t.zone, t.rel])).toEqual([['tasks', 'record', 'HAS_TASK']]);
    // «links» — не вкладка: это связи, они живут своим блоком.
    expect(c.schema.tabs.find(t => t.key === 'depends_on')).toBeUndefined();
  });

  it('счётчик связи считается из links — сервер его не присылает', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.schema.relations.find(r => r.key === 'tasks')?.count).toBe(1);
    expect(c.schema.relations.find(r => r.key === 'depends_on')?.count).toBe(1);
  });

  it('подпись поля — label, а не label_key: ключ человеку не показывают', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    const labels = c.schema.fields.map(f => f.label);
    // «Контекст» — единственное правимое поле тела спринта, и оно становится
    // телом записи (values.body_md), поэтому в списке полей его больше нет:
    // иначе текст задвоился бы разделом поверх самого себя. Разбор этого
    // переноса — в record/bodyEditableAfterFacade.test.ts.
    expect(labels).toEqual(['Название', 'Дорожка']);
    expect(JSON.stringify(c.schema.fields)).not.toContain('rec.sprint');
    expect(c.schema.fields.find(f => f.key === 'track')?.section).toBe('Планирование');
  });

  it('факты задач берутся сервером, лишний «open» не теряет done/total', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.facts?.tasks).toEqual({ done: 1, total: 1 });
  });

  it('объект остаётся данными: ни одной функции, иначе kit нарисует не из контракта', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  // Поймано прогоном тестов паспорта 09.11: подставная сеть отвечала на
  // /lore/record телом СРЕЗА, разбор прошёл «успешно» и дал запись с пустым
  // типом и пустым кодом — паспорт нарисовался пустым. На живом сервере то же
  // даст любой 200 не того вида: прокси с html-страницей, старая версия
  // приложения, чужой эндпоинт. Пустой паспорт неотличим от записи без полей,
  // поэтому ответ не того вида — отказ по имени, а не «разберём, что дали».
  it('200 с ответом не того вида — отказ, а не пустой паспорт', () => {
    expect(() => recordFromServer({ rows: [{ sprint_id: 'SPRINT_A' }] }, LOADED)).toThrow(RecordShape);
  });

  it('тот же отказ, если контракт назван, а записи в ответе нет', () => {
    expect(() => recordFromServer({ contract: 'lore.record/1', record: {} }, LOADED)).toThrow(RecordShape);
  });

  it('чужая версия контракта не разбирается молча', () => {
    const body = { ...sprintBody(), contract: 'lore.record/2' };
    expect(() => recordFromServer(body, LOADED)).toThrow(RecordShape);
  });

  it('неизвестное состояние блока не выдаётся за «прочитано»', () => {
    const body = sprintBody();
    body.meta.data_state = [{ source: 'tasks_of_sprint', part: 'tasks', state: 'весьма странно' } as never];
    const c = recordFromServer(body, LOADED);
    const row = c.meta.sources[0];
    expect(row.state).toBe('error');
    expect(row.reason).toContain('весьма странно');
  });
});

describe('S4-MODEL-PASSPORT-LIST · отказы называются словами', () => {
  it('404 — «записи нет», отдельным типом, а не пустым паспортом', async () => {
    await expect(fetchLoreRecord('sprint', 'НЕТУ', { fetchImpl: reply({ error: 'NOT_FOUND', detail: 'не найден' }, 404), now: () => LOADED }))
      .rejects.toBeInstanceOf(RecordNotFound);
  });

  it('403 SCOPE_EMPTY — «нет прав», а не «не найдено»: это разные ответы человеку', async () => {
    await expect(fetchLoreRecord('sprint', 'SPRINT_A', { fetchImpl: reply({ error: 'SCOPE_EMPTY', detail: 'скоуп пуст' }, 403), now: () => LOADED }))
      .rejects.toBeInstanceOf(RecordForbidden);
  });

  it('502 от апстрима — громкая ошибка с причиной, не тихая пустота', async () => {
    await expect(fetchLoreRecord('sprint', 'SPRINT_A', { fetchImpl: reply({ error: 'UPSTREAM', detail: 'база молчит' }, 502), now: () => LOADED }))
      .rejects.toThrow(/база молчит/);
  });

  it('фасад выключен (501) — тоже слышно', async () => {
    await expect(fetchLoreRecord('sprint', 'SPRINT_A', { fetchImpl: reply({ error: 'DISABLED', detail: 'фасад выключен' }, 501), now: () => LOADED }))
      .rejects.toThrow(/фасад выключен/);
  });

  it('удачный запрос идёт по адресу типа и кода и отдаёт разобранный паспорт', async () => {
    const seen: string[] = [];
    const http = (async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(sprintBody()), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const c = await fetchLoreRecord('sprint', 'SPRINT_A', { fetchImpl: http, now: () => LOADED });
    expect(seen[0]).toBe('/lore/record/sprint/SPRINT_A');
    expect(c.record.id).toBe('SPRINT_A');
  });

  it('код записи с дробью уходит в адрес неискажённым — у задачи он «спринт/код»', async () => {
    const seen: string[] = [];
    const http = (async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(sprintBody()), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await fetchLoreRecord('task', 'SPRINT_A/A-1', { fetchImpl: http, now: () => LOADED });
    // Сервер принимает id как {id: .+}: дробь — часть кода, кодировать её нельзя.
    expect(seen[0]).toBe('/lore/record/task/SPRINT_A/A-1');
  });
});
