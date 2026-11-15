// SPRINT_LORE_MODEL_DOCS_TIDY/MD-04 — паспорта v2 для живых типов, у которых был список, но
// не было паспорта (роль продукта, боль, выгода, работа), раздел и паспорт ранбука, и адрес
// записи технологии. Аудит схемы 14.11 (ред. 3): «у actor, pain, gain, job есть список, но нет
// паспорта; у runbook нет ни раздела, ни паспорта; tech, вероятно, не открывается по адресу —
// нет в TYPE_SECTION».
import { describe, expect, it } from 'vitest';
import { readRoute, recordHref, sectionOfType } from '../nav/loreRoutes';
import { V2_SECTIONS } from '../shell/v2Config';
import { LIST_SCREENS } from '../lists/screens';
import { runbookRecord } from '../lists/records';
import { PASSPORT_OF } from '../pages/ListScreen';
import { PASSPORT_TYPES } from './passportAdapters';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('MD-04 · технология открывается по адресу', () => {
  it('ссылка на технологию строится и разбирается обратно в ту же запись', () => {
    const h = recordHref('tech', 'SPEC-TECH-REACT');
    expect(h, 'recordHref(tech) — null: связь «Технологии» компонента и [[tech:…]] вели в никуда').toBe('/?mod=forseti&sec=tech&open=SPEC-TECH-REACT');
    expect(readRoute(params(h!)).record).toEqual({ kind: 'tech', id: 'SPEC-TECH-REACT' });
  });
});

describe('MD-04 · паспорта живых типов', () => {
  const TYPES = ['actor', 'pain', 'gain', 'job', 'runbook'] as const;
  const SCREENS: Record<(typeof TYPES)[number], string> = {
    actor: 'actors', pain: 'pains', gain: 'gains', job: 'jobs', runbook: 'runbooks',
  };

  it('каждый тип — раздел оболочки, адрес записи и паспорт фасада', () => {
    for (const t of TYPES) {
      expect(V2_SECTIONS as readonly string[], t).toContain(t);
      expect(sectionOfType(t), t).toBe(t);
      expect(readRoute(params(recordHref(t, `${t.toUpperCase()}-1`)!)).record, t).toEqual({ kind: t, id: `${t.toUpperCase()}-1` });
      expect(PASSPORT_TYPES as readonly string[], t).toContain(t);
    }
  });

  it('щелчок по строке раздела открывает паспорт, а не отказ «паспорта нет»', () => {
    for (const t of TYPES) {
      const screen = SCREENS[t];
      expect(Object.keys(LIST_SCREENS), screen).toContain(screen);
      expect((PASSPORT_OF as Record<string, string>)[screen], screen).toBe(t);
    }
  });

  it('проект остаётся последним типом паспорта (как у фасада)', () => {
    expect(PASSPORT_TYPES[PASSPORT_TYPES.length - 1]).toBe('project');
  });

  it('строка среза runbooks → запись kit: код, название, область, проекты; статус не выдуман', () => {
    expect(runbookRecord({
      runbook_id: 'RUNBOOK-FRIGG', name: 'Frigg', area: 'infra', date_created: '2026-10-01T10:00:00Z',
      adr_ids: ['ADR-LORE-001'], projects: ['NooriUta/UnlimitedLORE'],
    })).toMatchObject({
      id: 'RUNBOOK-FRIGG', kind: 'runbook', title: 'Frigg', status: '',
      fields: { area: 'infra', adrs: ['ADR-LORE-001'], project: ['NooriUta/UnlimitedLORE'] },
    });
    expect(runbookRecord({ runbook_id: 'R-2' }).title).toBe('R-2');
  });
});
