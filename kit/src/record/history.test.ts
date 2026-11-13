// SPRINT_UXR_S5_RECORD_TASKS/S5-11 · модель вкладки «История»: кто правил
// (человек/агент/неизвестно), сравнение двух версий, план возврата старой
// версии как новой (только поля, которые умеет писать write-API).
import { describe, expect, it } from 'vitest';
import {
  HISTORY_QUERY_ALL, authorCaller, authorOptions, collapsedView, compareBase, currentVersion,
  diffVersions, historyAuthor, mergeAuthorOptions, narrowed, restoreChanges, versionKey,
  type KitHistoryVersion,
} from './history';

const v = (over: Partial<KitHistoryVersion>): KitHistoryVersion => ({
  state_uid: null, valid_from: null, valid_to: null, is_open: false, status: null,
  fields: {}, changed: [], author: { kind: 'unknown' }, ...over,
});

const NEW = v({ state_uid: 's3', valid_from: '2026-11-07T10:00:00Z', is_open: true, status: 'IN_PROGRESS',
  fields: { note_md: 'третья', effort_days: 2, status_raw: 'IN_PROGRESS' },
  author: { kind: 'agent', id: 'claude-code', name: null, owner: 'u-1' } });
const MID = v({ state_uid: 's2', valid_from: '2026-11-06T10:00:00Z', valid_to: '2026-11-07T10:00:00Z',
  fields: { note_md: 'вторая', effort_days: 1, status_raw: 'TODO' },
  author: { kind: 'human', id: 'u-1', name: 'Маша' } });
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
  it('человек — имя, иначе id; агент — имя (иначе id) и владелец; без авторства — unknown', () => {
    expect(historyAuthor(MID.author)).toEqual({ kind: 'human', name: 'Маша' });
    expect(historyAuthor({ kind: 'human', id: 'u-7', name: null })).toEqual({ kind: 'human', name: 'u-7' });
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

// ─── SPRINT_UXR_S9_SCALE_OPT/S9-09 · фильтры, свёртка, честный счёт ──────────
describe('S9-09 · history: кто правил — как выбор', () => {
  it('идентификатор автора — id (у LORE: человек — kc_sub, агент — client_id), неизвестный — ничего', () => {
    expect(authorCaller(MID.author)).toBe('u-1');
    expect(authorCaller(NEW.author)).toBe('claude-code');
    expect(authorCaller(OLD.author)).toBeNull();
  });

  it('варианты для выбора — только авторы загруженных версий, с числом правок', () => {
    const opts = authorOptions([NEW, MID, OLD]);
    expect(opts.map(o => o.caller)).toEqual(['claude-code', 'u-1']);
    expect(opts.map(o => o.kind)).toEqual(['agent', 'human']);
    expect(opts.every(o => o.count === 1)).toBe(true);
  });

  it('свёрнутая серия считается своим числом правок, а не одной строкой', () => {
    const run = v({ state_uid: 's9', valid_from: '2026-11-08T10:00:00Z', author: NEW.author,
      collapsed: { count: 4, first_state_uid: 's6', first_valid_from: '2026-11-08T09:00:00Z' } });
    expect(authorOptions([run, MID]).find(o => o.caller === 'claude-code')?.count).toBe(4);
  });

  it('автор без идентификатора в выбор не попадает: «неизвестен» — не автор', () => {
    expect(authorOptions([OLD])).toEqual([]);
  });

  it('объединение вариантов не теряет уже известных авторов при сужении фильтра', () => {
    const known = authorOptions([NEW, MID]);
    // Выдача сузилась до одного автора — список выбора обязан остаться полным,
    // иначе из фильтра нельзя выйти обратно на другого автора.
    expect(mergeAuthorOptions(known, authorOptions([NEW])).map(o => o.caller)).toEqual(['claude-code', 'u-1']);
  });
});

describe('S9-09 · history: сужен ли фильтр', () => {
  it('положительный контроль: фильтров нет — выдача не сужена', () => {
    expect(narrowed(HISTORY_QUERY_ALL)).toBe(false);
    expect(narrowed(undefined)).toBe(false);
  });

  it('вид автора, автор и «что менялось» сужают выдачу', () => {
    expect(narrowed({ ...HISTORY_QUERY_ALL, authorKind: 'agent' })).toBe(true);
    expect(narrowed({ ...HISTORY_QUERY_ALL, author: 'u-1' })).toBe(true);
    expect(narrowed({ ...HISTORY_QUERY_ALL, field: 'status' })).toBe(true);
  });

  it('свёртка выдачу НЕ сужает: правки те же, строк меньше', () => {
    expect(narrowed({ ...HISTORY_QUERY_ALL, collapse: true })).toBe(false);
  });
});

describe('S9-09 · history: свёрнут ли вид', () => {
  const page = (over: Record<string, unknown> = {}) => ({ limit: 20, offset: 0, total: 7, has_more: true, ...over });

  it('эхо сервера главнее запроса экрана: он сказал, что свернул', () => {
    expect(collapsedView(page({ collapse: 'agent' }), HISTORY_QUERY_ALL)).toBe(true);
  });

  it('сервер эха не дал — верим запросу экрана, но не выдумываем', () => {
    expect(collapsedView(page(), { ...HISTORY_QUERY_ALL, collapse: true })).toBe(true);
    expect(collapsedView(null, HISTORY_QUERY_ALL)).toBe(false);
  });

  it('эхо сказало «не свёрнуто» — это ответ сервера, а не наше желание', () => {
    expect(collapsedView(page({ collapse: null }), { ...HISTORY_QUERY_ALL, collapse: true })).toBe(false);
  });
});
