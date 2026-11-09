// @vitest-environment jsdom
// Паспорт v2 рисуется ответом фасада, а не эмуляцией
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST).
//
// Проверка сквозная намеренно: от ответа `GET /lore/record` до экрана. Урок
// 09.11 (сторож `kit/src/wired.test.ts`): «разбор написан и покрыт тестами» ≠
// «данные доходят до человека». Разбор проверен в `api/liveRecord.test.ts`;
// здесь — что паспорт действительно собирается ИЗ НЕГО.
//
// Чтобы отличить одно от другого, названия в ответе фасада и в срезах РАЗНЫЕ:
// если на экране название среза, значит экран всё ещё на эмуляции.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FACADE = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SP', title: 'Название от фасада', status: 'active', version: '2026-11-08T10:00:00Z' },
  values: { title: 'Название от фасада', context_md: 'текст от фасада' },
  parts: [],
  links: [{ rel: 'HAS_TASK', dir: 'out', id: 'SP/A-1', type: 'task', title: 'Задача', status: 'done' }],
  perms: { can_edit: true, can_status: true, can_create: false, status_next: ['done'], reason: null },
  facts: { tasks: { done: 1, total: 1, open: 0 } },
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'calendar',
    fields: [
      { key: 'title', label: 'Название', label_key: 'f.t', kind: 'text', group: 'head', required: true, editable: true, write: { field: 'name' } },
      { key: 'context_md', label: 'Контекст', label_key: 'f.c', kind: 'md', group: 'body', required: false, editable: true, write: { field: 'context_md' } },
    ],
    layout: {},
    relations: [{ key: 'tasks', label: 'Задачи', relation: 'aggregation', rel: 'HAS_TASK', dir: 'out', target_type: 'task', place: 'link_tab', manageable: false }],
  },
  meta: {
    facade: 'server',
    sources: { block: ['tasks'] },
    data_state: [{ source: 'tasks_of_sprint', part: 'tasks', state: 'forbidden', reason: 'нет прав на задачи' }],
  },
};

/** Сеть: фасад отвечает (или нет), срезы отвечают ДРУГИМ названием. */
function net(recordReply: () => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    if (url.pathname.startsWith('/lore/record/')) return recordReply();
    if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
    if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
    const slice = url.pathname.split('/').pop();
    if (slice === 'sprints') return json({ rows: [{ sprint_id: 'SP', name: 'Название из среза', status_raw: '🔄 IN PROGRESS' }] });
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

const show = (f: typeof fetch) => render(
  <ListPassport type="sprint" id="SP" placement="bottom" fetchImpl={f} backLabel="Спринты" onBack={() => {}} />,
);

describe('паспорт v2 — на боевом фасаде', () => {
  it('положительный контроль: паспорт открылся', async () => {
    show(net(() => json(FACADE)));
    expect(await screen.findByText('Название от фасада', {}, { timeout: 8000 })).toBeTruthy();
  }, 15000);

  it('на экране данные фасада, а не среза — источник действительно сменился', async () => {
    show(net(() => json(FACADE)));
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    expect(document.body.textContent).not.toContain('Название из среза');
  }, 15000);

  it('состояние блоков фасада дошло до блока «Состояние данных»: «нет прав» названо', async () => {
    show(net(() => json(FACADE)));
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    await waitFor(() => {
      const ds = document.querySelector('.sk-ds') as HTMLElement;
      expect(ds).toBeTruthy();
      expect(ds.textContent).toContain('нет прав на задачи');
    });
  }, 15000);

  it('фасад выключен — паспорт из срезов, и причина отката НАЗВАНА на экране', async () => {
    show(net(() => json({ error: 'DISABLED', detail: 'фасад выключен' }, 501)));
    // Виден паспорт из срезов…
    await screen.findByText('Название из среза', {}, { timeout: 8000 });
    // …и рядом сказано, почему он собран на клиенте.
    await waitFor(() => {
      const ds = document.querySelector('.sk-ds') as HTMLElement;
      expect(ds?.textContent).toContain('собран на клиенте');
    });
  }, 15000);
});

// Управление связями доходит до человека (S4-MODEL-PASSPORT-LIST).
//
// В kit форма привязки была написана давно, но хук `onRelation` ей никто не
// давал — формы просто не было. А кому можно управлять, теперь говорит сервер
// (`manageable` у связи), а не вид UML: путь привязки есть не у каждой связи.
describe('паспорт v2 — управление связями', () => {
  const withRelation = (manageable: boolean) => ({
    ...FACADE,
    perms: { ...FACADE.perms, can_edit: true },
    schema: {
      ...FACADE.schema,
      relations: [{
        // IMPLEMENTED_IN ADR↔спринт: вид realization, и путь привязки у неё на
        // сервере ЕСТЬ (маршрут ADR_SPRINT) — ровно тот случай, где правило по
        // виду UML скрывало управление, хотя сервер его позволяет.
        key: 'adrs', label: 'Реализует ADR', relation: 'realization',
        rel: 'IMPLEMENTED_IN', dir: 'in', target_type: 'adr', place: 'links', manageable,
      }],
    },
  });

  const openDeps = async () => {
    // Реализация живёт в своей вкладке «Реализация», а не в общей «Связи»:
    // общая — это RecordLinks, там управления нет и быть не должно.
    const tab = await screen.findByRole('tab', { name: /Реализация/ }, { timeout: 8000 });
    tab.click();
  };

  it('связь с путём привязки — форма есть, хотя вид UML это запрещал', async () => {
    show(net(() => json(withRelation(true))));
    await openDeps();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
  }, 15000);

  it('связь без пути — формы нет: иначе человек введёт код и получит UNKNOWN_RELATION', async () => {
    show(net(() => json(withRelation(false))));
    await openDeps();
    await waitFor(() => expect(document.querySelector('.sk-rel__add')).toBeNull());
  }, 15000);

  it('сервер отказал по роли — причина напечатана, а не проглочена', async () => {
    const http = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname.endsWith('/relation')) return json({ error: 'FORBIDDEN', detail: 'admin role required' }, 403);
      if (url.pathname.startsWith('/lore/record/')) return json(withRelation(true));
      if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    show(http);
    await openDeps();
    const box = await screen.findByRole('textbox', {}, { timeout: 8000 });
    fireEvent.change(box, { target: { value: 'SPRINT_B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/роль администратора/));
    // Код не потерян: его не придётся набирать заново.
    expect((box as HTMLInputElement).value).toBe('SPRINT_B');
  }, 15000);
});

// Защита от затирания доходит до экрана (S5-08).
//
// Версия записи приходит фасадом и уходит в `expected_version` при сохранении.
// Если запись успели изменить, сервер отвечает 409, и человек должен УВИДЕТЬ,
// что случилось, и не потерять набранный текст. Молчаливая перезапись — то,
// против чего вся задача.
describe('паспорт v2 — одновременная правка', () => {
  const withBody = {
    ...FACADE,
    perms: { ...FACADE.perms, can_edit: true },
    // Тело спринта у сервера называется context_md — его и правим: именно на
    // этом имени правка пропадала после перехода на фасад.
    values: { ...FACADE.values, context_md: 'текст записи' },
  };

  it('версия записи уходит в expected_version при сохранении', async () => {
    const sent: Record<string, unknown>[] = [];
    const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname === '/lore/sprint/update') {
        sent.push(JSON.parse(String(init?.body)));
        return json({ ok: true });
      }
      if (url.pathname.startsWith('/lore/record/')) return json(withBody);
      if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    show(http);
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    const edit = await screen.findByRole('button', { name: /Править/ }, { timeout: 8000 });
    fireEvent.click(edit);
    fireEvent.click(screen.getByRole('radio', { name: 'Код' }));
    fireEvent.change(screen.getByLabelText(/исходник markdown/i), { target: { value: 'новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].expected_version).toBe('2026-11-08T10:00:00Z');
  }, 20000);

  it('запись изменили — сказано словами, и набранный текст остался в поле', async () => {
    const http = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname === '/lore/sprint/update') {
        return json({
          error: 'VERSION_CONFLICT',
          detail: 'sprint «SP»: версия не совпадает',
          current: { version: '2026-11-09T00:00:00Z', updated_by: 'omiloreadmin' },
        }, 409);
      }
      if (url.pathname.startsWith('/lore/record/')) return json(withBody);
      if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    show(http);
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    fireEvent.click(await screen.findByRole('button', { name: /Править/ }, { timeout: 8000 }));
    fireEvent.click(screen.getByRole('radio', { name: 'Код' }));
    const box = screen.getByLabelText(/исходник markdown/i);
    fireEvent.change(box, { target: { value: 'мой текст' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/изменили, пока вы её правили/));
    // Текст не потерян: перенабирать не придётся.
    expect((box as HTMLTextAreaElement).value).toBe('мой текст');
  }, 20000);
});
