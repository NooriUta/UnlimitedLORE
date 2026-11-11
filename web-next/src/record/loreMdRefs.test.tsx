// @vitest-environment jsdom
// Источник ссылок для мини-окна в MD-полях LORE (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050).
// Kit знает только форму окна; смысл (какие слова — типы, как искать) даёт приложение.
import { describe, expect, it, vi } from 'vitest';
import { loreMdRefs } from './loreMdRefs';

const rows = [
  { type: 'adr', ref_id: 'ADR-LORE-050', title: 'Ссылка на объект' },
  { type: 'task', ref_id: 'SPRINT_X/MD-1', title: null },
  { type: 'quality_gate', ref_id: 'QG-1', title: 'Гейт' },
];
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ rows }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

describe('loreMdRefs', () => {
  it('«#тип» понимает и латиницу, и русские синонимы', () => {
    const r = loreMdRefs('ru');
    expect(r.types.adr).toBe('adr');
    expect(r.types['задача']).toBe('task');
    expect(r.types['спека']).toBe('spec');
    expect(r.types['решение']).toBe('decision');
  });
  it('у каждого типа словаря есть подпись', () => {
    const r = loreMdRefs('ru');
    for (const t of new Set(Object.values(r.types))) expect(r.typeLabels[t]).toBeTruthy();
  });
  it('поиск по всем — только типы, на которые можно сослаться; пустой заголовок не падает', async () => {
    const r = loreMdRefs('ru', { fetchImpl: okFetch() });
    expect(await r.search('объект', null)).toEqual([
      { id: 'ADR-LORE-050', type: 'adr', title: 'Ссылка на объект' },
      { id: 'SPRINT_X/MD-1', type: 'task', title: '' },
    ]);
  });
  it('сужение по типу', async () => {
    const r = loreMdRefs('ru', { fetchImpl: okFetch() });
    expect((await r.search('x', 'task')).map(i => i.id)).toEqual(['SPRINT_X/MD-1']);
  });
  it('отказ сервера — бросает с причиной (окно скажет «не смогли загрузить», а не «не нашлось»)', async () => {
    const r = loreMdRefs('ru', { fetchImpl: vi.fn(async () => new Response('', { status: 503 })) });
    await expect(r.search('x', null)).rejects.toThrow(/503/);
  });
  it('искать с двух букв — по одной слайс search отдаёт шум', () => {
    expect(loreMdRefs('ru').minQuery).toBe(2);
  });
});

describe('loreRefHref — куда ведёт ссылка в чтении', () => {
  it('с типом — паспорт этого типа', async () => {
    const { loreRefHref } = await import('./loreMdRefs');
    expect(loreRefHref({ id: 'ADR-LORE-050', type: 'adr' })).toContain('open=ADR-LORE-050');
  });
  it('без типа — тип по форме ID (ADR-, SPEC-, D-2026-, SPRINT_X/CODE)', async () => {
    const { loreRefHref } = await import('./loreMdRefs');
    expect(loreRefHref({ id: 'ADR-LORE-050', type: null })).toBe(loreRefHref({ id: 'ADR-LORE-050', type: 'adr' }));
    expect(loreRefHref({ id: 'SPRINT_X/MD-1', type: null })).toBe(loreRefHref({ id: 'SPRINT_X/MD-1', type: 'task' }));
  });
  it('форму не узнали или тип открыть негде — null, а не выдуманный адрес', async () => {
    const { loreRefHref } = await import('./loreMdRefs');
    expect(loreRefHref({ id: 'UTF-8', type: null })).toBeNull();
    expect(loreRefHref({ id: 'X', type: 'no_such_type' })).toBeNull();
  });
});
