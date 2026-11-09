// @vitest-environment jsdom
// Порядок разделов паспорта: из модели, а при неудаче — названная причина
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
//
// Просьба владелицы 09.11.2026: «ты должен определять порядок например Спринт
// первое как ни странно задачи потом уже контент потом еще что-то а зависимости
// и прочее можно скрыть под море».
//
// Проверяется не только удачный случай. Три неудачи означают для человека
// РАЗНОЕ, и ни одна не должна выглядеть как «так задумано»:
//   • модель не прочиталась;
//   • модель пришла, но порядок для типа не задан;
//   • модель пришла, а форма не та (сторож отказал).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { fetchPassportOrder } from './passportOrder';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SECTIONS = [
  { key: 'tasks', source: 'part', ref: 'tasks', order: 1, slot: 'own' },
  { key: 'overview', source: 'body', ref: null, order: 2, slot: 'own' },
  { key: 'deps', source: 'relation', ref: 'DEPENDS_ON:out', order: 3, slot: 'more' },
];

const modelBody = (passport: unknown) => ({
  // `format` обязателен: без него загрузчик модели законно её отвергает.
  format: 'model/0',
  version: '2026-11-09T00:00:00Z',
  surfaces: { partial: true, passport },
});

/** Сеть только для модели — разбор проверяется без экрана. */
const net = (body: unknown, status = 200) => (async () => json(body, status)) as unknown as typeof fetch;

describe('fetchPassportOrder: три неудачи различимы', () => {
  it('положительный контроль: порядок пришёл, говорить нечего', async () => {
    const r = await fetchPassportOrder('sprint', {
      fetchImpl: net(modelBody({ sprint: { decided: true, sections: SECTIONS } })),
    });
    expect(r.order.decided).toBe(true);
    expect(r.order.sections.map(s => s.key)).toEqual(['tasks', 'overview', 'deps']);
    expect(r.notes).toEqual([]);
  });

  it('модель не прочиталась — умолчание приложения, причина названа', async () => {
    const r = await fetchPassportOrder('sprint', { fetchImpl: net({ error: 'LORE_UPSTREAM' }, 502) });
    expect(r.order.decided).toBe(false);
    expect(r.notes.join(' ')).toMatch(/умолчание приложения/);
    expect(r.notes.join(' ')).toMatch(/502/);
  });

  it('модель есть, а порядок для типа не задан — это тоже сказано', async () => {
    // «Сервер не решал» ≠ «сервер решил показать всё подряд».
    const r = await fetchPassportOrder('adr', {
      fetchImpl: net(modelBody({ sprint: { decided: true, sections: SECTIONS } })),
    });
    expect(r.order.decided).toBe(false);
    expect(r.notes.join(' ')).toMatch(/модель его не задаёт/);
  });

  // ПЕРЕПИСАНО 09.11 вместе с ослаблением сторожа по CJM. Раньше лишний ключ
  // отказывал целиком, и человек терял ВЕСЬ порядок разделов из-за одного
  // безобидного поля. Теперь порядок применяется, а про лишнее сказано — и
  // сказано на экране, иначе ослабление стало бы молчанием.
  it('лишний ключ — порядок применён, а про лишнее сказано', async () => {
    const bad = [{ ...SECTIONS[0], component: 'Widget' }];
    const r = await fetchPassportOrder('sprint', {
      fetchImpl: net(modelBody({ sprint: { decided: true, sections: bad } })),
    });
    expect(r.order.decided).toBe(true);
    expect(r.order.sections.map(s => s.key)).toEqual(['tasks']);
    expect(r.notes.join(' ')).toContain('component');
  });

  it('а вот неизвестный slot отказывает — продолжение соврёт о структуре', async () => {
    const bad = [{ ...SECTIONS[0], slot: 'sidebar' }];
    const r = await fetchPassportOrder('sprint', {
      fetchImpl: net(modelBody({ sprint: { decided: true, sections: bad } })),
    });
    expect(r.order.decided).toBe(false);
    expect(r.notes.join(' ')).toMatch(/модель не принята/);
  });

});

/** Ответ фасада для спринта — минимальный, нужен только порядок вкладок. */
const facade = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_A', title: 'Спринт А', status: 'active', version: 'v1' },
  values: { title: 'Спринт А' },
  parts: [], links: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: { fields: [{ key: 'title', label: 'Название', kind: 'text', group: 'head', editable: false }], relations: [] },
  meta: { facade: 'lore.record/1', sources: [{ block: 'record', state: 'ok' }], data_state: [] },
};

/** Сеть паспорта: модель и запись по разным путям. */
function passportNet(passport: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/lore/model')) return json(modelBody(passport));
    return json(facade);
  }) as unknown as typeof fetch;
}

describe('паспорт: причина видна человеку, а не только в коде', () => {
  it('порядок не задан — на экране сказано, что он клиентский', async () => {
    render(<ListPassport type="sprint" id="SPRINT_A" placement="bottom"
      fetchImpl={passportNet({})} backLabel="Спринты" onBack={() => {}} />);
    expect(await screen.findByText('Спринт А', {}, { timeout: 8000 })).toBeTruthy();
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/умолчание приложения/);
    }, { timeout: 8000 });
    // Объявлено состоянием, а не ошибкой: ошибки здесь нет.
    expect(document.querySelector('.pp-model-note[role="status"]')).toBeTruthy();
  }, 15000);

  it('порядок задан — лишних слов на экране нет', async () => {
    render(<ListPassport type="sprint" id="SPRINT_A" placement="bottom"
      fetchImpl={passportNet({ sprint: { decided: true, sections: SECTIONS } })}
      backLabel="Спринты" onBack={() => {}} />);
    expect(await screen.findByText('Спринт А', {}, { timeout: 8000 })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.pp-model-note')).toBeNull(), { timeout: 8000 });
  }, 15000);
});
