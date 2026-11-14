// SPRINT_LORE_AGENT_OBSERVABILITY/AO-02 — копилка прочитанного и отправка следа после создания.
import { describe, expect, it, vi } from 'vitest';
import { SourceTrail, createdOf, isCreate, readsOf } from './sourceTrail.js';

const ok = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });

describe('след источников (AO-02)', () => {
  it('прочитанное — только детальные срезы, ключи через запятую', () => {
    expect(readsOf('query_slice', { slice: 'adr', params: { id: 'ADR-1' } }))
      .toEqual([{ type: 'adr', id: 'ADR-1', via: 'adr' }]);
    expect(readsOf('query_slice', { slice: 'tasks_by_uids', params: { task_uids: 'S/A, S/B' } }).map(r => r.id))
      .toEqual(['S/A', 'S/B']);
    expect(readsOf('query_slice', { slice: 'sprints', params: {} })).toEqual([]);
    expect(readsOf('search', { pattern: 'x' })).toEqual([]);
  });

  it('создание — *_new и entity_upsert; запись — по ключу в ответе', () => {
    expect(isCreate('adr_new')).toBe(true);
    expect(isCreate('entity_upsert')).toBe(true);
    expect(isCreate('task_set')).toBe(false);
    expect(createdOf(ok({ ok: true, decision_id: 'D-1' }))).toEqual({ type: 'decision', id: 'D-1' });
    expect(createdOf(ok({ ok: false, adr_id: 'A' }))).toBeNull();
    expect(createdOf({ isError: true, content: [] })).toBeNull();
    expect(createdOf(ok('not json-object'))).toBeNull();
  });

  it('после создания шлёт накопленное в /lore/sources', async () => {
    const post = vi.fn(async () => ({ enabled: false, written: 0 }));
    const t = new SourceTrail(post);
    t.observe('query_slice', { slice: 'spec_by_id', params: { id: 'SPEC-1' } }, ok({}));
    t.observe('query_slice', { slice: 'decision', params: { id: 'D-0' } }, ok({}));
    await t.observe('adr_new', {}, ok({ ok: true, adr_id: 'ADR-NEW' }));
    expect(post).toHaveBeenCalledWith('/lore/sources', {
      target: { type: 'adr', id: 'ADR-NEW' },
      sources: [{ type: 'spec', id: 'SPEC-1', via: 'spec_by_id' }, { type: 'decision', id: 'D-0', via: 'decision' }],
    });
  });

  it('нечего слать — не шлёт; сбой отправки не роняет создание', async () => {
    const post = vi.fn(async () => { throw new Error('503'); });
    const log = vi.fn();
    const t = new SourceTrail(post, log);
    expect(t.observe('adr_new', {}, ok({ adr_id: 'A' }))).toBeUndefined();
    t.observe('query_slice', { slice: 'adr', params: { id: 'ADR-1' } }, ok({}));
    await expect(t.observe('adr_new', {}, ok({ adr_id: 'A2' }))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('не записан'));
  });

  it('копилка ограничена', () => {
    const t = new SourceTrail(vi.fn());
    for (let i = 0; i < 150; i++) t.observe('query_slice', { slice: 'adr', params: { id: `A${i}` } }, ok({}));
    expect(t.snapshot()).toHaveLength(100);
    expect(t.snapshot()[99].id).toBe('A149');
  });
});
