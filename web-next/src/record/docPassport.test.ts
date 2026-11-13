// SPRINT_UXR_S5_RECORD_TASKS/S5-DOC-PASSPORT — документ (KnowDoc) открывается своим паспортом.
// Владелица 13.11.2026: «подготовить для docs в LORE паспорт — их нет». До правки ?sec=doc&open=ID
// на проде открывал «Новости»: раздела doc и типа doc в паспорте не было.
import { describe, expect, it, vi } from 'vitest';
import { recordHref, sectionOfType } from '../nav/loreRoutes';
import { V2_SECTIONS } from '../shell/v2Config';
import { docRecord } from '../lists/records';
import { PASSPORT_TYPES } from './passportAdapters';
import { savePassportField } from './passportSave';

describe('документ: раздел, маршрут, паспорт', () => {
  it('раздел doc есть в оболочке, и тип doc ведёт в него', () => {
    expect(V2_SECTIONS).toContain('doc');
    expect(sectionOfType('doc')).toBe('doc');
    expect(recordHref('doc', 'claude_rules_global')).toBe('/?mod=forseti&sec=doc&open=claude_rules_global');
  });

  it('паспорт знает тип doc', () => {
    expect(PASSPORT_TYPES).toContain('doc');
  });

  it('строка среза docs → запись без выдуманного статуса', () => {
    const r = docRecord({ doc_id: 'lore_rules', title: 'Правила', kind: 'claude-rules', component_id: 'OMILORE', parent_doc_id: 'root_doc', projects: ['NooriUta/UnlimitedLORE'] });
    expect(r).toMatchObject({
      id: 'lore_rules', kind: 'doc', title: 'Правила', status: '',
      fields: { component: 'OMILORE', components: ['OMILORE'], docKind: 'claude-rules', parent: 'root_doc', project: ['NooriUta/UnlimitedLORE'] },
    });
    expect(docRecord({ doc_id: 'no_title' }).title).toBe('no_title');
  });

  it('правка тела по пути из схемы уходит с doc_id и только своим полем', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    await savePassportField('doc', { id: 'lore_rules', title: 'Правила' }, 'content_md_ru', 'новый текст', f, null,
      { endpoint: '/lore/doc', field: 'content_md_ru' });
    expect(calls).toEqual([{ url: '/lore/doc', body: { doc_id: 'lore_rules', content_md_ru: 'новый текст' } }]);
  });
});
