// SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 — паспорт PR. Критерий задачи: «у PR есть паспорт с заголовком и ссылкой».
// До него связь «PR» у задачи и релиза вела на тип без паспорта: recordHref('pr') давал null, щелчок — в никуда.
// Раздела-списка у PR нет (как у трека, MDL-13): паспорт открывается в разделе «Релизы» с видом в адресе (?okind=pr).
import { describe, expect, it } from 'vitest';
import { readRoute, recordHref, sectionOfType } from '../nav/loreRoutes';
import { passportTypeFor } from '../pages/ListScreen';
import { PASSPORT_TYPES } from './passportAdapters';
import { loreKinds } from '../shell/loreKinds';
import { LORE_GRAPH_TYPES } from './loreGraph';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));
const UID = 'NooriUta/UnlimitedLORE#1641';

describe('паспорт PR (MD-05)', () => {
  // 21.11.2026 («в меню под релизы вход в PR сделай»): у PR свой раздел «PR» — prSection.test.ts.
  it('паспорт есть, раздел — «PR»: ключ с «#» доходит целиком', () => {
    expect(PASSPORT_TYPES as readonly string[]).toContain('pr');
    expect(PASSPORT_TYPES[PASSPORT_TYPES.length - 1]).toBe('project');
    expect(sectionOfType('pr')).toBe('pr');
    const p = params(recordHref('pr', UID)!);
    expect(p.get('sec')).toBe('pr');
    expect(p.get('open')).toBe(UID);
    expect(readRoute(p).record).toEqual({ kind: 'pr', id: UID });
    expect(passportTypeFor('prs', null)).toBe('pr');
  });

  it('вид PR назван и в оболочке, и в графе — на обоих языках', () => {
    expect(loreKinds('ru')?.pr?.title).toBe('PR');
    expect(loreKinds('en')?.pr?.title).toBe('PRs');
    expect(LORE_GRAPH_TYPES('ru').pr?.label).toBe('PR');
    expect(LORE_GRAPH_TYPES('en').pr?.label).toBe('PR');
  });
});
