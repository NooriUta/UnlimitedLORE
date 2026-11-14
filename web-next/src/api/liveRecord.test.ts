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

/**
 * Часть в СЫРОМ виде сервера — нарочно не клиентский `LorePart`.
 *
 * Тип нужен только затем, чтобы `count: null` (а сервер присылает именно null
 * при не-ok) не выводился как `number` из первого примера фикстуры. Проверяем
 * ответ сервера, а не свой тип: в этом и смысл слоя перевода.
 */
type RawPart = {
  key: string; label: string; type?: string; rel: string; dir: string;
  owned?: boolean; relation?: string; state: string; error?: string;
  count: number | null; items: unknown[];
};

/** Ответ сервера на спринт — ключи и вложенность как в LoreRecordResource. */
const sprintBody = () => ({
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_A', title: 'Спринт А', status: 'active', version: '2026-11-08T10:00:00Z' },
  values: { title: 'Спринт А', status: 'active', context_md: 'контекст', track: 'UXR' },
  parts: [{
    key: 'tasks', label: 'Задачи', type: 'task', rel: 'PART_OF', dir: 'in', owned: true,
    relation: 'composition', state: 'ok', count: 1,
    items: [{ id: 'SPRINT_A/A-1', title: 'Задача', status: 'done', values: { code: 'A-1', effort: 1 } }],
  }] as RawPart[],
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
      { key: 'no_release', label: 'Не требует релиза', label_key: 'f.no_release', kind: 'bool', group: 'props', required: false, editable: true, write: { field: 'no_release' } },
    ],
    layout: {},
    relations: [
      { key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'PART_OF', dir: 'in', target_type: 'task', place: 'part', manageable: false },
      { key: 'projects', label: 'Проекты', relation: 'association', rel: 'IN_PROJECT', dir: 'out', target_type: 'git_project', place: 'prop', manageable: true },
      { key: 'depends_on', label: 'Зависит от', relation: 'dependency', rel: 'DEPENDS_ON', dir: 'out', target_type: 'sprint', place: 'link_tab', manageable: true },
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

  it('MC-08: вид bool доходит до kit как bool, а не сваливается в text', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.schema.fields.find(f => f.key === 'no_release')?.kind).toBe('bool');
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

  // Фикстура приведена к ПОДТВЕРЖДЁННЫМ значениям place (серверная сессия
  // сверила по коду 09.11.2026): у задач — "part", у проектов — "prop", у
  // зависимостей — "link_tab". Прежде здесь стояли мои догадки («links» и
  // «link_tab» у задач), и тест закреплял их, а не поведение сервера.
  it('вкладка связей — только у place "link_tab"; часть вкладкой связей не становится', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.schema.tabs.map(t => [t.key, t.zone, t.rel])).toEqual([['depends_on', 'record', 'DEPENDS_ON']]);
    // Задачи — ЧАСТЬ: их элементы приходят в parts[], а не в links, и вкладку
    // по ним рисует паспорт из части. Вкладка связей тут показала бы пусто.
    expect(c.schema.tabs.find(t => t.key === 'tasks')).toBeUndefined();
    // Свойство (проекты) вкладкой не бывает вовсе.
    expect(c.schema.tabs.find(t => t.key === 'projects')).toBeUndefined();
  });

  it('счётчик связи считается из links — сервер его не присылает', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.schema.relations.find(r => r.key === 'tasks')?.count).toBe(1);
    expect(c.schema.relations.find(r => r.key === 'depends_on')?.count).toBe(1);
  });

  // Слово владелицы 11.11 («связь с компонентами пропала»): у компонента BELONGS_TO:in — ADR,
  // спринты, решения… Одно ребро, разные связи; счёт — по типу цели, а не по ребру.
  it('вид концов связи (fromKind/toKind) доходит от сервера — kit не угадывает его по записям', () => {
    const b = sprintBody();
    b.links = [{ rel: 'BELONGS_TO', dir: 'in', id: 'D-1', type: 'decision', title: 'Р', status: '', fromKind: 'decision', toKind: 'component' } as never];
    const c = recordFromServer(b, LOADED);
    expect(c.links[0]).toMatchObject({ fromKind: 'decision', toKind: 'component' });
  });

  it('одно ребро в двух связях — счётчик по типу цели', () => {
    const b = sprintBody();
    b.links = [
      { rel: 'BELONGS_TO', dir: 'in', id: 'ADR-1', type: 'adr', title: 'ADR', status: '' },
      { rel: 'BELONGS_TO', dir: 'in', id: 'S-1', type: 'sprint', title: 'S', status: '' },
      { rel: 'BELONGS_TO', dir: 'in', id: 'S-2', type: 'sprint', title: 'S2', status: '' },
    ];
    b.schema.relations = [
      { key: 'adrs', label: 'ADR', relation: 'attribute', rel: 'BELONGS_TO', dir: 'in', target_type: 'adr', place: 'link_tab', manageable: false },
      { key: 'sprints', label: 'Спринты', relation: 'attribute', rel: 'BELONGS_TO', dir: 'in', target_type: 'sprint', place: 'link_tab', manageable: false },
    ];
    const c = recordFromServer(b, LOADED);
    expect(c.schema.relations.find(r => r.key === 'adrs')?.count).toBe(1);
    expect(c.schema.relations.find(r => r.key === 'sprints')?.count).toBe(2);
  });

  it('подпись поля — label, а не label_key: ключ человеку не показывают', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    const labels = c.schema.fields.map(f => f.label);
    // «Контекст» — единственное правимое поле тела спринта, и оно становится
    // телом записи (values.body_md), поэтому в списке полей его больше нет:
    // иначе текст задвоился бы разделом поверх самого себя. Разбор этого
    // переноса — в record/bodyEditableAfterFacade.test.ts.
    expect(labels).toEqual(['Название', 'Дорожка', 'Не требует релиза']);
    expect(JSON.stringify(c.schema.fields)).not.toContain('rec.sprint');
    expect(c.schema.fields.find(f => f.key === 'track')?.section).toBe('Планирование');
  });

  // Раньше этот тест требовал, чтобы «open» ОТБРАСЫВАЛСЯ. Так было написано,
  // пока клиент считал задачи сам; с дефекта прода v1.17.8 («Задач нет» при 48
  // задачах) числа сервера сильнее пересчёта, и open — одно из них. Считать его
  // как total − done нельзя: отменённые задачи в total не входят.
  it('факты задач берутся у сервера целиком — вместе с open', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    expect(c.facts?.tasks).toEqual({ done: 1, total: 1, open: 0 });
  });

  // Дефект прода v1.17.8 (CJM соседней сессии по живому ответу
  // /lore/record/sprint/SPRINT_AIDA_PREPROD_MIGRATION): «Задач нет», «Фазы 0»,
  // «Проекты 0». ПРИЧИНА — этот слой: задачи и фазы приходят в parts[], а
  // перевод их молча терял, как и слово place у связей.
  it('части записи (parts) переводятся, а не теряются', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    const tasks = c.parts?.find(x => x.key === 'tasks');
    expect(tasks, 'часть «Задачи» в ответе была — должна дойти').toBeDefined();
    expect(tasks!.items.map(i => i.id)).toEqual(['SPRINT_A/A-1']);
    expect(tasks!.state).toBe('ok');
    expect(tasks!.count).toBe(1);
  });

  it('место связи (place) доносится: по нему решают — свойство, часть или вкладка', () => {
    const c = recordFromServer(sprintBody(), LOADED);
    const by = (k: string) => c.schema.relations.find(r => r.key === k);
    expect(by('tasks')?.place).toBe('part');
    expect(by('projects')?.place).toBe('prop');
    expect(by('depends_on')?.place).toBe('link_tab');
    expect(by('tasks')?.target_type).toBe('task');
  });

  it('у части число берётся у неё самой: её элементы в links не приходят', () => {
    const body = sprintBody();
    // Как на проде: задачи есть, а в links их нет — там только вкладки связей.
    body.links = body.links.filter(l => l.rel !== 'HAS_TASK');
    const c = recordFromServer(body, LOADED);
    expect(c.schema.relations.find(r => r.key === 'tasks')?.count).toBe(1);
  });

  it('часть не прочиталась: denied и error различимы, count не ноль, а null', () => {
    const body = sprintBody();
    body.parts = [
      { key: 'tasks', label: 'Задачи', rel: 'PART_OF', dir: 'in', state: 'denied', error: 'tasks_of_sprint: нет разрешённых проектов', count: null, items: [] },
      { key: 'phases', label: 'Фазы', rel: 'PART_OF', dir: 'in', state: 'error', error: 'phases_of_sprint: 502', count: null, items: [] },
    ] as RawPart[];
    const c = recordFromServer(body, LOADED);
    const t = c.parts!.find(x => x.key === 'tasks')!;
    const f = c.parts!.find(x => x.key === 'phases')!;
    expect(t.state).toBe('denied');
    expect(t.count).toBeNull();
    expect(t.error).toContain('разрешённых');
    expect(f.state).toBe('error');
    expect(f.error).toContain('502');
  });

  it('незнакомое state у части — названная ошибка, а не «всё хорошо»', () => {
    const body = sprintBody();
    body.parts = [{ key: 'tasks', label: 'Задачи', rel: 'PART_OF', dir: 'in', state: 'partially_maybe', count: null, items: [] }] as RawPart[];
    const c = recordFromServer(body, LOADED);
    const t = c.parts!.find(x => x.key === 'tasks')!;
    expect(t.state).toBe('error');
    expect(t.error).toContain('partially_maybe');
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
