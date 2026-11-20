// Привязка и отвязка связи записи через боевой путь
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST).
//
// `POST /lore/record/{type}/{id}/relation` — существующий путь, у него свои
// отказы, и каждый должен дойти до человека СЛОВАМИ (в kit под управлением
// связями теперь есть место для причины):
//
//   • 403 «admin role required» — у пути стоит requireAdmin. Человеку нужно
//     сказать про роль, а не «не получилось»: иначе он будет перебирать коды.
//   • 400 UNKNOWN_RELATION — у типа нет пути для этой связи, и сервер
//     присылает список `allowed`. Его надо показать: это ровно та подсказка,
//     которая превращает тупик в действие.
//   • 400 BAD_PARAMS — своя причина текстом.
//
// Форма тела снята с `RelationRequest` сервера: {rel, dir, target, action}.
import { describe, expect, it, vi } from 'vitest';
import { saveRelation } from './relationSave';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const net = (reply: Response) => vi.fn(async () => reply) as unknown as typeof fetch;

const call = (fetchImpl: typeof fetch) => saveRelation(
  { type: 'sprint', id: 'SPRINT_A', rel: 'DEPENDS_ON', dir: 'out', target: 'SPRINT_B', action: 'add' },
  fetchImpl,
);

describe('S4-MODEL-PASSPORT-LIST · путь привязки связи', () => {
  it('положительный контроль: удачная привязка не бросает', async () => {
    await expect(call(net(json({ ok: true }, 200)))).resolves.toBeUndefined();
  });

  it('адрес и тело — как у сервера: код записи с дробью не кодируется', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const http = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return json({ ok: true }, 200);
    }) as unknown as typeof fetch;
    await saveRelation({ type: 'task', id: 'SPRINT_A/A-1', rel: 'JUSTIFIED_BY', dir: 'out', target: 'ADR-1', action: 'remove' }, http);
    expect(seen[0].url).toBe('/lore/record/task/SPRINT_A/A-1/relation');
    expect(seen[0].body).toEqual({ rel: 'JUSTIFIED_BY', dir: 'out', target: 'ADR-1', action: 'remove' });
  });

  it('403 — названа роль, а не «не получилось»', async () => {
    await expect(call(net(json({ error: 'FORBIDDEN', detail: 'admin role required' }, 403))))
      .rejects.toThrow(/админ/i);
  });

  it('UNKNOWN_RELATION — показан список связей, которыми управлять можно', async () => {
    const body = { error: 'UNKNOWN_RELATION', detail: 'у типа sprint нет пути привязки для HAS_TASK:out', allowed: ['DEPENDS_ON:out', 'HAS_PROJECT:out'] };
    await expect(call(net(json(body, 400)))).rejects.toThrow(/DEPENDS_ON:out/);
  });

  it('BAD_PARAMS — своя причина доходит текстом', async () => {
    await expect(call(net(json({ error: 'BAD_PARAMS', detail: 'rel, dir, target required' }, 400))))
      .rejects.toThrow(/rel, dir, target required/);
  });

  it('фасад выключен (501) — слышно, а не «связь не та»', async () => {
    await expect(call(net(json({ error: 'DISABLED', detail: 'фасад записи выключен' }, 501))))
      .rejects.toThrow(/выключен/);
  });

  it('ответ вообще не json — отказ с кодом, а не падение разбора', async () => {
    const http = (async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(call(http)).rejects.toThrow(/502/);
  });
});

// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13: связь с обязательной причиной — причина из ReasonDialog kit уходит
// в тело того же пути (`RelationRequest.reason`), сервер передаёт её обработчику зависимостей (/lore/dep).
describe('MDL-13 · причина связи доходит до сервера', () => {
  const capture = () => {
    const seen: unknown[] = [];
    const http = (async (_url: unknown, init?: RequestInit) => { seen.push(JSON.parse(String(init?.body))); return json({ ok: true }, 200); }) as unknown as typeof fetch;
    return { seen, http };
  };
  it('с причиной — reason в теле', async () => {
    const { seen, http } = capture();
    await saveRelation({ type: 'sprint', id: 'SPRINT_A', rel: 'DEPENDS_ON', dir: 'out', target: 'SPRINT_B', action: 'add', reason: 'ждём схему' }, http);
    expect(seen[0]).toEqual({ rel: 'DEPENDS_ON', dir: 'out', target: 'SPRINT_B', action: 'add', reason: 'ждём схему' });
  });
  it('без причины — ключа reason нет (прежнее тело)', async () => {
    const { seen, http } = capture();
    await saveRelation({ type: 'sprint', id: 'SPRINT_A', rel: 'DEPENDS_ON', dir: 'out', target: 'SPRINT_B', action: 'remove' }, http);
    expect(seen[0]).toEqual({ rel: 'DEPENDS_ON', dir: 'out', target: 'SPRINT_B', action: 'remove' });
  });
  it('отказ 422 «укажите причину» — словами сервера', async () => {
    await expect(call(net(json({ error: 'REASON_REQUIRED', detail: 'укажите причину зависимости' }, 422)))).rejects.toThrow('укажите причину зависимости');
  });
});
