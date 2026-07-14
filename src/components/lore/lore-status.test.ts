import { describe, expect, it } from 'vitest';
import { resolveStatusMeta, statusLabel, statusMeta, taskTick } from './lore-status';

// This is the exact mapping that decided whether T100's StatusPicker rendered the
// correct pressed state during the T100-status-bug investigation this sprint (turned
// out not to be a bug in taskTick — but the function had zero test coverage, so a
// future regression here would again look like "the status picker is broken").
describe('taskTick', () => {
  it('maps every canonical emoji-prefixed status_raw to its key', () => {
    expect(taskTick('✅ DONE')).toEqual({ status: 'done', done: true });
    expect(taskTick('🔄 IN PROGRESS')).toEqual({ status: 'active', done: false });
    expect(taskTick('🟡 PARTIAL')).toEqual({ status: 'partial', done: false });
    expect(taskTick('🚀 READY FOR DEPLOY')).toEqual({ status: 'ready_for_deploy', done: false });
    expect(taskTick('🔴 BLOCKED')).toEqual({ status: 'blocked', done: false });
    expect(taskTick('🚫 CANCELLED')).toEqual({ status: 'cancelled', done: false });
    expect(taskTick('🔬 DESIGN')).toEqual({ status: 'design', done: false });
    expect(taskTick('🟣 BACKLOG')).toEqual({ status: 'backlog', done: false });
    expect(taskTick('📋 PLANNED')).toEqual({ status: 'planned', done: false });
    expect(taskTick('⬜ TODO')).toEqual({ status: 'todo', done: false });
  });

  it('matches by leading marker even with trailing noise (e.g. a version string)', () => {
    expect(taskTick('✅ DONE (v1.0.44)')).toEqual({ status: 'done', done: true });
  });

  it('falls back to todo for null/undefined/empty/unrecognized input', () => {
    expect(taskTick(null)).toEqual({ status: 'todo', done: false });
    expect(taskTick(undefined)).toEqual({ status: 'todo', done: false });
    expect(taskTick('')).toEqual({ status: 'todo', done: false });
    expect(taskTick('some unrelated text')).toEqual({ status: 'todo', done: false });
  });

  it('matches Russian text markers as well as emoji', () => {
    expect(taskTick('ЗАВЕРШЕНО')).toEqual({ status: 'done', done: true });
    expect(taskTick('ОТМЕНЕНО')).toEqual({ status: 'cancelled', done: false });
  });

  it('leading-whitespace is trimmed before matching', () => {
    expect(taskTick('   🚫 CANCELLED')).toEqual({ status: 'cancelled', done: false });
  });
});

describe('statusMeta / resolveStatusMeta', () => {
  it('resolves a clean status key directly', () => {
    expect(statusMeta('done').icon).toBe('divided-spiral');
  });

  it('falls back to the neutral icon for an unknown clean key', () => {
    expect(statusMeta('not-a-real-status')).toEqual({ icon: 'checkbox-tree', color: 'var(--t3)' });
  });

  it('resolveStatusMeta normalizes an emoji-prefixed raw status through taskTick', () => {
    // 'cancelled' IS in STATUS_META directly, so this also exercises the direct-hit path.
    expect(resolveStatusMeta('🚫 CANCELLED')).toEqual(statusMeta('cancelled'));
    // 'ready_for_deploy' likewise resolves via taskTick's normalized key.
    expect(resolveStatusMeta('🚀 READY FOR DEPLOY')).toEqual(statusMeta('ready_for_deploy'));
  });
});

describe('statusLabel', () => {
  it('strips a leading emoji marker so the chip icon is not duplicated', () => {
    expect(statusLabel('✅ DONE')).toBe('DONE');
    expect(statusLabel('🚫 CANCELLED')).toBe('CANCELLED');
  });

  it('passes a clean key through unchanged', () => {
    expect(statusLabel('accepted')).toBe('accepted');
  });

  it('falls back to the raw string when stripping would leave nothing', () => {
    expect(statusLabel('✅')).toBe('✅');
  });
});
