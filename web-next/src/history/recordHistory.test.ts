// SPRINT_UXR_S5_RECORD_TASKS/S5-11 · история записи для паспортов v2:
// чтение — GET /lore/history (контракт S2-03), пока эндпоинт не выкачен —
// ЯВНЫЙ переход на SCD2-слайсы (history_task / history_sprint / adr_history)
// с пометкой; возврат версии — существующий write-API (task/edit, sprint/plan +
// sprint/update, POST /lore/adr). Ошибка — с HTTP-статусом, никогда не «пусто».
import { describe, expect, it, vi } from 'vitest';
import type { KitHistoryVersion, KitRestoreRequest } from '@seidr/kit';
import {
  HistoryHttpError, RESTORABLE, fetchRecordHistory, restoreRecordVersion, type FetchLike,
} from './recordHistory';

type Call = { url: string; init?: RequestInit };

function fake(responses: Record<string, { status: number; body?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find(k => url.startsWith(k));
    const r = key ? responses[key] : { status: 599, text: 'no route' };
    const payload = r.text ?? JSON.stringify(r.body ?? {});
    return new Response(payload, { status: r.status, headers: { 'Content-Type': r.text ? 'text/html' : 'application/json' } });
  };
  return { f, calls };
}

const S2_BODY = {
  target: { type: 'task', id: 'S/T-1', title: 'Задача' },
  tracking: 'scd2', hist_type: 'KnowTaskHist',
  versions: [
    { state_uid: 's2', valid_from: '2026-11-07T10:00:00Z', valid_to: null, is_open: true, status: 'IN_PROGRESS',
      status_category: 'in_progress', fields: { note_md: 'b', effort_days: 2 }, changed: ['note_md', 'effort_days'],
      author: { kind: 'agent', client_id: 'claude-code', actor_id: null, session_id: 'x', owner_kc_sub: 'u-1' } },
    { state_uid: 's1', valid_from: '2026-11-06T10:00:00Z', valid_to: '2026-11-07T10:00:00Z', is_open: false, status: 'TODO',
      status_category: 'not_started', fields: { note_md: 'a' }, changed: ['note_md'], author: { kind: 'unknown' } },
  ],
  anomalies: [], page: { limit: 50, offset: 0, total: 2, has_more: false }, scope: null, outside_scope: null, warnings: [],
};

describe('S5-11 · fetchRecordHistory: GET /lore/history (S2-03)', () => {
  it('ходит в /lore/history с type и id и отдаёт историю kit как есть (новейшая первой, авторы)', async () => {
    const { f, calls } = fake({ '/lore/history': { status: 200, body: S2_BODY } });
    const r = await fetchRecordHistory('task', 'S/T-1', { fetchImpl: f, headers: () => ({ Authorization: 'Bearer t' }) });
    expect(calls[0].url).toBe('/lore/history?type=task&id=S%2FT-1');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(r.source).toBe('s2');
    expect(r.history.tracking).toBe('scd2');
    expect(r.history.versions.map(v => v.state_uid)).toEqual(['s2', 's1']);
    expect(r.history.versions[0].author).toMatchObject({ kind: 'agent', client_id: 'claude-code' });
    expect(r.history.page).toEqual({ limit: 50, offset: 0, total: 2, has_more: false });
  });

  it('not_tracked и предупреждения сервера доезжают до kit', async () => {
    const { f } = fake({ '/lore/history': { status: 200, body: { ...S2_BODY, tracking: 'not_tracked', versions: [], warnings: ['w1'] } } });
    const r = await fetchRecordHistory('adr', 'ADR-1', { fetchImpl: f });
    expect(r.history.tracking).toBe('not_tracked');
    expect(r.history.warnings).toEqual(['w1']);
  });

  it('404 с кодом NOT_FOUND — записи нет: ошибка, а не переход на слайс', async () => {
    const { f, calls } = fake({ '/lore/history': { status: 404, body: { error: 'NOT_FOUND' } } });
    await expect(fetchRecordHistory('task', 'X', { fetchImpl: f })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
  });

  it('403 — ошибка со статусом (экран рисует «нет прав»)', async () => {
    const { f } = fake({ '/lore/history': { status: 403, body: { error: 'FORBIDDEN' } } });
    const err = await fetchRecordHistory('task', 'X', { fetchImpl: f }).catch(e => e);
    expect(err).toBeInstanceOf(HistoryHttpError);
    expect(err.status).toBe(403);
  });
});

describe('S5-11 · fetchRecordHistory: эндпоинт S2 ещё не выкачен → SCD2-слайс, явно', () => {
  const rows = [
    { valid_from: '2026-11-05T10:00:00Z', valid_to: '2026-11-06T10:00:00Z', content_hash: 'h1', source_commit: null, status_raw: 'TODO', effort_days: null, note_md: 'a' },
    { valid_from: '2026-11-06T10:00:00Z', valid_to: null, content_hash: 'h2', source_commit: 'c', status_raw: 'IN_PROGRESS', effort_days: 2, note_md: 'b' },
  ];

  it('404 без кода (маршрута нет) → history_task; версии новейшей первой, автор unknown, changed посчитан', async () => {
    const { f, calls } = fake({
      '/lore/history': { status: 404, text: '<html>Not Found</html>' },
      '/lore/slice/history_task': { status: 200, body: { rows } },
    });
    const r = await fetchRecordHistory('task', 'S/T-1', { fetchImpl: f });
    expect(calls.map(c => c.url)).toEqual(['/lore/history?type=task&id=S%2FT-1', '/lore/slice/history_task?id=S%2FT-1']);
    expect(r.source).toBe('legacy');
    expect(r.slice).toBe('history_task');
    const [newest, oldest] = r.history.versions;
    expect(newest).toMatchObject({ valid_from: '2026-11-06T10:00:00Z', is_open: true, status: 'IN_PROGRESS', author: { kind: 'unknown' } });
    expect(newest.fields).toEqual({ status_raw: 'IN_PROGRESS', effort_days: 2, note_md: 'b' });
    expect(newest.changed).toEqual(['effort_days', 'note_md', 'status_raw']);
    expect(oldest.changed).toEqual(['note_md', 'status_raw']);
    expect(oldest.is_open).toBe(false);
  });

  it('слайс по виду: спринт → history_sprint, ADR → adr_history', async () => {
    for (const [kind, slice] of [['sprint', 'history_sprint'], ['adr', 'adr_history']] as const) {
      const { f, calls } = fake({
        '/lore/history': { status: 404, text: 'nope' },
        [`/lore/slice/${slice}`]: { status: 200, body: { rows: [] } },
      });
      const r = await fetchRecordHistory(kind, 'ID', { fetchImpl: f });
      expect(calls[1].url).toBe(`/lore/slice/${slice}?id=ID`);
      expect(r.history.versions).toEqual([]);
    }
  });

  it('слайс тоже упал — ошибка слайса, а не пустая история', async () => {
    const { f } = fake({
      '/lore/history': { status: 404, text: 'nope' },
      '/lore/slice/history_task': { status: 500, body: { error: 'BOOM' } },
    });
    await expect(fetchRecordHistory('task', 'S/T-1', { fetchImpl: f })).rejects.toMatchObject({ status: 500 });
  });
});

const cur = (fields: Record<string, unknown>): KitHistoryVersion => ({
  state_uid: 'v', valid_from: null, valid_to: null, is_open: false, status: null, fields, changed: [], author: { kind: 'unknown' },
});
const req = (record_id: string, changes: KitRestoreRequest['changes']): KitRestoreRequest => ({ record_id, version: cur({}), changes });

describe('S5-11 · restoreRecordVersion: существующий write-API', () => {
  it('что умеет вернуть write-API — по виду', () => {
    expect(RESTORABLE.task).toEqual(['note_md', 'effort_days']);
    expect(RESTORABLE.adr).toEqual(['context_md', 'decision_md', 'consequences_md']);
    expect(RESTORABLE.sprint).toEqual(expect.arrayContaining(['context_md', 'outcome_md', 'priority', 'planned_end_date']));
  });

  it('задача → POST /lore/task/edit одним запросом: title обязателен, очищенный note_md = пустая строка', async () => {
    const { f, calls } = fake({ '/lore/task/edit': { status: 200, body: { ok: true } } });
    await restoreRecordVersion('task', 'S/T-1', req('S/T-1', [
      { field: 'effort_days', from: 2, to: 1, change: 'changed' },
      { field: 'note_md', from: 'b', to: null, change: 'removed' },
    ]), { title: 'Задача', fetchImpl: f });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ task_uid: 'S/T-1', title: 'Задача', note_md: '', effort_days: 1 });
  });

  it('очистить нетекстовое поле write-API не умеет — громкий отказ до записи, а не частичный возврат', async () => {
    const { f, calls } = fake({ '/lore/task/edit': { status: 200, body: { ok: true } } });
    await expect(restoreRecordVersion('task', 'S/T-1', req('S/T-1', [
      { field: 'effort_days', from: 2, to: null, change: 'removed' },
    ]), { title: 'Задача', fetchImpl: f })).rejects.toThrow(/effort_days/);
    expect(calls).toHaveLength(0);
  });

  it('спринт → план (SCD2) в /lore/sprint/plan, тела — в /lore/sprint/update', async () => {
    const { f, calls } = fake({
      '/lore/sprint/plan': { status: 200, body: { ok: true } },
      '/lore/sprint/update': { status: 200, body: { ok: true } },
    });
    await restoreRecordVersion('sprint', 'SPRINT_X', req('SPRINT_X', [
      { field: 'context_md', from: 'new', to: 'old', change: 'changed' },
      { field: 'priority', from: 'P1', to: 'P2', change: 'changed' },
    ]), { title: 'Спринт', fetchImpl: f });
    expect(calls.map(c => c.url)).toEqual(['/lore/sprint/plan', '/lore/sprint/update']);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ sprint_id: 'SPRINT_X', priority: 'P2' });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ sprint_id: 'SPRINT_X', context_md: 'old' });
  });

  it('спринт только с телами — без запроса плана', async () => {
    const { f, calls } = fake({ '/lore/sprint/update': { status: 200, body: { ok: true } } });
    await restoreRecordVersion('sprint', 'SPRINT_X', req('SPRINT_X', [
      { field: 'outcome_md', from: 'x', to: 'y', change: 'changed' },
    ]), { title: 'Спринт', fetchImpl: f });
    expect(calls.map(c => c.url)).toEqual(['/lore/sprint/update']);
  });

  it('ADR → POST /lore/adr (upsert) с adr_id, name и телами', async () => {
    const { f, calls } = fake({ '/lore/adr': { status: 200, body: { ok: true, adr_id: 'ADR-1', hist_created: true } } });
    await restoreRecordVersion('adr', 'ADR-1', req('ADR-1', [
      { field: 'decision_md', from: 'b', to: 'a', change: 'changed' },
    ]), { title: 'Решение', fetchImpl: f });
    expect(calls[0].url).toBe('/lore/adr');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ adr_id: 'ADR-1', name: 'Решение', decision_md: 'a' });
  });

  it('отказ сервера (409 CONFLICT) — ошибка с кодом, её покажет вкладка', async () => {
    const { f } = fake({ '/lore/task/edit': { status: 409, body: { error: 'CONFLICT', detail: 'версия устарела' } } });
    await expect(restoreRecordVersion('task', 'S/T-1', req('S/T-1', [
      { field: 'note_md', from: 'b', to: 'a', change: 'changed' },
    ]), { title: 'Задача', fetchImpl: f })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('поле вне RESTORABLE — отказ до записи', async () => {
    const onFetch = vi.fn();
    await expect(restoreRecordVersion('task', 'S/T-1', req('S/T-1', [
      { field: 'status_raw', from: 'A', to: 'B', change: 'changed' },
    ]), { title: 'Задача', fetchImpl: onFetch })).rejects.toThrow(/status_raw/);
    expect(onFetch).not.toHaveBeenCalled();
  });
});

// S9-09 (перепроверка 13.11 на стенде): в дифф истории попадал служебный content_hash — путь S2
// не отсекал служебные поля, как legacy. Хэш содержимого — не правка человека.
describe('S9-09 · служебные поля не попадают в историю', () => {
  it('content_hash и source_commit отсечены и из fields, и из changed', async () => {
    const body = { ...S2_BODY, versions: [{ ...S2_BODY.versions[0], fields: { note_md: 'b', content_hash: 'h2', source_commit: 'c' }, changed: ['note_md', 'content_hash'] }] };
    const { f } = fake({ '/lore/history': { status: 200, body } });
    const r = await fetchRecordHistory('task', 'S/T-1', { fetchImpl: f });
    expect(Object.keys(r.history.versions[0].fields)).toEqual(['note_md']);
    expect(r.history.versions[0].changed).toEqual(['note_md']);
  });
});
