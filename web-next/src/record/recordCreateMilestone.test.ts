// SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT, волна 2 — веха (решения владельца 25.11.2026: 3а — «только чтение»
// снимается вместе с «+ Новая»; 4а — после продуктового слоя первой идёт веха).
//
// Путь записи — существующий POST /lore/milestone: пишет только переданные поля, код — milestone_id,
// название — label. Создание — строгим ?mode=create (на занятый код сервер отвечает 409 ID_TAKEN).
import { describe, expect, it, vi } from 'vitest';
import { CREATE_TYPES, createFields, createRequest, saveCreate, suggestCode } from './recordCreate';
import { savePassportField } from './passportSave';
import { STAND_CREATE_TYPES } from '../standSmoke/createCoverage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function net(probe: number, write: () => Response = () => json(200, { ok: true, milestone_id: 'M-X' })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('/lore/record/')) return json(probe, probe === 200 ? { record: {} } : { error: 'NOT_FOUND' });
    return write();
  }) as unknown as typeof fetch;
  return { impl, calls, posts: () => calls.filter(c => c.init?.method === 'POST') };
}
const bodyOf = (c: { init?: RequestInit }) => JSON.parse(String(c.init?.body)) as Record<string, unknown>;

describe('AP-PASSPORT-EDIT · волна 2: веха', () => {
  it('веха — среди типов с «+ Новая» (и в копии для стенда)', () => {
    expect(CREATE_TYPES).toContain('milestone');
    expect(STAND_CREATE_TYPES).toContain('milestone');
  });

  it('создание: название и код обязательны, запись — /lore/milestone?mode=create, название в label', async () => {
    expect(createFields('milestone', 'ru').filter(f => f.required === 'block').map(f => f.key)).toEqual(['title', 'id']);
    expect(createRequest('milestone', { id: 'M-LORE-X', title: ' Релиз X ', goal_md: 'цель' })).toEqual({
      url: '/lore/milestone?mode=create', body: { milestone_id: 'M-LORE-X', label: 'Релиз X', goal_md: 'цель' },
    });
    const n = net(404);
    expect(await saveCreate('milestone', { id: 'M-LORE-X', title: 'Релиз X' }, { fetchImpl: n.impl, lang: 'ru' }))
      .toEqual({ ok: true, id: 'M-LORE-X' });
    expect(n.calls[0].url).toBe('/lore/record/milestone/M-LORE-X');
    expect(n.posts().map(c => c.url)).toEqual(['/lore/milestone?mode=create']);
  });

  it('код предлагается из названия с префиксом M-', () => {
    expect(suggestCode('milestone', 'Первый клиент')).toBe('M-PERVYY-KLIENT');
  });

  it('правка поля паспорта: путь модели с idKey — только это поле и milestone_id', async () => {
    const n = net(200);
    await savePassportField('milestone', { id: 'M-LORE-X', title: 'Старое' }, 'date', 'Q1 2027', n.impl, null,
      { endpoint: '/lore/milestone', field: 'date_display', idKey: 'milestone_id' });
    expect(n.posts().map(c => c.url)).toEqual(['/lore/milestone']);
    expect(bodyOf(n.posts()[0])).toEqual({ milestone_id: 'M-LORE-X', date_display: 'Q1 2027' });
  });

  it('занятый код: проба 200 — «уже есть» без записи; гонка 409 ID_TAKEN — тоже «уже есть»', async () => {
    const taken = net(200);
    const r = await saveCreate('milestone', { id: 'M-LORE-X', title: 'x' }, { fetchImpl: taken.impl, lang: 'ru' });
    expect(r.ok === false && r.kind).toBe('exists');
    expect(taken.posts()).toEqual([]);
    const race = net(404, () => json(409, { error: 'ID_TAKEN' }));
    const r2 = await saveCreate('milestone', { id: 'M-LORE-X', title: 'x' }, { fetchImpl: race.impl, lang: 'ru' });
    expect(r2.ok === false && r2.kind).toBe('exists');
  });
});
