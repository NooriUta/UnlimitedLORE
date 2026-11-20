// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 — трек спринта по ребру ON_TRACK и паспорт трека (владелица 20.11.2026: «треки б»,
// «трек как веха но меньше паспорт ему тоже сделай»). Раздела-списка у трека нет, пока нет прототипа: паспорт
// открывается из паспорта спринта — в разделе «Спринты» с видом в адресе (?okind=track, как задача в «Спринтах», PU-29).
import { describe, expect, it, vi } from 'vitest';
import { readRoute, recordHref, sectionOfType } from '../nav/loreRoutes';
import { passportTypeFor } from '../pages/ListScreen';
import { PASSPORT_TYPES } from './passportAdapters';
import { passportHref } from './passportHref';
import { relationOptionsHook } from './relationOptions';
import { sprintRecord } from '../lists/records';
import { LIST_SCREENS } from '../lists/screens';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('трек спринта (MDL-13)', () => {
  it('паспорт трека есть, своего раздела нет: ссылка ведёт в «Спринты» с видом track', () => {
    expect(PASSPORT_TYPES as readonly string[]).toContain('track');
    expect(sectionOfType('track'), 'раздела-списка у трека нет').toBeNull();
    const h = recordHref('track', '2');
    expect(h).not.toBeNull();
    const p = params(h!);
    expect(p.get('sec')).toBe('sprint');
    expect(p.get('open')).toBe('2');
    expect(p.get('okind')).toBe('track');
    expect(readRoute(p).record).toEqual({ kind: 'sprint', id: '2' });
    expect(passportTypeFor('sprints', 'track'), 'в «Спринтах» открывается паспорт трека').toBe('track');
    expect(passportTypeFor('adrs', 'track'), 'в чужом разделе трек не открывается').toBe('adr');
  });

  it('чип трека в паспорте спринта (значение — чип по ребру) открывает паспорт трека', () => {
    const href = passportHref([], { track: [{ id: '2', label: 'Hound / Parser', inherited_from: null }] }, id => '#' + id);
    expect(href('2')).toBe(recordHref('track', '2'));
  });

  it('выбор трека — срез треков {code, title}, по типу цели связи ON_TRACK', async () => {
    const slice = vi.fn(async () => ({ rows: [{ code: '2', title: 'Hound / Parser' }, { code: '11', title: 'ANVIL + MIMIR' }] }));
    const hook = relationOptionsHook([{ rel: 'ON_TRACK', dir: 'out', target_type: 'track', label: 'Трек' }], slice);
    const opts = await hook({ type: 'sprint', id: 'SPRINT_X', rel: 'ON_TRACK', dir: 'out', query: 'hound' });
    expect(slice).toHaveBeenCalledWith('track_options', undefined);
    expect(opts).toEqual([{ id: '2', title: 'Hound / Parser', type: 'track' }]);
  });

  it('список спринтов: трек — чип по ребру (track_id + track_label), по нему есть дорожки', () => {
    const r = sprintRecord({ sprint_id: 'SPRINT_HOUND_S3', name: 'H', status_raw: '🔄 IN PROGRESS', track_id: '2', track_label: 'Hound / Parser' });
    expect(r.fields.track).toEqual([{ id: '2', label: 'Hound / Parser' }]);
    expect(sprintRecord({ sprint_id: 'S', name: 'S' }).fields.track, 'нет трека — пусто, а не выдуманный').toEqual([]);
    const cfg = LIST_SCREENS.sprints.config('ru');
    expect(cfg.list?.groupings).toContain('track');
    expect(cfg.kinds?.sprint?.fields?.find(f => f.key === 'track')).toMatchObject({ type: 'ref', refKind: 'track' });
  });
});
