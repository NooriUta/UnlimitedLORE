// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-02 (+ S7B-13) — журнал действий в админке v2.
//
// Форма ответа — от сервера (LoreAdminActions): rows[{ts, family, entity_id,
// caller, axis, status, batch_id}], shown, total, total_state exact|unknown,
// truncated, limit, filters. Раскрытие пачки — GET /lore/admin/actions/batch/{id}.
//
// Этот файл проверяет ПРАВИЛА честности, а не случаи:
//   • «сколько всего не знаем» (total_state=unknown, total=null) ≠ ноль
//     и ≠ «показано всё»;
//   • truncated=true — выдача обрезана пределом, и это сказано словами;
//   • status ≥ 400 в строке — зафиксированный ОТКАЗ, не успех;
//   • 403 — «нет прав», не пустой журнал;
//   • ноль строк под фильтром — «по фильтру ничего», не «журнал пуст»;
//   • 400 — слова сервера вместе со списком допустимых значений;
//   • пачка: null — одиночное действие; id есть — пачка; 404 на раскрытии —
//     «раскрыть нечем», и раскрытие больше не предлагается.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { axeViolations } from '../test/axe';
import { ActionsScreen } from './ActionsScreen';
import {
  ACTION_AXES, ACTION_FAMILIES, actionsSearch, badParamsOf, EMPTY_ACTIONS_QUERY, fetchActions, fetchBatch,
  hasActionFilters, isBatchId, outcomeOf, parseActions, parseBatch, type ActionsQuery,
} from './actions';

beforeAll(() => { registerGameIcons(gameIcons); });
// Фильтры живут в адресе (?adm-caller=…): без сброса они переезжают из теста в тест.
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const BATCH = 'rb-1762767074000-ab12cd34';
const TS = Date.UTC(2026, 10, 10, 9, 31, 14);
const ROWS = [
  { ts: TS, family: 'user', entity_id: BATCH, caller: 'omiloreadmin', axis: 'human', status: 200, batch_id: BATCH },
  { ts: TS - 1000, family: 'dict', entity_id: 'harness', caller: 'lore-mcp-full', axis: 'agent', status: 403, batch_id: null },
  { ts: null, family: 'kc', entity_id: 'lore-mcp-ro', caller: 'unknown', axis: 'unauth', status: null, batch_id: null },
];
const BODY = { rows: ROWS, shown: 3, total: 37, total_state: 'exact', truncated: false, limit: 200, filters: {} };

const BATCH_BODY = {
  batch_id: BATCH,
  kc_sub: 'u-fro',
  count: 2,
  items: [
    { kc_sub: 'u-fro', project: 'AIDA/miniLORE', action: 'grant', role: 'reader', role_before: null, at: '2026-11-10T09:31:14Z', by_role: 'admin' },
    { kc_sub: 'u-fro', project: 'AIDA/UnlimitedLORE', action: 'update', role: 'writer', role_before: 'reader', at: '2026-11-10T09:31:15Z', by_role: 'admin' },
  ],
  undo: [{ project: 'AIDA/miniLORE', action: 'remove' }, { project: 'AIDA/UnlimitedLORE', role: 'reader' }],
  undo_until: '2026-11-10T09:46:14Z',
  undo_open: false,
  rollback: { method: 'POST', path: '/lore/user/role/batch', body: { kc_sub: 'u-fro', changes: [], undo_of: BATCH } },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts {
  body?: unknown;
  status?: number;
  batch?: unknown;
  batchStatus?: number;
  // ответ пачки приходит позже: панель уже нарисована со скелетоном
  // (SPRINT_UXR_S11_TEST_OPT/S11-SECRET-ROTATION-RACE — гонка «findBy контейнера → getBy содержимого»)
  batchDelayMs?: number;
}

function fake(opts: FakeOpts = {}) {
  const urls: string[] = [];
  const f = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes('/actions/batch/') && opts.batchDelayMs) await new Promise(r => setTimeout(r, opts.batchDelayMs));
    if (url.includes('/actions/batch/')) return json(opts.batch ?? BATCH_BODY, opts.batchStatus ?? 200);
    return json(opts.body ?? BODY, opts.status ?? 200);
  }) as unknown as typeof fetch;
  return { f, urls };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><ActionsScreen fetchImpl={f} /></KitLangProvider>);
const q = (patch: Partial<ActionsQuery> = {}): ActionsQuery => ({ ...EMPTY_ACTIONS_QUERY, ...patch });

describe('модель журнала · полнота', () => {
  it('total_state=unknown — total остаётся null: «не знаем» ≠ ноль', () => {
    const d = parseActions({ rows: ROWS, shown: 3, total: null, total_state: 'unknown', truncated: false, limit: 200 });
    expect(d.totalState).toBe('unknown');
    expect(d.total).toBeNull();
    expect(d.shown).toBe(3);
  });

  it('цифре при total_state≠exact не верим: total=0 с unknown не становится нулём', () => {
    const d = parseActions({ rows: ROWS, total: 0, total_state: 'unknown', truncated: false, limit: 200 });
    expect(d.total).toBeNull();
    expect(d.totalState).toBe('unknown');
  });

  it('total_state не пришёл вовсе — это unknown, а не exact: счёт не выдумываем', () => {
    expect(parseActions({ rows: ROWS, total: 37 }).totalState).toBe('unknown');
    expect(parseActions({ rows: ROWS, total: 37 }).total).toBeNull();
    expect(parseActions({ rows: ROWS, total: 37, total_state: 'exact' }).total).toBe(37);
  });

  it('total_state=exact без цифры — это тоже «не знаем», а не «показано всё»', () => {
    const d = parseActions({ rows: ROWS, total: null, total_state: 'exact', truncated: false, limit: 200 });
    expect(d.totalState).toBe('unknown');
    expect(d.total).toBeNull();
  });

  it('предел сервер не назвал — null, а не 0: «обрезано пределом 0» было бы враньём', () => {
    expect(parseActions({ rows: ROWS, truncated: true }).limit).toBeNull();
    expect(parseActions({ rows: ROWS, truncated: true, limit: 2 }).limit).toBe(2);
  });

  it('truncated — только явное true; «не пришло» не значит «показано всё»… но и не обрезано', () => {
    expect(parseActions({ rows: ROWS, truncated: true, limit: 2 }).truncated).toBe(true);
    expect(parseActions({ rows: ROWS }).truncated).toBe(false);
  });

  it('показано — столько строк, сколько пришло (не то, что сервер назвал в shown)', () => {
    expect(parseActions({ rows: ROWS, shown: 99 }).shown).toBe(3);
  });
});

describe('модель журнала · строка', () => {
  it('исход: ≥400 — отказ, 2xx/3xx — успех, нет кода — «не записан», а не успех', () => {
    expect(outcomeOf(200)).toBe('ok');
    expect(outcomeOf(201)).toBe('ok');
    expect(outcomeOf(400)).toBe('refused');
    expect(outcomeOf(403)).toBe('refused');
    expect(outcomeOf(502)).toBe('refused');
    expect(outcomeOf(null)).toBe('unknown');
  });

  it('status не числом (строка от базы) читается числом; мусор — null, не 0', () => {
    const d = parseActions({ rows: [{ ...ROWS[0], status: '403' }, { ...ROWS[0], status: 'ой' }] });
    expect(d.rows[0].status).toBe(403);
    expect(d.rows[1].status).toBeNull();
  });

  it('ts не числом — null: показывать 1970 вместо «время не записано» нельзя', () => {
    const d = parseActions({ rows: [{ ...ROWS[0], ts: null }, { ...ROWS[0], ts: 'вчера' }, { ...ROWS[0], ts: TS }] });
    expect(d.rows[0].ts).toBeNull();
    expect(d.rows[1].ts).toBeNull();
    expect(d.rows[2].ts).toBe(TS);
  });

  // SPRINT_UXR_POLISH_UAT_1113/PU-03: MetricSnapshot — TIMESERIES, и ts из базы
  // приходит ISO-строкой ("2026-11-13T12:30:54.337Z"), а не числом. Фикстура с
  // числом прятала то, что на стенде у ВСЕХ записей было «время не записано».
  it('ts ISO-строкой (как отдаёт TIMESERIES) читается моментом, а не «не записано»', () => {
    const d = parseActions({ rows: [{ ...ROWS[0], ts: new Date(TS).toISOString() }] });
    expect(d.rows[0].ts).toBe(TS);
  });

  it('пачка: id формы rb-<13 цифр>-<8 hex>; всё прочее — не пачка', () => {
    expect(isBatchId(BATCH)).toBe(true);
    expect(isBatchId('rb-176-ab12cd34')).toBe(false);
    expect(isBatchId('harness')).toBe(false);
    expect(isBatchId(null)).toBe(false);
  });

  it('batch_id null — одиночное действие; id — пачка (и он не выдумывается из entity_id)', () => {
    const d = parseActions({ rows: ROWS });
    expect(d.rows[0].batch_id).toBe(BATCH);
    expect(d.rows[1].batch_id).toBeNull();
    // Сервер не прислал поле вовсе (старая сборка) — тоже null, без догадок по entity_id.
    expect(parseActions({ rows: [{ ...ROWS[0], batch_id: undefined }] }).rows[0].batch_id).toBeNull();
  });
});

describe('модель журнала · запрос', () => {
  it('пустые фильтры в запрос не уходят: фильтровать «по пустой строке» нельзя', () => {
    expect(actionsSearch(q())).toBe('');
    expect(actionsSearch(q({ caller: '  ' }))).toBe('');
    expect(actionsSearch(q({ caller: 'omiloreadmin', axis: 'agent', limit: '50' })))
      .toBe('caller=omiloreadmin&axis=agent&limit=50');
    expect(actionsSearch(q({ family: 'project-actor', batch_id: BATCH, from: '2026-11-01', to: '2026-11-10' })))
      .toBe('family=project-actor&batch_id=' + BATCH + '&from=2026-11-01&to=2026-11-10');
  });

  it('«фильтр стоит» — про отбор, а не про предел: limit сам ничего не отбирает', () => {
    expect(hasActionFilters(q())).toBe(false);
    expect(hasActionFilters(q({ limit: '1000' }))).toBe(false);
    expect(hasActionFilters(q({ caller: 'x' }))).toBe(true);
    expect(hasActionFilters(q({ from: '2026-11-01' }))).toBe(true);
  });

  it('закрытые списки — те же, что у сервера', () => {
    expect([...ACTION_FAMILIES].sort()).toEqual(['admin', 'dict', 'kc', 'project', 'project-actor', 'user']);
    expect([...ACTION_AXES]).toEqual(['human', 'agent', 'unauth']);
  });

  it('400 от сервера: слова сервера и список допустимых значений из них', async () => {
    const detail = "unknown family 'task' — admin journal families: [admin, dict, kc, project, project-actor, user]";
    const f = vi.fn(async () => json({ error: 'BAD_PARAMS', detail }, 400)) as unknown as typeof fetch;
    const err = await fetchActions(q({ family: 'task' }), { fetchImpl: f }).catch((e: unknown) => e);
    const bad = badParamsOf(err);
    expect(bad).not.toBeNull();
    expect(bad!.detail).toBe(detail);
    expect(bad!.allowed).toEqual(['admin', 'dict', 'kc', 'project', 'project-actor', 'user']);
  });

  it('400 без списка (from позже to) — слова есть, список пуст, а не выдуман', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_PARAMS', detail: 'from is later than to' }, 400)) as unknown as typeof fetch;
    const err = await fetchActions(q({ from: '2026-11-10', to: '2026-11-01' }), { fetchImpl: f }).catch((e: unknown) => e);
    expect(badParamsOf(err)!.allowed).toEqual([]);
    expect(badParamsOf(err)!.detail).toBe('from is later than to');
  });

  it('403 — не «плохой фильтр»: badParamsOf молчит, чтобы экран сказал «нет прав»', async () => {
    const f = vi.fn(async () => json({ error: 'FORBIDDEN', detail: 'admin role required' }, 403)) as unknown as typeof fetch;
    const err = await fetchActions(q(), { fetchImpl: f }).catch((e: unknown) => e);
    expect(badParamsOf(err)).toBeNull();
    expect((err as { status?: number }).status).toBe(403);
  });
});

describe('модель пачки', () => {
  it('окно отката: undo_open=false — закрыто, момент назван', () => {
    const b = parseBatch(BATCH_BODY);
    expect(b.undoOpen).toBe(false);
    expect(b.undoUntil).toBe('2026-11-10T09:46:14Z');
    expect(b.count).toBe(2);
    expect(b.items[1].role_before).toBe('reader');
    expect(b.items[0].role_before).toBeNull();
  });

  it('undo_until сервер отдал строкой «null» — срок неизвестен, и окно закрыто', () => {
    const b = parseBatch({ ...BATCH_BODY, undo_until: 'null', undo_open: true });
    expect(b.undoUntil).toBeNull();
    expect(b.undoOpen).toBe(false);
  });

  it('404 на раскрытии — отдельный исход «раскрыть нечем», а не пустая пачка', async () => {
    const f = vi.fn(async () => json({ error: 'TARGET_NOT_FOUND', detail: 'пачка ' + BATCH + ': событий назначений с этим batch_id нет' }, 404)) as unknown as typeof fetch;
    const err = await fetchBatch(BATCH, { fetchImpl: f }).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(404);
  });
});

describe('экран журнала · честные состояния', () => {
  it('отказ в строке нарисован отказом, успех — успехом, нет кода — «не записан»', async () => {
    mount(fake().f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId("adm-log-outcome").getAttribute("data-outcome")).toBe("ok");
    const refused = within(rows[1]).getByTestId('adm-log-outcome');
    expect(refused.getAttribute("data-outcome")).toBe("refused");
    expect(refused.textContent).toMatch(/отказ/i);
    expect(refused.textContent).toContain('403');
    expect(within(rows[2]).getByTestId("adm-log-outcome").getAttribute("data-outcome")).toBe("unknown");
  });

  it('время без отметки — «время не записано», а не 1970-01-01', async () => {
    mount(fake().f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    expect(within(rows[0]).getByTestId('adm-log-ts').textContent).toContain('2026-11-10 09:31');
    expect(rows[2].textContent).not.toContain('1970');
    expect(within(rows[2]).getByTestId('adm-log-ts').textContent).toMatch(/не записано/i);
  });

  it('PU-03: время ISO-строкой от сервера показано временем', async () => {
    const iso = { ...BODY, rows: [{ ...ROWS[1], ts: new Date(TS).toISOString() }] };
    mount(fake({ body: iso }).f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    expect(within(rows[0]).getByTestId('adm-log-ts').textContent).toContain('2026-11-10 09:31');
  });

  it('PU-03: путь эндпоинта вместо объекта — «объект не записан», путь в подсказке', async () => {
    const path = { ...BODY, rows: [{ ...ROWS[1], entity_id: '/lore/user/role' }] };
    mount(fake({ body: path }).f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    const ent = within(rows[0]).getByTestId('adm-log-entity');
    expect(ent.textContent).toMatch(/объект не записан/i);
    expect(ent.getAttribute('title')).toContain('/lore/user/role');
  });

  it('«сколько всего не знаем» сказано словами и не притворяется нулём', async () => {
    mount(fake({ body: { ...BODY, total: null, total_state: 'unknown' } }).f);
    const tot = await screen.findByTestId('adm-log-total');
    expect(tot.getAttribute("data-total-state")).toBe("unknown");
    expect(tot.textContent).toMatch(/неизвестно/i);
    expect(tot.textContent).not.toMatch(/из 0\b/);
  });

  it('счёт точный — «показано N из M»', async () => {
    mount(fake().f);
    const tot = await screen.findByTestId('adm-log-total');
    expect(tot.getAttribute("data-total-state")).toBe("exact");
    expect(tot.textContent).toContain('37');
  });

  it('обрезано пределом — сказано прямо: «показано 200» не читается как «их 200»', async () => {
    mount(fake({ body: { ...BODY, truncated: true, limit: 2, total: null, total_state: 'unknown' } }).f);
    const cut = await screen.findByTestId('adm-log-truncated');
    expect(cut.textContent).toMatch(/обрезан/i);
    expect(cut.textContent).toContain('2');
  });

  it('обрезано, а предел не назван — про обрезку сказано, числа не выдумано', async () => {
    const body: Record<string, unknown> = { ...BODY, truncated: true, total: null, total_state: 'unknown' };
    delete body.limit;
    mount(fake({ body }).f);
    const cut = await screen.findByTestId('adm-log-truncated');
    expect(cut.textContent).toMatch(/обрезан/i);
    expect(cut.textContent).not.toMatch(/\b0\b/);
  });

  it('полная выдача — плашки обрезки нет (плашка, висящая всегда, не читается)', async () => {
    mount(fake().f);
    await screen.findAllByTestId(/^adm-log-row-/);
    expect(screen.queryByTestId('adm-log-truncated')).toBeNull();
  });

  it('403 — «нет прав», а не пустой журнал', async () => {
    const f = vi.fn(async () => json({ error: 'FORBIDDEN', detail: 'admin role required' }, 403)) as unknown as typeof fetch;
    mount(f);
    const box = await waitFor(() => {
      const el = document.querySelector('[data-state="forbidden"]');
      if (!el) throw new Error('«нет прав» не показано');
      return el;
    });
    expect(box.textContent).toMatch(/нет прав/i);
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
    expect(screen.queryByTestId('adm-log')).toBeNull();
  });

  it('фильтр ничего не нашёл — «по фильтру ничего», а журнал пуст — другими словами', async () => {
    const { f } = fake({ body: { ...BODY, rows: [], shown: 0, total: 0, total_state: 'exact' } });
    mount(f);
    expect((await screen.findByTestId('adm-log-empty')).getAttribute('data-empty')).toBe('journal');
    fireEvent.change(screen.getByLabelText('Вызывающий'), { target: { value: 'нетакого' } });
    fireEvent.click(screen.getByTestId('adm-log-apply'));
    await waitFor(() => expect(screen.getByTestId('adm-log-empty').getAttribute('data-empty')).toBe('filter'));
    expect(screen.getByTestId('adm-log-empty').textContent).toMatch(/фильтр/i);
    // S7B-25: пустое состояние — kit EmptyState (с его значком), а не своя разметка.
    expect(screen.getByTestId('adm-log-empty').querySelector('.sk-state__icon')).toBeTruthy();
  });

  it('период — полями даты (type=date), а не текстом; значение уходит в адрес как было (S7B-25)', async () => {
    const { f } = fake();
    mount(f);
    const from = (await screen.findByLabelText('С')) as HTMLInputElement;
    const to = screen.getByLabelText('По') as HTMLInputElement;
    expect(from.type).toBe('date');
    expect(to.type).toBe('date');
    fireEvent.change(from, { target: { value: '2026-11-10' } });
    fireEvent.click(screen.getByTestId('adm-log-apply'));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-from')).toBe('2026-11-10'));
  });

  it('в адресе момент ISO, не дата — поле остаётся текстовым и значение не теряется (S7B-25)', async () => {
    window.history.replaceState(null, '', '/?adm-from=2026-11-10T12:00:00Z');
    const { f } = fake();
    mount(f);
    const from = (await screen.findByLabelText('С')) as HTMLInputElement;
    expect(from.type).toBe('text');
    expect(from.value).toBe('2026-11-10T12:00:00Z');
  });

  it('400 — слова сервера и список допустимых значений, а не «ошибка загрузки»', async () => {
    const detail = "unknown axis 'robot' — expected one of [agent, human, unauth]";
    // 400 — только у журнала: блок отказов KC (S7B-31) читает свой источник и честно
    // показал бы СВОЙ сбой, а проверяем здесь, что 400 журнала — не «ошибка загрузки».
    const f = vi.fn(async (url: string) => (url.startsWith('/lore/kc/denials')
      ? json({ denials: [] })
      : json({ error: 'BAD_PARAMS', detail }, 400))) as unknown as typeof fetch;
    mount(f);
    const bad = await screen.findByTestId('adm-log-badparams');
    expect(bad.textContent).toContain(detail);
    expect(screen.getByTestId('adm-log-allowed').textContent).toContain('unauth');
    expect(document.querySelector('[data-state="error"]')).toBeNull();
  });

  it('фильтры и предел уходят в запрос, а «сбросить» их снимает', async () => {
    const { f, urls } = fake();
    mount(f);
    await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.change(screen.getByLabelText('Вызывающий'), { target: { value: 'omiloreadmin' } });
    fireEvent.change(screen.getByLabelText('Ось'), { target: { value: 'agent' } });
    fireEvent.change(screen.getByLabelText('Семейство'), { target: { value: 'dict' } });
    fireEvent.change(screen.getByLabelText('Предел'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('adm-log-apply'));
    await waitFor(() => expect(urls[urls.length - 1]).toContain('caller=omiloreadmin'));
    expect(urls[urls.length - 1]).toContain('axis=agent');
    expect(urls[urls.length - 1]).toContain('family=dict');
    expect(urls[urls.length - 1]).toContain('limit=50');
    fireEvent.click(screen.getByTestId('adm-log-reset'));
    await waitFor(() => expect(urls[urls.length - 1]).toBe('/lore/admin/actions'));
  });
});

describe('экран журнала · пачка (S7B-13)', () => {
  it('строка пачки помечена пачкой и даёт раскрытие; одиночная — ни того, ни другого', async () => {
    mount(fake().f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    expect(within(rows[0]).getByTestId("adm-log-batch").getAttribute("data-batch")).toBe("batch");
    expect(within(rows[0]).getByTestId('adm-log-expand')).toBeTruthy();
    expect(within(rows[1]).getByTestId("adm-log-batch").getAttribute("data-batch")).toBe("single");
    expect(within(rows[1]).queryByTestId('adm-log-expand')).toBeNull();
  });

  it('раскрытие: назначения пачки и окно отката словами; кнопки отката нет', async () => {
    mount(fake({ batchDelayMs: 30 }).f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.click(within(rows[0]).getByTestId('adm-log-expand'));
    const panel = await screen.findByTestId('adm-log-batch-panel');
    // панель рисуется сразу со скелетоном — ждём строки пачки, а не контейнер
    expect(await within(panel).findAllByTestId(/^adm-log-batch-item-/)).toHaveLength(2);
    expect(panel.textContent).toContain('AIDA/miniLORE');
    const undo = within(panel).getByTestId('adm-log-undo');
    expect(undo.getAttribute("data-open")).toBe("false");
    expect(undo.textContent).toMatch(/закрыт/i);
    expect(undo.textContent).toContain('2026-11-10T09:46:14Z');
    expect(within(panel).queryByRole('button', { name: /откат/i })).toBeNull();
  });

  it('окно отката ещё открыто — так и сказано', async () => {
    mount(fake({ batch: { ...BATCH_BODY, undo_open: true } }).f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.click(within(rows[0]).getByTestId('adm-log-expand'));
    const undo = await screen.findByTestId('adm-log-undo');
    expect(undo.getAttribute("data-open")).toBe("true");
    expect(undo.textContent).toMatch(/открыт/i);
  });

  it('404 — «пачку раскрыть нечем» (не «пусто»), и раскрытие больше не предлагается', async () => {
    mount(fake({ batchStatus: 404, batch: { error: 'TARGET_NOT_FOUND', detail: 'событий назначений с этим batch_id нет' } }).f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.click(within(rows[0]).getByTestId('adm-log-expand'));
    const none = await screen.findByTestId('adm-log-batch-none');
    expect(none.textContent).toMatch(/нечем/i);
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
    const again = await screen.findAllByTestId(/^adm-log-row-/);
    expect(within(again[0]).queryByTestId('adm-log-expand')).toBeNull();
    expect(within(again[0]).getByTestId("adm-log-batch").getAttribute("data-batch")).toBe("unexpandable");
  });

  it('раскрытие не прочиталось (502) — это сбой, а не «пачки нет»', async () => {
    mount(fake({ batchStatus: 502, batch: { error: 'UPSTREAM', detail: 'DOWN' } }).f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.click(within(rows[0]).getByTestId('adm-log-expand'));
    const err = await screen.findByTestId('adm-log-batch-error');
    expect(err.textContent).toMatch(/не раскры/i);
    expect(screen.queryByTestId('adm-log-batch-none')).toBeNull();
    // Сбой чтения не объявляет пачку нераскрываемой: попробовать ещё раз можно.
    expect(within(screen.getAllByTestId(/^adm-log-row-/)[0]).getByTestId('adm-log-expand')).toBeTruthy();
  });

  it('фильтр по пачке уходит в запрос', async () => {
    const { f, urls } = fake();
    mount(f);
    await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.change(screen.getByLabelText(/Пачка/), { target: { value: BATCH } });
    fireEvent.click(screen.getByTestId('adm-log-apply'));
    await waitFor(() => expect(urls[urls.length - 1]).toContain('batch_id=' + BATCH));
  });
});

describe('экран журнала · доступность', () => {
  it('axe: таблица, фильтры и раскрытая пачка — без нарушений', async () => {
    const { container } = mount(fake().f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.click(within(rows[0]).getByTestId('adm-log-expand'));
    await screen.findByTestId('adm-log-batch-panel');
    expect(await axeViolations(container)).toEqual([]);
  });
});

// ── S7B-13: «Откатить пачку» из журнала ─────────────────────────────────────
// Сервер (LoreAdminActions.batchBody): rollback {method, path, body{kc_sub,
// changes, undo_of}} — готовое тело для POST /lore/user/role/batch. Откат идёт
// тем же DangerBatch, что в «Ролях»: дифф (dry_run с undo_of) → ввод слова →
// одна пачка. Вне окна — честная надпись, кнопки нет.
describe('экран журнала · откат пачки (S7B-13)', () => {
  const OPEN = {
    ...BATCH_BODY,
    undo_open: true,
    rollback: {
      method: 'POST', path: '/lore/user/role/batch',
      body: { kc_sub: 'u-fro', changes: BATCH_BODY.undo, undo_of: BATCH },
    },
  };

  function fakeRb(batch: unknown = OPEN) {
    const posts: Array<Record<string, unknown>> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/lore/user/role/batch') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        const plan = [
          { project: 'AIDA/miniLORE', before: 'reader', after: null, kind: 'remove', sign: '−', check: { state: 'checked', source: 'graph' } },
          { project: 'AIDA/UnlimitedLORE', before: 'writer', after: 'reader', kind: 'update', sign: '~', check: { state: 'checked', source: 'graph' } },
        ];
        if (body.dry_run) return json({ ok: true, kc_sub: 'u-fro', plan, undo: [], dry_run: true, applied: 0 });
        return json({
          ok: true, batch_id: 'rb-1762767999000-00000001', kc_sub: 'u-fro', plan, undo: [], applied: 2, failed: 0,
          atomic: false, undo_of: body.undo_of, undo_until: new Date(Date.now() + 15 * 60_000).toISOString(),
          items: plan.map(p => ({ project: p.project, kind: p.kind, status: 200, result: 'applied' })),
        });
      }
      if (url.includes('/actions/batch/')) return json(batch);
      return json(BODY);
    }) as unknown as typeof fetch;
    return { f, posts, writes: () => posts.filter(p => !p.dry_run) };
  }

  async function openPanel(f: typeof fetch) {
    mount(f);
    const rows = await screen.findAllByTestId(/^adm-log-row-/);
    fireEvent.click(within(rows[0]).getByTestId('adm-log-expand'));
    return screen.findByTestId('adm-log-batch-panel');
  }

  it('модель: rollback.body разобран — kc_sub, changes, undo_of', () => {
    const d = parseBatch(OPEN);
    expect(d.rollback?.body).toEqual({ kc_sub: 'u-fro', changes: BATCH_BODY.undo, undo_of: BATCH });
  });

  it('окно открыто — кнопка «Откатить пачку»; нажатие ничего не пишет, а показывает дифф с подтверждением', async () => {
    const fk = fakeRb();
    const panel = await openPanel(fk.f);
    fireEvent.click(await within(panel).findByTestId('adm-log-rollback-btn'));
    await screen.findByTestId('kit-diff-apply');
    expect(screen.getByTestId('kit-diff-confirm')).toBeTruthy();
    expect(fk.writes()).toHaveLength(0);
    expect(fk.posts[0]).toMatchObject({ kc_sub: 'u-fro', dry_run: true, undo_of: BATCH, changes: BATCH_BODY.undo });
    // display_name не уходит: откат не должен переименовывать человека в его kc_sub.
    expect('display_name' in fk.posts[0]).toBe(false);
  });

  it('подтверждение словом → одна пачка с undo_of и changes из rollback.body', async () => {
    const fk = fakeRb();
    const panel = await openPanel(fk.f);
    fireEvent.click(await within(panel).findByTestId('adm-log-rollback-btn'));
    const apply = await screen.findByTestId('kit-diff-apply');
    fireEvent.click(apply);
    expect(fk.writes()).toHaveLength(0);
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'u-fro' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    expect(await screen.findByTestId('kit-batch-summary')).toBeTruthy();
    expect(fk.writes()).toHaveLength(1);
    expect(fk.writes()[0]).toMatchObject({ kc_sub: 'u-fro', undo_of: BATCH, changes: BATCH_BODY.undo });
  });

  it('окно закрыто — честная надпись «откатить нельзя», кнопки нет', async () => {
    const panel = await openPanel(fakeRb(BATCH_BODY).f);
    const closed = await within(panel).findByTestId('adm-log-rollback-closed');
    expect(closed.textContent).toMatch(/нельзя/i);
    expect(within(panel).queryByTestId('adm-log-rollback-btn')).toBeNull();
  });
});
