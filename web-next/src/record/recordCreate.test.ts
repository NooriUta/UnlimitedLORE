// Создание записи в v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): логика записи.
//
// Закрепляется три ловушки сервера и правило «ошибка словами, набранное
// не теряется»:
//   - POST /lore/adr — UPSERT: на существующий код перепишет чужой ADR, поэтому
//     код проверяется ДО записи, и «не смогли проверить» — отказ, а не запись;
//   - sprint/create на существующий код отвечает created:false — это «уже есть»;
//   - право создать — perms.can_create паспорта `_new`.
import { describe, expect, it, vi } from 'vitest';
import {
  createFields, createRequest, createdId, fetchCanCreate, fetchSprintOptions, isCreateType, missingRequired, saveCreate,
} from './recordCreate';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Сеть по адресу: probe — ответ на чтение паспорта, write — на запись. */
function net(probe: number, write: Response | (() => Response)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('/lore/record/')) return json(probe, probe === 200 ? { record: {} } : { error: 'NOT_FOUND' });
    return typeof write === 'function' ? write() : write;
  }) as unknown as typeof fetch;
  return { impl, calls, posts: () => calls.filter(c => c.init?.method === 'POST') };
}

describe('S4-24 · поля черновика — инвентаризация форм v1', () => {
  it('спринт: код и название обязательны; MD — «Контекст» и «Итог»', () => {
    const f = createFields('sprint', 'ru', { status: [{ value: 'todo', label: 'К работе' }] });
    expect(f.filter(x => x.required === 'block').map(x => x.key)).toEqual(['id', 'title']);
    expect(f.filter(x => x.kind === 'md').map(x => x.key)).toEqual(['context_md', 'outcome_md']);
  });

  it('ADR: три раздела тела — MD; задача: спринт, код и название обязательны', () => {
    expect(createFields('adr', 'ru').filter(x => x.kind === 'md').map(x => x.key))
      .toEqual(['context_md', 'decision_md', 'consequences_md']);
    expect(createFields('task', 'ru').filter(x => x.required === 'block').map(x => x.key))
      .toEqual(['sprint_id', 'id', 'title']);
  });

  it('статус — только из цикла модели; цикла нет — поля статуса нет (умолчание ставит сервер)', () => {
    expect(createFields('adr', 'ru').some(x => x.key === 'status')).toBe(false);
    const withCycle = createFields('adr', 'ru', { status: [{ value: 'proposed', label: 'Предложено' }] });
    expect(withCycle.find(x => x.key === 'status')?.options).toEqual([{ value: 'proposed', label: 'Предложено' }]);
  });

  it('пустые и пробельные обязательные названы ключами', () => {
    expect(missingRequired('sprint', { id: '  ', title: 'x' })).toEqual(['id']);
    expect(missingRequired('sprint', { id: 'S_X', title: 'x' })).toEqual([]);
  });

  it('код задачи после создания — пара «спринт/код»', () => {
    expect(createdId('task', { sprint_id: 'SPRINT_A', id: 'T-1' })).toBe('SPRINT_A/T-1');
  });

  it('тело записи — по путям v1, пустые необязательные не отправляются', () => {
    expect(createRequest('sprint', { id: 'S_X', title: ' Икс ', context_md: '' }))
      .toEqual({ url: '/lore/sprint/create', body: { sprint_id: 'S_X', name: 'Икс' } });
    expect(createRequest('adr', { id: 'ADR-X', title: 'A', decision_md: 'd' }))
      .toEqual({ url: '/lore/adr', body: { adr_id: 'ADR-X', name: 'A', decision_md: 'd' } });
  });
});

describe('S4-24 · запись: проверка кода, отказы словами', () => {
  it('код свободен (404) — POST по пути типа, успех открывает созданную запись', async () => {
    const n = net(404, json(200, { ok: true, adr_id: 'ADR-X' }));
    const r = await saveCreate('adr', { id: 'ADR-X', title: 'A' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r).toEqual({ ok: true, id: 'ADR-X' });
    expect(n.posts()).toHaveLength(1);
    expect(n.posts()[0].url).toBe('/lore/adr');
  });

  it('ADR с таким кодом уже есть — НЕ пишем: POST /lore/adr перезаписал бы чужой ADR', async () => {
    const n = net(200, json(200, { ok: true }));
    const r = await saveCreate('adr', { id: 'ADR-LORE-001', title: 'A' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe('exists');
    expect(n.posts()).toHaveLength(0);
  });

  it('проверить код не удалось (502) — отказ «не смогли проверить», а не запись вслепую', async () => {
    const n = net(502, json(200, { ok: true }));
    const r = await saveCreate('adr', { id: 'ADR-X', title: 'A' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r.ok === false && r.kind).toBe('unchecked');
    expect(r.ok === false && r.reason).toMatch(/502/);
    expect(n.posts()).toHaveLength(0);
  });

  it('спринт: created:false — это «уже есть», а не успех', async () => {
    const n = net(404, json(200, { ok: true, sprint_id: 'S_X', created: false }));
    const r = await saveCreate('sprint', { id: 'S_X', title: 'x' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r.ok === false && r.kind).toBe('exists');
  });

  it('отказ сервера — причина с кодом и текстом сервера', async () => {
    const n = net(404, json(400, { error: 'BAD_PARAMS', message: 'sprint_id contains illegal characters' }));
    const r = await saveCreate('sprint', { id: 'S X', title: 'x' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r.ok === false && r.reason).toMatch(/400/);
    expect(r.ok === false && r.reason).toMatch(/illegal characters/);
  });

  it('нет прав (403) — отдельный исход, не «ошибка сети»', async () => {
    const n = net(404, json(403, { error: 'FORBIDDEN' }));
    const r = await saveCreate('task', { sprint_id: 'S', id: 'T', title: 't' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r.ok === false && r.kind).toBe('forbidden');
  });

  it('обязательные пусты — в сеть не ходим вовсе', async () => {
    const n = net(404, json(200, { ok: true }));
    const r = await saveCreate('sprint', { id: 'S_X' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r.ok).toBe(false);
    expect(n.calls).toHaveLength(0);
  });
});

// Слово владелицы 11.11: «там, где значения задаются рёбрами, нужно сделать
// dropdown, а не корректировку текста». Спринт задачи — ребро PART_OF.
describe('S4-24 · спринт новой задачи — выбор из списка, не текст', () => {
  it('спринт — выбор (enum) с вариантами из среза; вариантов нет — только чтение, без поля ввода', () => {
    const withSprints = createFields('task', 'ru', { sprints: [{ value: 'S_A', label: 'S_A · Альфа' }] }).find(f => f.key === 'sprint_id');
    expect(withSprints?.kind).toBe('enum');
    expect(withSprints?.editable).toBe(true);
    expect(withSprints?.options).toEqual([{ value: 'S_A', label: 'S_A · Альфа' }]);
    const none = createFields('task', 'ru').find(f => f.key === 'sprint_id');
    expect(none?.kind).toBe('enum');
    expect(none?.editable).toBe(false);
  });

  it('варианты — срез sprints без закрытых: в закрытый спринт сервер задачу не примет', async () => {
    const f = vi.fn(async () => json(200, { rows: [
      { sprint_id: 'S_OPEN', name: 'Открытый', status_raw: '🔄 IN PROGRESS' },
      { sprint_id: 'S_DONE', name: 'Готовый', status_raw: '✅ DONE' },
      { sprint_id: 'S_X', name: 'Отменён', status_raw: '🚫 CANCELLED' },
    ] })) as unknown as typeof fetch;
    const r = await fetchSprintOptions(f);
    expect(r.options.map(o => o.value)).toEqual(['S_OPEN']);
    expect(r.note).toBeUndefined();
  });

  it('срез не прочитался — пусто и причина, а не тихий пустой список', async () => {
    const f = vi.fn(async () => json(502, { error: 'UPSTREAM', message: 'база недоступна' })) as unknown as typeof fetch;
    const r = await fetchSprintOptions(f);
    expect(r.options).toEqual([]);
    expect(r.note).toBeTruthy();
  });
});

describe('S4-24 · право создать — perms.can_create паспорта _new', () => {
  it('can_create:true — можно; false — нельзя, с причиной сервера', async () => {
    const yes = vi.fn(async () => json(200, { perms: { can_create: true } })) as unknown as typeof fetch;
    expect(await fetchCanCreate('sprint', yes)).toEqual({ can: true });
    const no = vi.fn(async () => json(200, { perms: { can_create: false, reason: 'нет прав' } })) as unknown as typeof fetch;
    expect(await fetchCanCreate('sprint', no)).toEqual({ can: false, reason: 'нет прав' });
  });

  it('спросить не удалось — нельзя: кнопка, которая откажет после заполнения, хуже её отсутствия', async () => {
    const down = vi.fn(async () => json(502, { error: 'UPSTREAM' })) as unknown as typeof fetch;
    expect((await fetchCanCreate('adr', down)).can).toBe(false);
  });

  it('спрашивает именно паспорт `_new` своего типа', async () => {
    const f = vi.fn(async () => json(200, { perms: { can_create: true } })) as unknown as typeof fetch;
    await fetchCanCreate('task', f);
    expect(String((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe('/lore/record/task/_new');
  });
});

// S4-24 (решение 14.11.2026): «Новая» для решений и спек. Форма та же; появляется сама, когда
// сервер отдаст паспорт создания `_new` с can_create (model-config, ветка feat/s4-24-new-decision-spec).
// Поля и имена тела — по блоку create модели: decision {title→title, projects→project, adr→adr_id},
// require_one_of [projects, adr]; spec {title, projects→project, summary}, require_one_of [projects].
describe('S4-24 · решения и спеки — та же форма, контракт блока create сервера', () => {
  it('типы создания включают решение и спеку', () => {
    expect(isCreateType('decision')).toBe(true);
    expect(isCreateType('spec')).toBe(true);
  });
  it('решение: код и название обязательны; проект и ADR — выбор из списка (рёбра, а не текст)', () => {
    const f = createFields('decision', 'ru', {
      projects: [{ value: 'NooriUta/UnlimitedLORE', label: 'UnlimitedLORE' }],
      adrs: [{ value: 'ADR-LORE-050', label: 'ADR-LORE-050 · Ссылки' }],
    });
    expect(f.map(x => x.key)).toEqual(['id', 'title', 'projects', 'adr']);
    for (const k of ['projects', 'adr']) {
      const x = f.find(y => y.key === k)!;
      expect(x.kind).toBe('enum');
      expect(x.required).toBeUndefined();
    }
  });
  it('решение: нужен проект ИЛИ ADR-родитель (require_one_of) — без обоих не заводится', () => {
    expect(missingRequired('decision', { id: 'D-1', title: 'Правило' })).toEqual(['projects', 'adr']);
    expect(missingRequired('decision', { id: 'D-1', title: 'Правило', adr: 'ADR-1' })).toEqual([]);
    expect(missingRequired('decision', { id: 'D-1', title: 'Правило', projects: 'NooriUta/UnlimitedLORE' })).toEqual([]);
  });
  it('спека: код, название, проект (обязателен), краткое описание', () => {
    expect(createFields('spec', 'ru').map(x => x.key)).toEqual(['id', 'title', 'projects', 'summary', 'component']);
    expect(missingRequired('spec', { id: 'SPEC-X', title: 'Спека' })).toEqual(['projects']);
    expect(missingRequired('spec', { id: 'SPEC-X', title: 'Спека', projects: 'P' })).toEqual([]);
  });
  it('пути записи и имена тела — по блоку create', () => {
    expect(createRequest('decision', { id: 'D-1', title: 'Правило', adr: 'ADR-1' }))
      .toEqual({ url: '/lore/decision', body: { decision_id: 'D-1', title: 'Правило', adr_id: 'ADR-1' } });
    expect(createRequest('decision', { id: 'D-1', title: 'Правило', projects: 'P' }))
      .toEqual({ url: '/lore/decision', body: { decision_id: 'D-1', title: 'Правило', project: 'P' } });
    expect(createRequest('spec', { id: 'SPEC-X', title: 'Спека', projects: 'P', summary: 'кратко' }))
      .toEqual({ url: '/lore/spec', body: { spec_id: 'SPEC-X', title: 'Спека', project: 'P', summary: 'кратко' } });
  });
  it('код уже занят — POST не уходит (сервер пишет upsert, #1332)', async () => {
    const n = net(200, json(200, { ok: true }));
    const r = await saveCreate('spec', { id: 'SPEC-TAKEN', title: 'X', projects: 'P' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r).toMatchObject({ ok: false, kind: 'exists' });
    expect(n.posts()).toHaveLength(0);
  });
});

describe('S4-24 · «проект или ADR» — отказ называет, из чего выбрать', () => {
  it('решение без проекта и ADR: POST не уходит, причина — «нужно хотя бы одно: Проект, ADR»', async () => {
    const n = net(404, json(200, { ok: true }));
    const r = await saveCreate('decision', { id: 'D-1', title: 'Правило' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    expect(!r.ok && r.reason).toMatch(/хотя бы одно.*Проект.*ADR/);
    expect(n.posts()).toHaveLength(0);
  });
});

// S4-24 (model-config #1344, 8ded703f): компонент спеки идёт в блоке create без body —
// его поле несёт after_write: после записи спеки — привязка BELONGS_TO (out) через
// /lore/record/spec/{id}/relation. Сбой привязки — громко: спека заведена, компонент нет.
describe('S4-24 · компонент спеки — привязка после записи (after_write)', () => {
  it('у спеки есть поле «Компонент» — выбор из списка; без вариантов только чтение', () => {
    const f = createFields('spec', 'ru', { components: [{ value: 'SEIDRKIT_LIST', label: 'SEIDRKIT_LIST' }] });
    expect(f.map(x => x.key)).toEqual(['id', 'title', 'projects', 'summary', 'component']);
    const c = f.find(x => x.key === 'component')!;
    expect(c.kind).toBe('enum');
    expect(c.editable).toBe(true);
    expect(createFields('spec', 'ru').find(x => x.key === 'component')!.editable).toBe(false);
  });
  it('компонент не уходит в тело создания', () => {
    expect(createRequest('spec', { id: 'SPEC-X', title: 'Спека', projects: 'P', component: 'C1' }).body)
      .toEqual({ spec_id: 'SPEC-X', title: 'Спека', project: 'P' });
  });
  it('после записи спеки — POST relation {rel: BELONGS_TO, dir: out, target, action: add}', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.startsWith('/lore/record/') && init?.method !== 'POST') return json(404, { error: 'NOT_FOUND' });
      return json(200, { ok: true });
    }) as unknown as typeof fetch;
    const n = { impl, posts: () => calls.filter(c => c.init?.method === 'POST') };
    const r = await saveCreate('spec', { id: 'SPEC-X', title: 'Спека', projects: 'P', component: 'C1' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(r).toEqual({ ok: true, id: 'SPEC-X' });
    const posts = n.posts();
    expect(posts.map(p => p.url)).toEqual(['/lore/spec', '/lore/record/spec/SPEC-X/relation']);
    expect(JSON.parse(String(posts[1].init!.body))).toEqual({ rel: 'BELONGS_TO', dir: 'out', target: 'C1', action: 'add' });
  });
  it('без компонента — привязки нет', async () => {
    const n = net(404, () => json(200, { ok: true }));
    await saveCreate('spec', { id: 'SPEC-X', title: 'Спека', projects: 'P' }, { fetchImpl: n.impl, lang: 'ru' });
    expect(n.posts().map(p => p.url)).toEqual(['/lore/spec']);
  });
  it('привязка отказала — громко: спека заведена, компонент не привязан, причина названа', async () => {
    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/relation')) return json(403, { error: 'FORBIDDEN', detail: 'нет права на компонент' });
      if (url.startsWith('/lore/record/') && init?.method !== 'POST') return json(404, { error: 'NOT_FOUND' });
      return json(200, { ok: true });
    }) as unknown as typeof fetch;
    const r = await saveCreate('spec', { id: 'SPEC-X', title: 'Спека', projects: 'P', component: 'C1' }, { fetchImpl: impl, lang: 'ru' });
    expect(r).toMatchObject({ ok: false, kind: 'linkFailed', id: 'SPEC-X' });
    expect(!r.ok && r.reason).toMatch(/^SPEC-X заведена, но компонент не привязан: .+. Привяжите/s);
  });
});
