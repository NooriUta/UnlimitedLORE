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
    expect(h.versions[0].changed).toContain('content_hash');
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
    expect(h.page).toEqual({ limit: 20, offset: 20, total: 120, has_more: true });
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
