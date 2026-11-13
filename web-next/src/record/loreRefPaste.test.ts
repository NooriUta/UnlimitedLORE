// MD-WINDOW §3a в LORE (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW): формы голых ID для вставки и проверка,
// есть ли записи, через фасад записи. 404 — «нет», 403 — «есть» (запись существует, прав нет),
// сбой сети/сервера — «не смогли проверить» (null, не красим). Тип — из [[тип:…]] или по форме ID.
import { describe, expect, it, vi } from 'vitest';
import { wrapBareRefs } from '@seidr/kit/content';
import { LORE_ID_FORMS, loreRefsExist } from './loreRefPaste';

describe('LORE_ID_FORMS — какие голые ID оборачивать', () => {
  it('ADR, спека, решение, задача спринта, спринт; задача — раньше спринта', () => {
    const out = wrapBareRefs('ADR-LORE-050, SPEC-LORE-MD-INLINE-REF, D-2026-LORE-PEEK-ONE-CARD, SPRINT_UXR_X/PU-09, SPRINT_UXR_X.', [...LORE_ID_FORMS]);
    expect(out).toBe('[[adr:ADR-LORE-050]], [[spec:SPEC-LORE-MD-INLINE-REF]], [[decision:D-2026-LORE-PEEK-ONE-CARD]], [[task:SPRINT_UXR_X/PU-09]], [[sprint:SPRINT_UXR_X]].');
  });
  it('обычные слова и строчные не трогает', () => {
    expect(wrapBareRefs('adr-1 и UTF-8, ADR без номера', [...LORE_ID_FORMS])).toBe('adr-1 и UTF-8, ADR без номера');
  });
});

describe('loreRefsExist — есть ли записи', () => {
  it('200 — есть, 404 — нет, 403 — есть, 500 — не смогли, без типа — не смогли', async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      const status = u.includes('ADR-OK') ? 200 : u.includes('ADR-NO') ? 404 : u.includes('ADR-LOCK') ? 403 : 500;
      return new Response(JSON.stringify(status === 404 ? { error: 'NOT_FOUND' } : {}), { status, headers: { 'content-type': 'application/json' } });
    });
    const r = await loreRefsExist([
      { id: 'ADR-OK', type: 'adr' }, { id: 'ADR-NO', type: null }, { id: 'ADR-LOCK', type: 'adr' }, { id: 'ADR-ERR', type: 'adr' }, { id: 'непонятно', type: null },
    ], f as unknown as typeof fetch);
    expect(r).toEqual({ 'ADR-OK': true, 'ADR-NO': false, 'ADR-LOCK': true, 'ADR-ERR': null, 'непонятно': null });
  });
});

describe('loreMdRefs несёт формы и проверку (MD-WINDOW §3a подключён)', () => {
  it('forms — формы LORE; exists — проверка фасадом', async () => {
    const { loreMdRefs } = await import('./loreMdRefs');
    const f = vi.fn(async () => new Response('{}', { status: 404 }));
    const r = loreMdRefs('ru', { fetchImpl: f as unknown as typeof fetch });
    expect(r.forms).toBe(LORE_ID_FORMS);
    expect(await r.exists!([{ id: 'ADR-NO', type: 'adr' }])).toEqual({ 'ADR-NO': false });
  });
});
