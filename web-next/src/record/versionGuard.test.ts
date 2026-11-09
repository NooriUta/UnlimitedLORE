// Защита от затирания при одновременной правке
// (SPRINT_UXR_S5_RECORD_TASKS/S5-08).
//
// До сих пор паспорт сохранял поле, ничего не зная о версии записи: кто
// сохранил последним, тот и переписал чужую правку — молча. Теперь версия у
// клиента есть (паспорт на фасаде `/lore/record`, `record.version` — строка), а
// сервер уже умеет её проверять: у правки спринта, задачи и спеки есть
// `expected_version`, и при расхождении он отвечает 409 VERSION_CONFLICT с
// текущей версией (`LoreResourceBase.versionConflict`).
//
// Две честности, которые этот слой обязан соблюсти:
//
//   1. **Версия неизвестна — защиты НЕТ, и мы об этом не врём.** Сервер
//      пропускает проверку, если `expected_version` пустой
//      (`versionConflict` возвращает null). Значит отправить «пусто» и считать
//      себя защищённым нельзя: запрос без версии — это обычная перезапись.
//
//   2. **Какие типы проверяются — список явный.** Утром 09.11 у ADR проверки
//      НЕ БЫЛО (`LoreAdrResource` не знал `expected_version`), и тип честно не
//      входил в `VERSION_CHECKED`: обещать защиту там, где её нет, хуже, чем
//      сказать «проверки пока нет». К вечеру серверная сессия её добавила (PR
//      #969), и список пополнился — но остался явным, чтобы следующий тип без
//      проверки не попал в него молча.
import { describe, expect, it } from 'vitest';
import { LoreHttpError } from '../api/loreSlice';
import { VERSION_CHECKED, VersionConflict, savePassportField } from './passportSave';

const V_NOW = '2026-11-08T10:00:00Z';

const ok = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

const spy = () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const impl = (async (path: unknown, init?: RequestInit) => {
    calls.push({ path: String(path), body: JSON.parse(String(init?.body)) });
    return ok();
  }) as unknown as typeof fetch;
  return { calls, impl };
};

const conflict = () => (async () => new Response(JSON.stringify({
  error: 'VERSION_CONFLICT',
  detail: "sprint 'SPRINT_A': expected_version '2026-11-07T00:00:00Z' не совпадает с текущей версией — перечитайте запись и повторите",
  current: { version: V_NOW, updated_by: 'omiloreadmin' },
}), { status: 409, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const rec = { id: 'SPRINT_A', title: 'Спринт А' };

describe('S5-08 · версия уходит на сервер', () => {
  it('положительный контроль: без версии сохранение по-прежнему проходит', async () => {
    const { calls, impl } = spy();
    await savePassportField('sprint', rec, 'body_md', 'текст', impl);
    expect(calls[0].path).toBe('/lore/sprint/update');
    expect(calls[0].body).not.toHaveProperty('expected_version');
  });

  it('версия известна — уходит в expected_version у спринта', async () => {
    const { calls, impl } = spy();
    await savePassportField('sprint', rec, 'body_md', 'текст', impl, V_NOW);
    expect(calls[0].body.expected_version).toBe(V_NOW);
  });

  it('то же у задачи и спеки — сервер принимает проверку у всех трёх', async () => {
    const t = spy();
    await savePassportField('task', { id: 'SPRINT_A/A-1', title: 'Задача' }, 'body_md', 'текст', t.impl, V_NOW);
    expect(t.calls[0].body.expected_version).toBe(V_NOW);
    const s = spy();
    await savePassportField('spec', { id: 'SPEC-1', title: 'Спека' }, 'body_md', 'текст', s.impl, V_NOW);
    expect(s.calls[0].body.expected_version).toBe(V_NOW);
  });

  // Переписано в тот же день: утром у ADR проверки версии на сервере НЕ БЫЛО,
  // и тест держал именно это — версия не отправлялась, чтобы не выглядело
  // защитой. Серверная сессия добавила `expected_version` в POST /lore/adr
  // (PR #969, сверено по коду, а не по сообщению), и теперь правда другая.
  it('у ADR версия тоже уходит — с #969 сервер её проверяет', async () => {
    const { calls, impl } = spy();
    await savePassportField('adr', { id: 'ADR-1', title: 'Решение' }, 'decision_md', 'текст', impl, V_NOW);
    expect(calls[0].path).toBe('/lore/adr');
    expect(calls[0].body.expected_version).toBe(V_NOW);
  });

  it('список проверяемых типов назван прямо — по нему экран говорит правду', () => {
    expect([...VERSION_CHECKED]).toEqual(['sprint', 'task', 'spec', 'adr']);
  });

  it('пустая версия не отправляется: сервер пропустил бы проверку, а мы бы считали себя защищёнными', async () => {
    const { calls, impl } = spy();
    await savePassportField('sprint', rec, 'body_md', 'текст', impl, '');
    expect(calls[0].body).not.toHaveProperty('expected_version');
  });
});

describe('S5-08 · расхождение версий названо словами', () => {
  it('409 — отдельный тип ошибки, а не «HTTP 409»', async () => {
    await expect(savePassportField('sprint', rec, 'body_md', 'текст', conflict(), V_NOW))
      .rejects.toBeInstanceOf(VersionConflict);
  });

  it('в сообщении сказано, что делать, и кто правил', async () => {
    const e = (await savePassportField('sprint', rec, 'body_md', 'текст', conflict(), V_NOW).catch(x => x)) as VersionConflict;
    expect(e.message).toMatch(/изменили/);
    expect(e.message).toMatch(/перечит/i);
    expect(e.updatedBy).toBe('omiloreadmin');
    expect(e.currentVersion).toBe(V_NOW);
  });

  it('текст правки в ошибку не уходит: он остаётся в поле, его не теряют', async () => {
    const e = (await savePassportField('sprint', rec, 'body_md', 'мой длинный текст', conflict(), V_NOW).catch(x => x)) as VersionConflict;
    expect(e.message).not.toContain('мой длинный текст');
  });

  it('прочие отказы остаются LoreHttpError — поведение не менялось', async () => {
    const http = (async () => new Response(JSON.stringify({ error: 'FORBIDDEN', detail: 'нет прав' }), { status: 403 })) as unknown as typeof fetch;
    const e = (await savePassportField('sprint', rec, 'body_md', 'текст', http, V_NOW).catch(x => x)) as LoreHttpError;
    expect(e).toBeInstanceOf(LoreHttpError);
    expect(e).not.toBeInstanceOf(VersionConflict);
  });

  it('409 без тела — всё равно понятное сообщение, а не пустая ошибка', async () => {
    const http = (async () => new Response('не json', { status: 409 })) as unknown as typeof fetch;
    const e = (await savePassportField('sprint', rec, 'body_md', 'текст', http, V_NOW).catch(x => x)) as VersionConflict;
    expect(e).toBeInstanceOf(VersionConflict);
    expect(e.message).toMatch(/изменили/);
    expect(e.currentVersion).toBeNull();
  });
});
