import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  saveLoreFeature, saveLoreUc, saveLoreActor,
  linkLoreFeature, linkLoreUc,
} from './lore';

// PL-31: write-функции продуктового слоя.
//
// До этой задачи слой был read-only ПО ПОСТРОЕНИЮ: во фронтенде не существовало
// ни одного вызова записи, и любая форма создания упиралась в то, что ей нечего
// звать. Тесты держат две вещи, которые ломаются молча.
//
// Первая — тело запроса. Если обёртка потеряет поле (переименование в REST,
// опечатка в ключе), сервер применит частичную правку и ответит ok:true.
// Вторая — ответы link-путей: CREATE EDGE в пустой FROM/TO ничего не делает,
// поэтому linked:false обязан доезжать до вызывающего, а не теряться в типе.

function mockFetch(body: unknown, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('write-путь продуктового слоя', () => {
  it('шлёт POST на свой эндпоинт и не теряет полей тела', async () => {
    const spy = mockFetch({ ok: true });
    await saveLoreFeature({
      feature_id: 'FEAT-X', title: 'Корень', goal_level: 'kite', status: 'proposed',
    });

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/lore/feature');
    expect(init.method).toBe('POST');
    // Именно тело, а не факт вызова: потерянное поле — частичная правка с ok:true.
    expect(JSON.parse(init.body)).toEqual({
      feature_id: 'FEAT-X', title: 'Корень', goal_level: 'kite', status: 'proposed',
    });
  });

  it('parent_uc_id доезжает до сервера — иначе сценарий молча остаётся сиротой', async () => {
    const spy = mockFetch({ ok: true, parent_linked: true });
    await saveLoreUc({ uc_id: 'UC-X', parent_uc_id: 'FEAT-X', goal_level: 'sea-level' });

    expect(JSON.parse(spy.mock.calls[0][1].body).parent_uc_id).toBe('FEAT-X');
  });

  it('возвращает parent_linked:false, а не проглатывает его', async () => {
    mockFetch({ ok: true, parent_linked: false, hint: 'родитель не найден' });
    const res = await saveLoreUc({ uc_id: 'UC-X', parent_uc_id: 'НЕТ-ТАКОГО' });

    // ok:true при отсутствующем ребре — ровно тот случай, ради которого поле
    // и существует. Форма обязана уметь его показать.
    expect(res.ok).toBe(true);
    expect(res.parent_linked).toBe(false);
    expect(res.hint).toContain('родитель');
  });

  it('actor_new несёт project — без него роли разных продуктов склеиваются (D18)', async () => {
    const spy = mockFetch({ ok: true, project_linked: true });
    await saveLoreActor({ actor_id: 'ACT-A', name: 'Администратор', project: 'acme/one' });

    expect(JSON.parse(spy.mock.calls[0][1].body).project).toBe('acme/one');
  });

  it('link-пути передают action и возвращают linked', async () => {
    const spy = mockFetch({ ok: true, linked: false, hint: 'цель не найдена' });
    const res = await linkLoreFeature({
      feature_id: 'FEAT-X', rel: 'pain', target_id: 'PAIN-1', action: 'remove',
    });

    expect(JSON.parse(spy.mock.calls[0][1].body).action).toBe('remove');
    expect(res.linked).toBe(false);
  });

  it('обе половины парных рёбер доступны из UI: заявка через корень, факт через сценарий', async () => {
    const spy = mockFetch({ ok: true, linked: true });
    await linkLoreFeature({ feature_id: 'FEAT-X', rel: 'pain', target_id: 'PAIN-1' });
    await linkLoreUc({ uc_id: 'UC-X', rel: 'relieves', target_id: 'PAIN-1' });

    expect(String(spy.mock.calls[0][0])).toContain('/lore/feature/link');
    expect(String(spy.mock.calls[1][0])).toContain('/lore/uc/link');
    // Без второй половины fit никогда не замкнётся: заявили и не доставили.
    expect(JSON.parse(spy.mock.calls[1][1].body).rel).toBe('relieves');
  });

  it('ошибку сервера не выдаёт за успех', async () => {
    mockFetch({ error: 'BAD_PARAMS', detail: 'goal_level must be cloud|kite' }, 400);
    await expect(saveLoreFeature({ feature_id: 'F', goal_level: 'cloud' })).rejects.toThrow();
  });
});
