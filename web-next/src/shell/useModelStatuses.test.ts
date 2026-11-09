// Словарь статусов из модели доходит до оболочки (S4-STATUS-AXIS-CONFIG).
//
// Проверяется не разбор — он переехал в kit, `model/configFromModel.test.ts`
// (K-MODEL-LOADER: знание о том, как документ превращается в конфиг, не должно
// лежать в каждом приложении отдельно). Здесь — три состояния загрузки,
// которые человеку означают РАЗНОЕ:
//   • модель пришла — словарь из данных;
//   • модель не пришла — остаётся рукописное умолчание приложения, и причина
//     названа словами. Это главное: молчаливый откат выглядел бы как «всё
//     хорошо», а на самом деле новый статус снова выйдет пустым чипом;
//   • сервер ответил не 200 — тоже причина, а не пустота.
//
// Заодно это первый настоящий потребитель загрузчика модели из kit
// (SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER): он был написан и до сих пор не
// вызывался ниоткуда.
import { describe, expect, it } from 'vitest';
import { LORE_STATUS_DICT, fetchModelStatuses } from './useModelStatuses';

const doc = (entries: unknown[]) => ({
  format: 'model/0',
  version: '2026-11-09T07:00:00Z',
  partial: false,
  missing: [],
  statuses: { [LORE_STATUS_DICT]: { dict: LORE_STATUS_DICT, allow_scope: 'type', lifecycle_known: true, entries } },
});

const entry = {
  code: 'ready_for_deploy', title: 'К выкатке', icon: 'wave-crest',
  color: 'var(--inf)', order: 60, category: 'in_progress', allow: ['done'],
  in_dictionary: true, in_lifecycle: true, active: true,
};

const net = (body: unknown, status = 200) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('S4-STATUS-AXIS-CONFIG · словарь статусов доходит до оболочки', () => {
  it('положительный контроль: модель пришла — словарь из неё', async () => {
    const r = await fetchModelStatuses({ fetchImpl: net(doc([entry])) });
    expect(r.items.map(i => i.code)).toEqual(['ready_for_deploy']);
    expect(r.items[0]).toMatchObject({ title: 'К выкатке', color: 'var(--inf)' });
  });

  it('именно тот статус, на котором я споткнулся утром, приходит данными', async () => {
    // «К выкатке» был потерян в рукописном словаре — теперь его приносит модель,
    // и правка клиента для нового статуса больше не нужна.
    const r = await fetchModelStatuses({ fetchImpl: net(doc([entry])) });
    expect(r.items[0].code).toBe('ready_for_deploy');
    expect(r.notes).toEqual([]);
  });

  it('модель недоступна — пусто плюс НАЗВАННАЯ причина, а не тихий откат', async () => {
    const r = await fetchModelStatuses({ fetchImpl: net({ error: 'DISABLED' }, 501) });
    expect(r.items).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/умолчани/i);
    expect(r.notes.join(' ')).toMatch(/501/);
  });

  it('сеть упала — тоже причина словами', async () => {
    const http = (async () => { throw new Error('сеть недоступна'); }) as unknown as typeof fetch;
    const r = await fetchModelStatuses({ fetchImpl: http });
    expect(r.items).toEqual([]);
    expect(r.notes.join(' ')).toContain('сеть недоступна');
  });

  it('модель пришла, но раздела statuses в ней нет — причина названа, экран жив', async () => {
    const r = await fetchModelStatuses({ fetchImpl: net({ format: 'model/0', version: 'v', partial: true, missing: ['statuses:*'] }) });
    expect(r.items).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/нет раздела statuses/i);
  });

  it('у статьи нет цвета — показан нейтральным, и это сказано', async () => {
    const r = await fetchModelStatuses({ fetchImpl: net(doc([{ ...entry, color: null }])) });
    expect(r.items[0].color).toBe('var(--t3)');
    expect(r.notes.join(' ')).toMatch(/цвет/i);
  });
});
