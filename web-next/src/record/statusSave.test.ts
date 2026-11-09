// Смена статуса записи из v2 (аудит 09.11, находка D-04 · S4-STATUS-AXIS-CONFIG).
//
// Аудит намерил: статус в v2 — `SPAN` с `tabIndex=-1`, сменить нельзя. Разбор
// показал, что причина ДВОЙНАЯ, и первая половина уже закрыта:
//
//   1. Права. В эмуляции паспорта `can_status` был зашит в `false`, поэтому чип
//      никогда не был кнопкой. Переход на боевой фасад (#963) это снял: сервер
//      отдаёт настоящие `perms.can_status`, и у admin чип уже кликабелен.
//   2. **Запись. Её не было вовсе** — и это здесь. `savePassportField`
//      принимает только текст записи и разделы ADR, а на поле `status`
//      отказывает словами «поле не правится». То есть чип стал нажимаемым, а
//      сохранять было нечем.
//
// Контракт пути записи сверен с серверной сессией 09.11 (она же его и писала):
//   POST /lore/status {entity_type: sprint|task|phase|adr, id, status, expected}
//   • `expected` — «было» (S2-09): не совпало с открытой версией → 409 CONFLICT
//     с `current`. Шлём то, что показано человеку, иначе проверка бессмысленна.
//   • 403 FORBIDDEN — человеку нужна роль admin/superadmin.
//   • 403 AGENT_SCOPE_FORBIDDEN — агент вне матрицы семейства status.
//
// Каждый отказ обязан дойти словами: «не получилось» заставит человека
// перебирать статусы, хотя причина одна и не в статусе.
import { describe, expect, it } from 'vitest';
import { LoreHttpError } from '../api/loreSlice';
import { StatusRefused, saveRecordStatus } from './statusSave';

const ok = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

const spy = () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return ok();
  }) as unknown as typeof fetch;
  return { calls, impl };
};

const reply = (body: unknown, status: number) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('D-04 · путь смены статуса', () => {
  it('положительный контроль: статус спринта уходит на /lore/status', async () => {
    const { calls, impl } = spy();
    await saveRecordStatus({ type: 'sprint', id: 'SPRINT_A', to: 'done', was: 'active' }, impl);
    expect(calls[0].url).toBe('/lore/status');
    expect(calls[0].body).toEqual({ entity_type: 'sprint', id: 'SPRINT_A', status: 'done', expected: 'active' });
  });

  it('«было» уходит всегда, когда известно: без него проверка версии бессмысленна', async () => {
    const { calls, impl } = spy();
    await saveRecordStatus({ type: 'task', id: 'SPRINT_A/A-1', to: 'done', was: 'active' }, impl);
    expect(calls[0].body.expected).toBe('active');
  });

  it('«было» неизвестно — ключ не посылается, а не уходит пустым', async () => {
    const { calls, impl } = spy();
    await saveRecordStatus({ type: 'task', id: 'SPRINT_A/A-1', to: 'done', was: null }, impl);
    expect(calls[0].body).not.toHaveProperty('expected');
  });

  it('код задачи с дробью не кодируется — он часть кода', async () => {
    const { calls, impl } = spy();
    await saveRecordStatus({ type: 'task', id: 'SPRINT_A/A-1', to: 'done', was: null }, impl);
    expect(calls[0].body.id).toBe('SPRINT_A/A-1');
  });

  it('403 FORBIDDEN — названа роль, а не «не получилось»', async () => {
    const e = (await saveRecordStatus({ type: 'sprint', id: 'S', to: 'done', was: null },
      reply({ error: 'FORBIDDEN', detail: 'admin role required' }, 403)).catch(x => x)) as StatusRefused;
    expect(e).toBeInstanceOf(StatusRefused);
    expect(e.message).toMatch(/админ/i);
  });

  it('403 AGENT_SCOPE_FORBIDDEN — сказано, что это ограничение агента', async () => {
    const e = (await saveRecordStatus({ type: 'sprint', id: 'S', to: 'done', was: null },
      reply({ error: 'AGENT_SCOPE_FORBIDDEN', detail: 'scope' }, 403)).catch(x => x)) as StatusRefused;
    expect(e.message).toMatch(/агент/i);
  });

  it('409 — статус успели изменить; названо текущее значение', async () => {
    const e = (await saveRecordStatus({ type: 'sprint', id: 'S', to: 'done', was: 'active' },
      reply({ error: 'CONFLICT', detail: 'stale', current: { status: 'blocked' } }, 409)).catch(x => x)) as StatusRefused;
    expect(e.message).toMatch(/успели изменить/);
    expect(e.current).toBe('blocked');
  });

  it('прочие отказы остаются LoreHttpError — поведение не изобретаем', async () => {
    const e = (await saveRecordStatus({ type: 'sprint', id: 'S', to: 'done', was: null },
      reply({ error: 'BAD_PARAMS', detail: 'status unknown' }, 400)).catch(x => x)) as LoreHttpError;
    expect(e).toBeInstanceOf(LoreHttpError);
    expect(e).not.toBeInstanceOf(StatusRefused);
    expect(e.message).toMatch(/status unknown/);
  });

  it('ответ не json — отказ с кодом, а не падение разбора', async () => {
    const http = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(saveRecordStatus({ type: 'sprint', id: 'S', to: 'done', was: null }, http)).rejects.toThrow(/502/);
  });
});
