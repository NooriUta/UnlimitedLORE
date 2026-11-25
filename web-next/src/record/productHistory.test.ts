// SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (владелец 25.11.2026: «историчность доделываем»). Первая волна правки
// паспортов дала правку боли, выгоды, работы, роли продукта и фичи, но во вкладке «История» их правки не появлялись:
// типов не было в таблице цепочек SCD2, и вкладка честно говорила «история не ведётся». Теперь цепочки есть
// (KnowPainHist … KnowUseCaseHist, доводка v5), версия несёт снимок полей — и дифф во вкладке показывает, что поменялось.
import { describe, expect, it } from 'vitest';
import { HISTORY_HIST_CLASS } from '../api/contracts/s2';
import { HISTORY_TRACKED, historyFromServer } from './historySource';

const WAVE1 = ['pain', 'gain', 'job', 'actor', 'feature'] as const;

describe('AP-PASSPORT-EDIT · история боли, выгоды, работы, роли и фичи', () => {
  it('вкладка «История» у пяти типов спрашивает сервер, а не пишет «история не ведётся»', () => {
    for (const t of WAVE1) expect(HISTORY_TRACKED.has(t), t).toBe(true);
    expect(HISTORY_HIST_CLASS.pain).toBe('KnowPainHist');
    expect(HISTORY_HIST_CLASS.actor).toBe('KnowProjectActorHist');
    expect(HISTORY_HIST_CLASS.feature).toBe('KnowUseCaseHist');
    // положительный контроль: тип без цепочки по-прежнему не спрашивается
    expect(HISTORY_TRACKED.has('quality_gate')).toBe(false);
  });

  it('правка названия боли — новая версия со снимком; дифф называет поле, а не хэш', () => {
    const h = historyFromServer({
      type: 'pain', id: 'PAIN-SLOW',
      rows: [
        { state_uid: 's1', valid_from: '2026-11-25T10:00:00.000Z', valid_to: '2026-11-25T12:00:00.000Z', content_hash: 'a1',
          title: 'Медленно', severity: 'high', body_md: 'текст', author: { kind: 'unknown' } },
        { state_uid: 's2', valid_from: '2026-11-25T12:00:00.000Z', valid_to: null, content_hash: 'b2',
          title: 'Медленный поиск', severity: 'high', body_md: 'текст', author: { kind: 'human', caller: 'u-1', source: 'hist' } },
      ],
      attribution: { ok: true },
    });
    expect(h.tracking).toBe('scd2');
    expect(h.versions.map(v => v.state_uid)).toEqual(['s2', 's1']);
    expect(h.versions[0].is_open).toBe(true);
    expect(h.versions[0].changed).toEqual(['title']);
    expect(h.versions[0].fields.title).toBe('Медленный поиск');
    expect(h.versions[1].fields.title).toBe('Медленно');
  });
});
