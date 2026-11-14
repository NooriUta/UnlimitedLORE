// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-11 × SPRINT_UXR_S9_SCALE_OPT/S9-09 — вкладка
// «История» на боевом сервере.
//
// kit умеет вкладку с S5-11, но в v2 её никто не подключал: `RecordView.history`
// нигде не передавался, и история записи была недоступна, хотя сервер её отдаёт.
//
// Что закрепляется:
//   • версии приводятся к «новейшая первой» НАШИМ правилом, а не порядком
//     ответа: order — настройка сервера (S9-09), наш вид фиксирован;
//   • `changed` считается сравнением соседей, потому что снимка полей сервер
//     не даёт; выдумывать значения, чтобы «был дифф», нельзя;
//   • «автор не установлен» (attribution.ok=false) доходит словами, а не
//     превращается в «правил никто»;
//   • запись вне скоупа — предупреждение, а не пустая история;
//   • 403 по скоупу — запрет, а не «истории нет»;
//   • `page` нет (сервер старее S9-09) — остаётся null: «сервер не сказал» ≠
//     «страница одна».
import { describe, expect, it, vi } from 'vitest';
import { HistoryForbidden, fetchHistory, historyFromServer } from './historySource';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (over: Record<string, unknown> = {}) => ({
  entity_type: 'adr', hist_type: 'KnowADRHist', ref_id: 'ADR-1',
  state_uid: 'st-1', valid_from: '2026-11-01T10:00:00Z', valid_to: '2026-11-02T10:00:00Z',
  status_raw: 'PROPOSED', content_hash: 'h1', source_commit: null,
  changed_by: 'sub-1', changed_by_kind: 'human',
  author: { kind: 'human', caller: 'sub-1', source: 'hist' },
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  type: 'adr', id: 'ADR-1',
  rows: [row(), row({ state_uid: 'st-2', valid_from: '2026-11-02T10:00:00Z', valid_to: null, status_raw: 'ACCEPTED', content_hash: 'h2' })],
  attribution: { ok: true, source: 'changed_by версии (S2-12)' },
  ...over,
});

describe('перевод истории с сервера', () => {
  it('положительный контроль: версии разобраны, открытая помечена', () => {
    const h = historyFromServer(body());
    expect(h.tracking).toBe('scd2');
    expect(h.versions).toHaveLength(2);
    expect(h.versions[0].is_open).toBe(true);
  });

  it('новейшая первой — по дате, а не по порядку ответа', () => {
    // Сервер отдал от старых к новым (order=asc, S9-09).
    const h = historyFromServer(body());
    expect(h.versions.map(v => v.state_uid)).toEqual(['st-2', 'st-1']);
  });

  it('changed считается сравнением соседей; у самой старой — все поля', () => {
    const h = historyFromServer(body());
    expect(h.versions[0].changed).toContain('status_raw');
    // S9-09 (a0918f86): служебный хеш — не правка.
    expect(h.versions[0].changed).not.toContain('content_hash');
    expect(h.versions[1].changed.length).toBeGreaterThan(0);
  });

  it('служебные поля в снимок версии не попадают', () => {
    const h = historyFromServer(body());
    for (const k of ['state_uid', 'valid_from', 'valid_to', 'author', 'changed_by']) {
      expect(Object.keys(h.versions[0].fields)).not.toContain(k);
    }
    expect(Object.keys(h.versions[0].fields)).toContain('status_raw');
  });

  it('автор человека и агента разбирается, иначе — unknown, а не «никто»', () => {
    const h = historyFromServer(body({
      rows: [
        row({ author: { kind: 'agent', caller: 'lore-mcp-full', source: 'hist' } }),
        row({ state_uid: 'st-0', valid_from: '2026-10-01T10:00:00Z', author: null }),
      ],
    }));
    expect(h.versions[0].author.kind).toBe('agent');
    expect(h.versions[1].author.kind).toBe('unknown');
  });

  it('«автор не установлен» доходит словами', () => {
    const h = historyFromServer(body({ attribution: { ok: false, reason: 'журнал действий не прочитался: таймаут' } }));
    expect(h.warnings.join(' ')).toMatch(/журнал действий не прочитался/);
  });

  it('запись вне скоупа — предупреждение, а не пустая история', () => {
    const h = historyFromServer(body({ rows: [], outside_scope: { id: 'ADR-1', verdict: 'outside_scope', reason: 'вне ваших проектов' } }));
    expect(h.versions).toEqual([]);
    expect(h.warnings.join(' ')).toMatch(/вне ваших проектов/);
  });

  it('page нет — null: «сервер не сказал» ≠ «страница одна»', () => {
    expect(historyFromServer(body()).page).toBeNull();
  });

  it('page есть (S9-09) — читается как есть', () => {
    const h = historyFromServer(body({ page: { total: 120, offset: 20, limit: 20, returned: 20, has_more: true, order: 'desc' } }));
    // author/collapse — эхо сервера (S9-09, PR #1083); их не прислали — null.
    expect(h.page).toEqual({ limit: 20, offset: 20, total: 120, has_more: true, author: null, collapse: null });
  });
});

describe('чтение истории с сервера', () => {
  it('параметры постраничности и фильтров уходят в адрес', async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => { seen = String(input); return json(body()); });
    let seen = '';
    await fetchHistory('adr', 'ADR-1', { offset: 20, limit: 20, order: 'desc', author_kind: 'agent', field: 'status' }, f as unknown as typeof fetch);
    const url = seen;
    for (const part of ['type=adr', 'id=ADR-1', 'offset=20', 'limit=20', 'order=desc', 'author_kind=agent', 'field=status']) {
      expect(url).toContain(part);
    }
  });

  it('403 по скоупу — запрет, а не «истории нет»', async () => {
    const f = vi.fn(async () => json({ error: 'SCOPE_EMPTY', detail: 'нет ни одного разрешённого проекта' }, 403));
    await expect(fetchHistory('adr', 'ADR-1', {}, f as unknown as typeof fetch))
      .rejects.toBeInstanceOf(HistoryForbidden);
  });

  it('иная ошибка — ошибка с кодом, а не пустая история', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_PARAMS', detail: 'unknown history type' }, 400));
    await expect(fetchHistory('nope', 'X', {}, f as unknown as typeof fetch)).rejects.toThrow(/BAD_PARAMS/);
  });

  it('не-JSON в ответе — тоже ошибка', async () => {
    const f = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    await expect(fetchHistory('adr', 'ADR-1', {}, f as unknown as typeof fetch)).rejects.toThrow(/502/);
  });
});

// ─── S9-09, вторая половина (PR #1083): конкретный автор и свёртка ──────────
describe('фильтр по автору и свёртка правок агента', () => {
  const seen = async (opts: Parameters<typeof fetchHistory>[2]) => {
    let url = '';
    const f = vi.fn(async (input: RequestInfo | URL) => { url = String(input); return json(body()); });
    await fetchHistory('adr', 'ADR-1', opts, f as unknown as typeof fetch);
    return url;
  };

  it('положительный контроль: без фильтров адрес прежний, кроме порядка', async () => {
    const url = await seen({});
    expect(url).toContain('type=adr');
    expect(url).not.toContain('author=');
    expect(url).not.toContain('collapse=');
  });

  it('конкретный автор и свёртка уходят в адрес вместе с видом автора (условие «И»)', async () => {
    const url = await seen({ author: 'claude-code', author_kind: 'agent', collapse: 'agent' });
    for (const part of ['author=claude-code', 'author_kind=agent', 'collapse=agent']) expect(url).toContain(part);
  });

  it('порядок по умолчанию — desc: страница обязана быть НОВЕЙШИМИ версиями', async () => {
    // Сервер без order отдаёт хронологию и режет страницу С НАЧАЛА, то есть
    // самые СТАРЫЕ версии. Наш вид фиксирован «новейшая первой», и первая
    // страница без order показывала бы начало цепочки, выдавая его за свежее.
    expect(await seen({ limit: 20 })).toContain('order=desc');
    expect(await seen({ limit: 20, order: 'asc' })).toContain('order=asc');
  });

  it('свёрнутая серия читается: число правок и начало серии', () => {
    const h = historyFromServer(body({
      rows: [row({
        state_uid: 'st-9', valid_from: '2026-11-08T10:00:00Z', valid_to: null,
        author: { kind: 'agent', caller: 'claude-code', source: 'hist' },
        collapsed: { count: 5, first_state_uid: 'st-5', first_valid_from: '2026-11-08T09:00:00Z' },
      })],
    }));
    expect(h.versions[0].collapsed).toEqual({ count: 5, first_state_uid: 'st-5', first_valid_from: '2026-11-08T09:00:00Z' });
  });

  it('пометка серии в снимок полей не попадает: иначе сравнение показало бы поле «collapsed»', () => {
    const h = historyFromServer(body({
      rows: [row({ collapsed: { count: 3, first_state_uid: 'st-0', first_valid_from: '2026-11-01T09:00:00Z' } })],
    }));
    expect(Object.keys(h.versions[0].fields)).not.toContain('collapsed');
  });

  it('несвёрнутая строка серией не помечается: одиночная правка агента — не серия', () => {
    expect(historyFromServer(body()).versions[0].collapsed).toBeNull();
  });

  it('эхо author и collapse доходит до вкладки: показываем то, что сервер применил', () => {
    const h = historyFromServer(body({
      page: { total: 12, offset: 0, limit: 20, returned: 12, has_more: false, order: 'desc', author: 'claude-code', collapse: 'agent' },
    }));
    expect(h.page).toMatchObject({ total: 12, author: 'claude-code', collapse: 'agent' });
  });

  it('эха нет — это «сервер не сказал», а не «не применил»', () => {
    const h = historyFromServer(body({ page: { total: 12, offset: 0, limit: 20, returned: 12, has_more: false, order: 'desc' } }));
    expect(h.page?.author).toBeNull();
    expect(h.page?.collapse).toBeNull();
  });

  it('пустой автор и слишком длинный — отказ сервера, а не пустая история', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_PARAMS', detail: 'author must not be blank' }, 400));
    await expect(fetchHistory('adr', 'ADR-1', { author: '' }, f as unknown as typeof fetch)).rejects.toThrow(/BAD_PARAMS/);
  });
});

// Приёмка препрода 14.11.2026 (MT-NOTE-APPEND, S9-09): дифф правки заметки показывал ОДНУ строку —
// служебный content_hash, а текста не было. Служебные поля версии отсекаются одним правилом с
// legacy-путём (history/recordHistory.ts, a0918f86), а текст заметки — поле версии и попадает в дифф.
describe('S9-09 × MT-NOTE-APPEND · дифф паспорта: без хеша, с текстом', () => {
  const row = (vf: string, vt: string | null, note: string, hash: string) => ({
    entity_type: 'task', hist_type: 'KnowTaskHist', ref_id: 'S/T-1', state_uid: vf, valid_from: vf, valid_to: vt,
    content_hash: hash, source_commit: 'abc', status_raw: '🔄 IN PROGRESS', note_md: note,
  });
  it('content_hash и source_commit не поле версии; правка текста — изменение note_md', () => {
    const h = historyFromServer({ rows: [row('2026-11-08T10:12:00Z', '2026-11-14T08:00:00Z', 'было', 'h1'), row('2026-11-14T08:00:00Z', null, 'было\nстало', 'h2')] });
    const newest = h.versions[0];
    expect(Object.keys(newest.fields)).not.toContain('content_hash');
    expect(Object.keys(newest.fields)).not.toContain('source_commit');
    expect(newest.changed).toEqual(['note_md']);
  });
});
