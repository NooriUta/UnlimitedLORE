// Лента как ВИД того же источника — модель (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW,
// spec:SPEC-LORE-KIT-FEED-VIEW §2, §3, §6).
//
// Почему модель отдельным файлом, а не внутри ListView: правила ленты —
// «по какому полю время», «в какое ведро попала запись», «куда встаёт провал
// источника» — проверяемы без разметки, и именно они легче всего врут. Ленту
// читают как ПОТОК СОБЫТИЙ: пропуск в ней читается как «ничего не было», и
// поэтому «нет времени», «время не прочиталось», «сбой» и «нет прав» обязаны
// быть РАЗНЫМИ исходами, а не одним «ничего не показали».
//
// kit не угадывает, какое поле записи главное (водораздел K-14): поле времени,
// поля сути и связи-поводы приходят НАЗВАННЫМИ приложением.
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '../core/contract';
import {
  FEED_GAPS, FEED_UNDATED, FEED_UNREAD, feedBucket, feedByGroups, feedByTime, feedGaps, feedOrder, feedTime,
} from './feedModel';
import type { ListGroup } from './listModel';

const NOW = '2026-11-10T12:00:00Z';

const rec = (id: string, fields: Record<string, unknown>, updated_at?: string): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields, ...(updated_at ? { updated_at } : {}) });

const ids = (rows: { kind: string; record?: KitRecord; gap?: { block: string } }[]): string[] =>
  rows.map(r => (r.kind === 'record' ? r.record!.id : `gap:${r.gap!.block}`));

describe('K2-FEED-VIEW · время записи — по НАЗВАННОМУ полю', () => {
  it('положительный контроль: названо верхнее поле — время берётся из него', () => {
    expect(feedTime(rec('a', {}, '2026-11-10T09:00:00Z'), 'updated_at')).toBe('2026-11-10T09:00:00Z');
  });

  it('названо поле вида — время берётся оттуда, а не из updated_at', () => {
    const r = rec('a', { happened: '2026-01-02T03:04:00Z' }, '2026-11-10T09:00:00Z');
    expect(feedTime(r, 'fields.happened')).toBe('2026-01-02T03:04:00Z');
  });

  it('названного поля у записи нет — null, и это НЕ ошибка: запись пойдёт в «без времени»', () => {
    expect(feedTime(rec('a', {}), 'updated_at')).toBeNull();
    expect(feedTime(rec('a', { happened: '' }), 'fields.happened')).toBeNull();
  });
});

describe('K2-FEED-VIEW · ведра времени (§3): сегодня · вчера · на этой неделе · раньше', () => {
  it('положительный контроль: сегодняшняя отметка — «сегодня»', () => {
    expect(feedBucket('2026-11-10T00:30:00Z', NOW)).toBe('today');
  });

  it('вчера, на этой неделе и раньше — разные ведра', () => {
    expect(feedBucket('2026-11-09T23:59:00Z', NOW)).toBe('yesterday');
    expect(feedBucket('2026-11-05T10:00:00Z', NOW)).toBe('week');
    expect(feedBucket('2026-10-01T10:00:00Z', NOW)).toBe('earlier');
  });

  it('нет времени — своё ведро, а не «раньше»: «нет отметки» ≠ «давно»', () => {
    expect(feedBucket(null, NOW)).toBe(FEED_UNDATED);
  });

  it('отметка есть, но не разобрали — третий исход: «не прочиталось» ≠ «нет времени»', () => {
    expect(feedBucket('позавчера', NOW)).toBe(FEED_UNREAD);
    expect(feedBucket(FEED_UNREAD, NOW)).not.toBe(FEED_UNDATED);
  });
});

describe('K2-FEED-VIEW · порядок и группы по времени', () => {
  const rs = [
    rec('old', {}, '2026-10-01T10:00:00Z'),
    rec('none', {}),
    rec('today1', {}, '2026-11-10T09:00:00Z'),
    rec('yest', {}, '2026-11-09T08:00:00Z'),
    rec('today2', {}, '2026-11-10T11:00:00Z'),
  ];

  it('умолчание порядка — свежие сверху, записи без времени в конце', () => {
    expect(feedOrder(rs, 'updated_at').map(r => r.id)).toEqual(['today2', 'today1', 'yest', 'old', 'none']);
  });

  it('группы идут сверху вниз по времени, «без времени» — последней и НЕ теряется', () => {
    const gs = feedByTime(feedOrder(rs, 'updated_at'), [], 'updated_at', NOW);
    expect(gs.map(g => g.key)).toEqual(['today', 'yesterday', 'earlier', FEED_UNDATED]);
    expect(ids(gs[0].rows)).toEqual(['today2', 'today1']);
    expect(ids(gs[3].rows)).toEqual(['none']);
    // Ни одна запись не исчезла — это и есть «не теряется».
    expect(gs.flatMap(g => ids(g.rows)).sort()).toEqual(rs.map(r => r.id).sort());
  });

  it('пустых групп не рисуем: ведро без записей в выдаче не появляется', () => {
    const gs = feedByTime([rs[2]], [], 'updated_at', NOW);
    expect(gs.map(g => g.key)).toEqual(['today']);
  });
});

describe('K2-FEED-VIEW · честные состояния источника (§6)', () => {
  it('положительный контроль: ошибок нет — провалов нет', () => {
    expect(feedGaps({})).toEqual([]);
  });

  it('«нет прав» и «не смогли проверить» — РАЗНЫЕ исходы, а не один', () => {
    const gs = feedGaps({ errors: [
      { block: 'x', reason: 'сеть не ответила' },
      { block: 'y', reason: '403', forbidden: true },
    ] });
    expect(gs.map(g => g.kind)).toEqual(['failed', 'forbidden']);
    // Причина названа: «не смогли проверить» без причины бесполезно.
    expect(gs[0].reason).toBe('сеть не ответила');
  });

  it('провал встаёт В ПОРЯДКЕ ВРЕМЕНИ — на том месте, где запись была бы', () => {
    const rs = [
      rec('a', {}, '2026-11-10T11:00:00Z'),
      rec('b', {}, '2026-11-10T09:00:00Z'),
    ];
    const gs = feedByTime(rs, feedGaps({ errors: [{ block: 'src', reason: '403', forbidden: true, at: '2026-11-10T10:00:00Z' }] }), 'updated_at', NOW);
    expect(gs).toHaveLength(1);
    expect(ids(gs[0].rows)).toEqual(['a', 'gap:src', 'b']);
  });

  it('у провала нет времени — он идёт в «без времени», а не притворяется свежим', () => {
    const gs = feedByTime([rec('a', {}, '2026-11-10T11:00:00Z')], feedGaps({ errors: [{ block: 'src', reason: 'сбой' }] }), 'updated_at', NOW);
    expect(gs.map(g => g.key)).toEqual(['today', FEED_UNDATED]);
    expect(ids(gs[1].rows)).toEqual(['gap:src']);
  });

  it('записей нет вовсе, а провал есть — лента всё равно его показывает', () => {
    const gs = feedByTime([], feedGaps({ errors: [{ block: 'src', reason: '403', forbidden: true, at: '2026-11-10T10:00:00Z' }] }), 'updated_at', NOW);
    expect(gs.flatMap(g => ids(g.rows))).toEqual(['gap:src']);
  });
});

describe('K2-FEED-VIEW · группировка из таблицы работает в ленте (§3)', () => {
  const groups: ListGroup[] = [
    { key: 'todo', records: [rec('a', {}, '2026-11-10T11:00:00Z'), rec('b', {}, '2026-11-09T11:00:00Z')] },
    { key: 'done', records: [rec('c', {})] },
  ];

  it('группы ленты — РОВНО те, что дала общая группировка, и в том же порядке', () => {
    const gs = feedByGroups(groups, [], 'updated_at');
    expect(gs.map(g => g.key)).toEqual(['todo', 'done']);
    expect(ids(gs[0].rows)).toEqual(['a', 'b']);
    expect(gs[0].group).toBe(groups[0]);
  });

  it('провал источника при группировке полем — своей группой: в чью группу он попал бы, неизвестно', () => {
    const gs = feedByGroups(groups, feedGaps({ errors: [{ block: 'src', reason: 'сбой' }] }), 'updated_at');
    expect(gs.map(g => g.key)).toEqual([FEED_GAPS, 'todo', 'done']);
    expect(ids(gs[0].rows)).toEqual(['gap:src']);
  });
});
