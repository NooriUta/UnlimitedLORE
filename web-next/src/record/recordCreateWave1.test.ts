// SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT, первая волна (решения владельца 25.11.2026: 1б, 2б, 3а, 4а):
// боль, выгода, работа, роль продукта, фича — «+ Новая» и правка паспорта, тип за типом.
//
// На каждый тип три проверки:
//   - создание: путь записи модели (?mode=create), код в своём поле, название — в своём;
//   - правка поля: уходит тем же путём записи ТОЛЬКО это поле с кодом записи (UPSERT пишет переданное);
//   - занятый код: проба паспорта 200 — отказ без записи; гонка (сервер 409 ID_TAKEN) — тоже «уже есть».
// Плюс 2б — код предлагается из названия (транслит + префикс типа), и 1б — «+ боль» во вкладке
// фичи/роли ставит связь сама после создания.
import { describe, expect, it, vi } from 'vitest';
import { CREATE_TYPES, createFields, createRequest, saveCreate, suggestCode, type CreateType } from './recordCreate';
import { savePassportField } from './passportSave';
import { relationOptionsHook } from './relationOptions';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function net(probe: number, write: () => Response = () => json(200, { ok: true })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('/lore/record/') && !url.endsWith('/relation')) return json(probe, probe === 200 ? { record: {} } : { error: 'NOT_FOUND' });
    return write();
  }) as unknown as typeof fetch;
  return { impl, calls, posts: () => calls.filter(c => c.init?.method === 'POST') };
}
const bodyOf = (c: { init?: RequestInit }) => JSON.parse(String(c.init?.body)) as Record<string, unknown>;

const WAVE1: { type: CreateType; url: string; id: string; title: string; code: string }[] = [
  { type: 'pain', url: '/lore/pain', id: 'pain_id', title: 'title', code: 'PAIN-SYROY-TOKEN' },
  { type: 'gain', url: '/lore/gain', id: 'gain_id', title: 'title', code: 'GAIN-SYROY-TOKEN' },
  { type: 'job', url: '/lore/job', id: 'job_id', title: 'title', code: 'JOB-SYROY-TOKEN' },
  // роль продукта — KnowProjectActor, путь project-actor; название — поле name
  { type: 'actor', url: '/lore/project-actor', id: 'actor_id', title: 'name', code: 'ACT-SYROY-TOKEN' },
  { type: 'feature', url: '/lore/feature', id: 'feature_id', title: 'title', code: 'FEAT-SYROY-TOKEN' },
];

describe('AP-PASSPORT-EDIT · волна 1: боль, выгода, работа, роль, фича', () => {
  it('все пять — среди типов с «+ Новая»', () => {
    for (const w of WAVE1) expect(CREATE_TYPES).toContain(w.type);
  });

  for (const w of WAVE1) {
    describe(w.type, () => {
      it('создание: код и название обязательны, запись — путём модели в строгом режиме', async () => {
        expect(createFields(w.type, 'ru').filter(f => f.required === 'block').map(f => f.key)).toEqual(['title', 'id']);
        expect(createRequest(w.type, { id: w.code, title: ' Сырой токен ', body_md: 'текст' })).toEqual({
          url: `${w.url}?mode=create`, body: { [w.id]: w.code, [w.title]: 'Сырой токен', body_md: 'текст' },
        });
        const n = net(404);
        const r = await saveCreate(w.type, { id: w.code, title: 'Сырой токен' }, { fetchImpl: n.impl, lang: 'ru' });
        expect(r).toEqual({ ok: true, id: w.code });
        expect(n.calls[0].url).toBe(`/lore/record/${w.type}/${w.code}`);
        expect(n.posts().map(c => c.url)).toEqual([`${w.url}?mode=create`]);
      });

      it('правка поля паспорта: тем же путём, только это поле и код записи', async () => {
        const n = net(200);
        await savePassportField(w.type, { id: w.code, title: 'Старое' }, 'title', 'Новое', n.impl, null, { endpoint: w.url, field: w.title });
        expect(n.posts().map(c => c.url)).toEqual([w.url]);
        expect(bodyOf(n.posts()[0])).toEqual({ [w.id]: w.code, [w.title]: 'Новое' });
      });

      it('занятый код: проба 200 — отказ «уже есть», записи нет; гонка 409 ID_TAKEN — тоже «уже есть»', async () => {
        const taken = net(200);
        const r = await saveCreate(w.type, { id: w.code, title: 'x' }, { fetchImpl: taken.impl, lang: 'ru' });
        expect(r.ok).toBe(false);
        if (!r.ok) { expect(r.kind).toBe('exists'); expect(r.reason).toContain(w.code); }
        expect(taken.posts()).toEqual([]);
        const race = net(404, () => json(409, { error: 'ID_TAKEN', detail: 'уже существует' }));
        const r2 = await saveCreate(w.type, { id: w.code, title: 'x' }, { fetchImpl: race.impl, lang: 'ru' });
        expect(r2.ok === false && r2.kind).toBe('exists');
      });
    });
  }

  it('2б: код предлагается из названия — транслит, верхний регистр, префикс типа', () => {
    expect(suggestCode('pain', 'Сырой токен у агента')).toBe('PAIN-SYROY-TOKEN-U-AGENTA');
    expect(suggestCode('feature', '  Ёлка: щука & «чай»! ')).toBe('FEAT-YOLKA-SHCHUKA-CHAY');
    expect(suggestCode('actor', 'Product owner')).toBe('ACT-PRODUCT-OWNER');
    expect(suggestCode('job', '')).toBe('');
    // длинное название — код не длиннее 64 знаков и не кончается дефисом
    const long = suggestCode('gain', 'очень '.repeat(30));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('-')).toBe(false);
  });

  it('1б: «+ боль» из фичи — после создания связь ADDRESSES ставится сама', async () => {
    const n = net(404);
    const r = await saveCreate('pain', { id: 'PAIN-X', title: 'Боль' }, {
      fetchImpl: n.impl, lang: 'ru', link: { type: 'feature', id: 'FEAT-A', rel: 'ADDRESSES', dir: 'out' },
    });
    expect(r).toEqual({ ok: true, id: 'PAIN-X' });
    const rel = n.posts().find(c => c.url.endsWith('/relation'))!;
    expect(rel.url).toBe('/lore/record/feature/FEAT-A/relation');
    expect(bodyOf(rel)).toEqual({ rel: 'ADDRESSES', dir: 'out', target: 'PAIN-X', action: 'add' });
  });

  it('1б: связь не встала — запись есть, причина словами (linkFailed), не «успех»', async () => {
    const n = net(404, () => json(200, { ok: true }));
    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/relation')) return json(403, { error: 'FORBIDDEN' });
      return n.impl(input, init);
    }) as unknown as typeof fetch;
    const r = await saveCreate('pain', { id: 'PAIN-X', title: 'Боль' }, {
      fetchImpl: impl, lang: 'ru', link: { type: 'actor', id: 'ACT-A', rel: 'FELT_BY', dir: 'in' },
    });
    expect(r.ok === false && r.kind).toBe('linkFailed');
  });

  it('вкладки «Ценность» и «Профиль клиента»: привязать существующую боль / роль — выбор из их срезов', async () => {
    const slice = vi.fn(async (name: string) => ({ rows: name === 'pains' ? [{ pain_id: 'PAIN-A', title: 'Боль А' }] : [{ actor_id: 'ACT-A', name: 'Роль А' }] }));
    const hook = relationOptionsHook([
      { rel: 'ADDRESSES', dir: 'out', target_type: 'pain', label: 'Боли' },
      { rel: 'FELT_BY', dir: 'out', target_type: 'actor', label: 'Роли' },
    ], slice);
    expect(await hook({ type: 'feature', id: 'FEAT-A', rel: 'ADDRESSES', dir: 'out', query: '' })).toEqual([{ id: 'PAIN-A', title: 'Боль А', type: 'pain' }]);
    expect(await hook({ type: 'pain', id: 'PAIN-A', rel: 'FELT_BY', dir: 'out', query: 'роль' })).toEqual([{ id: 'ACT-A', title: 'Роль А', type: 'actor' }]);
  });
});
