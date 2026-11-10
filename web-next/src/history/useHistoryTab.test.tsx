// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-09, клиентская половина: источник вкладки
// «История» — фильтры, свёртка, листание, разворот серии.
//
// Было: экран держал только `histLimit`, и из параметров сервера пользовался
// одним `limit`. `author_kind` (PR #948), `author` и `collapse` (PR #1083) до
// человека не доходили.
//
// Что закрепляется:
//   • первая страница просится order=desc — иначе сервер режет хронологию с
//     НАЧАЛА и отдаёт самые старые версии как «первую страницу»;
//   • фильтр и свёртка уходят в запрос, и новый фильтр снова просит первую
//     страницу, а не прежний разросшийся предел;
//   • список авторов НАКАПЛИВАЕТСЯ: сузив выдачу до одного автора, нельзя
//     терять остальные варианты — иначе из фильтра не выйти;
//   • 403 — «нет прав», а не «истории нет»;
//   • тип без цепочки SCD2 — «история не ведётся», и фильтров у него нет:
//     фильтровать нечего;
//   • разворот серии берёт правки ТОГО ЖЕ агента без свёртки и оставляет
//     только окно серии.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HISTORY_QUERY_ALL } from '@seidr/kit';
import { useHistoryTab } from './useHistoryTab';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (over: Record<string, unknown> = {}) => ({
  entity_type: 'adr', hist_type: 'KnowADRHist', ref_id: 'ADR-1',
  state_uid: 'st-1', valid_from: '2026-11-01T10:00:00Z', valid_to: null,
  status_raw: 'ACCEPTED', content_hash: 'h1', source_commit: null,
  changed_by: 'u-1', changed_by_kind: 'human',
  author: { kind: 'human', caller: 'u-1', source: 'hist' },
  ...over,
});

const byAgent = (over: Record<string, unknown> = {}) =>
  row({ author: { kind: 'agent', caller: 'claude-code', source: 'hist' }, ...over });

const body = (rows: unknown[], page: Record<string, unknown> | null = null) => ({
  type: 'adr', id: 'ADR-1', rows,
  attribution: { ok: true, source: 'changed_by версии (S2-12)' },
  ...(page ? { page } : {}),
});

/** Сервер-заглушка: помнит все адреса, по которым его спрашивали. */
function server(reply: (url: string) => Response) {
  const urls: string[] = [];
  const f = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return reply(String(input));
  });
  return { urls, fetchImpl: f as unknown as typeof fetch };
}

const plain = () => server(() => json(body([row(), byAgent({ state_uid: 'st-2', valid_from: '2026-11-02T10:00:00Z', valid_to: '2026-11-03T10:00:00Z' })],
  { total: 7, offset: 0, limit: 20, returned: 2, has_more: true, order: 'desc' })));

const mount = (fetchImpl: typeof fetch, type = 'adr', id = 'ADR-1') =>
  renderHook(({ t, i }: { t: string; i: string }) => useHistoryTab(t, i, { fetchImpl }), { initialProps: { t: type, i: id } });

describe('S9-09 · источник вкладки «История»', () => {
  it('положительный контроль: версии прочитаны, состояние ok', async () => {
    const { fetchImpl } = plain();
    const { result } = mount(fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.data?.versions).toHaveLength(2);
  });

  it('первая страница просится новейшими: order=desc и предел страницы', async () => {
    const srv = plain();
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(srv.urls[0]).toContain('order=desc');
    expect(srv.urls[0]).toContain('limit=20');
  });

  it('фильтр по автору уходит вместе с видом автора и свёрткой', async () => {
    const srv = plain();
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    act(() => result.current.onQuery?.({ authorKind: 'agent', author: 'claude-code', field: 'status', collapse: true }));
    await waitFor(() => expect(srv.urls).toHaveLength(2));
    for (const part of ['author_kind=agent', 'author=claude-code', 'field=status', 'collapse=agent']) {
      expect(srv.urls[1]).toContain(part);
    }
  });

  it('новый фильтр просит ПЕРВУЮ страницу, а не разросшийся предел', async () => {
    const srv = plain();
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    act(() => result.current.onMore?.());
    await waitFor(() => expect(srv.urls).toHaveLength(2));
    expect(srv.urls[1]).toContain('limit=40');
    act(() => result.current.onQuery?.({ ...HISTORY_QUERY_ALL, authorKind: 'agent' }));
    await waitFor(() => expect(srv.urls).toHaveLength(3));
    expect(srv.urls[2]).toContain('limit=20');
  });

  it('«показать ещё» есть только пока сервер говорит, что дальше есть', async () => {
    const srv = server(() => json(body([row()], { total: 1, offset: 0, limit: 20, returned: 1, has_more: false, order: 'desc' })));
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.onMore).toBeUndefined();
  });

  it('варианты автора накапливаются: сужение выдачи их не съедает', async () => {
    let only = false;
    const srv = server(() => json(body(
      only ? [byAgent({ state_uid: 'st-2' })] : [row(), byAgent({ state_uid: 'st-2', valid_from: '2026-11-02T10:00:00Z' })],
    )));
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.authors).toHaveLength(2));
    only = true;
    act(() => result.current.onQuery?.({ ...HISTORY_QUERY_ALL, author: 'claude-code' }));
    await waitFor(() => expect(srv.urls).toHaveLength(2));
    await waitFor(() => expect(result.current.data?.versions).toHaveLength(1));
    expect(result.current.authors?.map(a => a.caller).sort()).toEqual(['claude-code', 'u-1']);
  });

  it('403 — «нет прав», а не «истории нет»', async () => {
    const srv = server(() => json({ error: 'SCOPE_EMPTY', detail: 'нет ни одного разрешённого проекта' }, 403));
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('forbidden'));
    expect(result.current.data).toBeUndefined();
  });

  it('тип без цепочки SCD2 — «история не ведётся», сервер не спрашивается, фильтров нет', async () => {
    const srv = server(() => json(body([])));
    const { result } = mount(srv.fetchImpl, 'nope', 'X');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.data?.tracking).toBe('not_tracked');
    expect(srv.urls).toEqual([]);
    expect(result.current.onQuery).toBeUndefined();
    expect(result.current.onExpand).toBeUndefined();
  });

  it('разворот серии: спрашиваем правки ТОГО ЖЕ агента без свёртки и берём только окно серии', async () => {
    const inside = [
      byAgent({ state_uid: 'st-5', valid_from: '2026-11-08T09:00:00Z' }),
      byAgent({ state_uid: 'st-7', valid_from: '2026-11-08T09:30:00Z' }),
      byAgent({ state_uid: 'st-9', valid_from: '2026-11-08T10:00:00Z' }),
    ];
    // Правка того же агента ПОЗЖЕ серии — в окно не входит.
    const outside = byAgent({ state_uid: 'st-11', valid_from: '2026-11-09T10:00:00Z' });
    const srv = server(url => json(url.includes('collapse=agent')
      ? body([byAgent({ state_uid: 'st-9', valid_from: '2026-11-08T10:00:00Z',
        collapsed: { count: 3, first_state_uid: 'st-5', first_valid_from: '2026-11-08T09:00:00Z' } })])
      : body([...inside, outside])));
    const { result } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    act(() => result.current.onQuery?.({ ...HISTORY_QUERY_ALL, collapse: true }));
    await waitFor(() => expect(result.current.data?.versions[0]?.collapsed?.count).toBe(3));

    const run = result.current.data!.versions[0];
    let rows: readonly unknown[] = [];
    await act(async () => { rows = await result.current.onExpand!(run); });
    const asked = srv.urls[srv.urls.length - 1];
    expect(asked).toContain('author=claude-code');
    expect(asked).not.toContain('collapse=');
    expect(rows).toHaveLength(3);
  });

  it('другая запись — фильтр и накопленные авторы сбрасываются', async () => {
    const srv = plain();
    const { result, rerender } = mount(srv.fetchImpl);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    act(() => result.current.onQuery?.({ ...HISTORY_QUERY_ALL, author: 'claude-code' }));
    await waitFor(() => expect(result.current.query?.author).toBe('claude-code'));
    rerender({ t: 'adr', i: 'ADR-2' });
    await waitFor(() => expect(result.current.query?.author).toBeNull());
  });
});
