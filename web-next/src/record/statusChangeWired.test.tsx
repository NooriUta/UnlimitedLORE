// @vitest-environment jsdom
// Смена статуса из паспорта ДОХОДИТ ДО СЕРВЕРА
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG, дефект 09.11).
//
// ПОВОД — замечание владелицы: «не могу поменять статус адр через новый
// редиз». Корень оказался не там, где она предполагала, и не на сервере:
// `/lore/status` принимает `entity_type: adr` давно, со своей ветвью SCD2.
//
// Корень был у меня. `saveRecordStatus` написан 09.11, покрыт тестами и НЕ
// ПОДКЛЮЧЁН: греп показывал вызовы только из его собственного теста. В шапке
// того модуля моей же рукой написано «чип стал нажимаемым, а сохранять было
// нечем» — и вторая половина осталась недоделанной. Следствие шире жалобы:
// статус не менялся НИ У ОДНОГО типа.
//
// Почему прежние тесты этого не поймали: они проверяли ФУНКЦИЮ (запрос, коды
// отказа, «было»), а не то, что её кто-то вызывает. Поэтому здесь проверка
// сквозная — от показанного чипа до тела запроса, — и имя внесено в сторож
// «написанное дошло до экрана».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';
import { STATUS_ENTITIES, StatusNotSupported, statusEntity } from './statusSave';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Ответ фасада для ADR: права на смену статуса ЕСТЬ. */
const adr = (status = 'proposed') => ({
  contract: 'lore.record/1',
  record: { type: 'adr', id: 'ADR-LORE-049', title: 'Правила конвертации', status, version: '2026-11-09T06:57:25Z' },
  values: { title: 'Правила конвертации' },
  parts: [],
  links: [],
  perms: { can_edit: true, can_status: true, can_create: false, status_next: ['accepted'], reason: null },
  facts: {},
  schema: { fields: [{ key: 'title', label: 'Название', kind: 'text', group: 'head', editable: true }], relations: [] },
  meta: { facade: 'lore.record/1', sources: [{ block: 'record', state: 'ok' }], data_state: [] },
});

/** Сеть: паспорт отдаёт ADR, `/lore/status` записывает и помнит тело. */
function net() {
  const posts: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/lore/status')) {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      posts.push({ url, body });
      return json({ ok: true, entity_type: 'adr', id: 'ADR-LORE-049', old_status: 'proposed', new_status: 'accepted' });
    }
    return json(adr());
  });
  return { fetchImpl: fn as unknown as typeof fetch, posts };
}

/** Открыть чип статуса и перевести в «Принято» (третий шаг — подтверждение). */
async function changeToAccepted() {
  const chip = await screen.findByRole('button', { name: /^Статус/ }, { timeout: 8000 });
  await act(async () => { fireEvent.click(chip); });
  const item = await screen.findByRole('menuitem', { name: /Принят/i }, { timeout: 8000 });
  await act(async () => { fireEvent.click(item); });
  // «Принято» — завершающий статус, и kit просит третий шаг (S4-07):
  // случайное «готово» дорого. Подтверждаем, как это делает человек.
  const confirm = await screen.findByRole('button', { name: /Поставить/i }, { timeout: 8000 });
  await act(async () => { fireEvent.click(confirm); });
}

describe('смена статуса из паспорта доходит до сервера', () => {
  it('положительный контроль: паспорт ADR открылся и статус — кнопка', async () => {
    const n = net();
    render(<ListPassport type="adr" id="ADR-LORE-049" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="ADR" onBack={() => {}} />);
    expect(await screen.findByText('Правила конвертации', {}, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Статус/ }, { timeout: 8000 })).toBeTruthy();
  }, 15000);

  it('выбор статуса уходит POST-ом на /lore/status с типом adr', async () => {
    const n = net();
    render(<ListPassport type="adr" id="ADR-LORE-049" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="ADR" onBack={() => {}} />);
    await screen.findByText('Правила конвертации', {}, { timeout: 8000 });
    await changeToAccepted();
    await waitFor(() => expect(n.posts).toHaveLength(1), { timeout: 8000 });
    expect(n.posts[0].url).toContain('/lore/status');
    expect(n.posts[0].body).toMatchObject({ entity_type: 'adr', id: 'ADR-LORE-049', status: 'accepted' });
  }, 15000);

  it('в запрос уходит «было» — иначе чужая правка затёрлась бы молча', async () => {
    const n = net();
    render(<ListPassport type="adr" id="ADR-LORE-049" placement="bottom" fetchImpl={n.fetchImpl}
      backLabel="ADR" onBack={() => {}} />);
    await screen.findByText('Правила конвертации', {}, { timeout: 8000 });
    await changeToAccepted();
    await waitFor(() => expect(n.posts).toHaveLength(1), { timeout: 8000 });
    expect(n.posts[0].body).toMatchObject({ expected: 'proposed' });
  }, 15000);
});

describe('типы без пути записи статуса отказывают ПО ИМЕНИ', () => {
  it('положительный контроль: четыре поддерживаемых типа проходят', () => {
    expect([...STATUS_ENTITIES]).toEqual(['sprint', 'task', 'phase', 'adr']);
    for (const t of STATUS_ENTITIES) expect(statusEntity(t)).toBe(t);
  });

  it.each(['decision', 'question', 'milestone', 'release', 'component'])('«%s» — отказ с причиной, а не 400 от сервера', type => {
    // У этих типов паспорт есть, а пути записи статуса на сервере нет. Права
    // (`perms.can_status: false`) чип и не сделают кнопкой — но полагаться на
    // одно это нельзя: ошибка в правах превратила бы отказ в запрос, который
    // сервер отвергнет кодом, а человек увидит «не получилось» без причины.
    expect(() => statusEntity(type)).toThrow(StatusNotSupported);
    try {
      statusEntity(type);
    } catch (e) {
      expect((e as Error).message).toContain(type);
      expect((e as Error).message).toMatch(/не поддерживается/);
    }
  });
});
