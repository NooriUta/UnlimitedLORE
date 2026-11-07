// SPRINT_UXR_S5_RECORD_TASKS/S5-11 · модель вкладки «История»: кто правил
// (человек/агент/неизвестно), сравнение двух версий, план возврата старой
// версии как новой (только поля, которые умеет писать write-API).
import { describe, expect, it } from 'vitest';
import {
  compareBase, currentVersion, diffVersions, historyAuthor, restoreChanges, versionKey,
  type KitHistoryVersion,
} from './history';

const v = (over: Partial<KitHistoryVersion>): KitHistoryVersion => ({
  state_uid: null, valid_from: null, valid_to: null, is_open: false, status: null,
  fields: {}, changed: [], author: { kind: 'unknown' }, ...over,
});

const NEW = v({ state_uid: 's3', valid_from: '2026-11-07T10:00:00Z', is_open: true, status: 'IN_PROGRESS',
  fields: { note_md: 'третья', effort_days: 2, status_raw: 'IN_PROGRESS' },
  author: { kind: 'agent', client_id: 'claude-code', actor_id: 'A-1', session_id: null, owner_kc_sub: 'u-1' } });
const MID = v({ state_uid: 's2', valid_from: '2026-11-06T10:00:00Z', valid_to: '2026-11-07T10:00:00Z',
  fields: { note_md: 'вторая', effort_days: 1, status_raw: 'TODO' },
  author: { kind: 'human', kc_sub: 'u-1', display_name: 'Маша' } });
const OLD = v({ state_uid: 's1', valid_from: '2026-11-05T10:00:00Z', valid_to: '2026-11-06T10:00:00Z',
  fields: { note_md: 'первая', status_raw: 'TODO' } });

describe('S5-11 · history: diffVersions', () => {
  it('изменённое, появившееся и пропавшее поле — по алфавиту; одинаковое пропущено', () => {
    expect(diffVersions({ a: 1, b: 'x', c: 'same', d: 'gone' }, { a: 2, b: 'x', c: 'same', e: 'new' })).toEqual([
      { field: 'a', from: 1, to: 2, change: 'changed' },
      { field: 'd', from: 'gone', to: null, change: 'removed' },
      { field: 'e', from: null, to: 'new', change: 'added' },
    ]);
  });

  it('первая версия (older = null) — все непустые поля «появились»', () => {
    expect(diffVersions(null, { note_md: 'x', effort_days: null })).toEqual([
      { field: 'note_md', from: null, to: 'x', change: 'added' },
    ]);
  });

  it('null, undefined и пропущенный ключ — одно и то же «пусто», а объекты сравниваются по значению', () => {
    expect(diffVersions({ a: null, o: { k: [1] } }, { o: { k: [1] } })).toEqual([]);
  });
});

describe('S5-11 · history: автор правки', () => {
  it('человек — имя, иначе kc_sub; агент — client_id и владелец; без авторства — unknown', () => {
    expect(historyAuthor(MID.author)).toEqual({ kind: 'human', name: 'Маша' });
    expect(historyAuthor({ kind: 'human', kc_sub: 'u-7', display_name: null })).toEqual({ kind: 'human', name: 'u-7' });
    expect(historyAuthor(NEW.author)).toEqual({ kind: 'agent', name: 'claude-code', owner: 'u-1' });
    expect(historyAuthor({ kind: 'unknown' })).toEqual({ kind: 'unknown', name: null });
  });
});

describe('S5-11 · history: выбор версий для сравнения', () => {
  const list = [NEW, MID, OLD];

  it('ключ версии — state_uid, без него — valid_from и позиция', () => {
    expect(versionKey(NEW, 0)).toBe('s3');
    expect(versionKey(v({ valid_from: '2026-01-01' }), 4)).toBe('2026-01-01#4');
  });

  it('текущая — открытая версия, нет открытой — новейшая', () => {
    expect(currentVersion(list)).toBe(NEW);
    expect(currentVersion([MID, OLD])).toBe(MID);
    expect(currentVersion([])).toBeUndefined();
  });

  it('по умолчанию версия сравнивается с предыдущей (более старой); у первой — ни с чем', () => {
    expect(compareBase(list, 's3')).toBe('s2');
    expect(compareBase(list, 's2')).toBe('s1');
    expect(compareBase(list, 's1')).toBeNull();
    expect(compareBase(list, 'nope')).toBeNull();
  });
});

describe('S5-11 · history: возврат версии как новой', () => {
  it('только поля, которые пишет write-API, и только отличные от текущей: from = текущее, to = из старой версии', () => {
    expect(restoreChanges(OLD, NEW, ['note_md', 'effort_days'])).toEqual([
      { field: 'effort_days', from: 2, to: null, change: 'removed' },
      { field: 'note_md', from: 'третья', to: 'первая', change: 'changed' },
    ]);
  });

  it('статус и служебные поля не возвращаются, даже если отличаются', () => {
    expect(restoreChanges(OLD, NEW, ['note_md']).map(c => c.field)).toEqual(['note_md']);
  });

  it('версия, совпадающая с текущей по возвращаемым полям, — пустой план', () => {
    expect(restoreChanges(v({ fields: { note_md: 'третья', effort_days: 2 } }), NEW, ['note_md', 'effort_days'])).toEqual([]);
  });
});
