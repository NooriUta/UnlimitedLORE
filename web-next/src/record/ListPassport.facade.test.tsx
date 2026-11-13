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
import { registerGameIcons, TechVisibilityProvider, type UrlWindow } from '@seidr/kit';
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

// S4-TECH-NOTES: строки состояния — tech; tech=true — включённая личная настройка.
const show = (f: typeof fetch, tech = false) => render(
  <TechVisibilityProvider show={tech}>
    <ListPassport type="sprint" id="SP" placement="bottom" fetchImpl={f} backLabel="Спринты" onBack={() => {}} />
  </TechVisibilityProvider>,
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

  // MP2-08 (13.11.2026): состояние данных больше не стоит блоком в потоке —
  // сообщения живут под значком warnings с попапом. Правило S4-TECH-NOTES
  // при этом не отменено: коды источников показывает включённая настройка.
  const openWarnings = async () => {
    const btn = await screen.findByRole('button', { name: /Состояние данных:/ }, { timeout: 8000 });
    fireEvent.click(btn);
    const pop = document.querySelector('.sk-warn__pop') as HTMLElement;
    expect(pop, 'поповер warnings открылся').toBeTruthy();
    return pop;
  };

  it('S4-TECH-NOTES: без настройки — код источника скрыт, «закрыта правами» сказано словами', async () => {
    show(net(() => json(FACADE)));
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    expect(document.querySelector('.sk-ds'), 'inline-блока состояния в компоновке нет').toBeNull();
    const pop = await openWarnings();
    expect(pop.textContent).toContain('закрыта правами');
    expect(pop.textContent).not.toContain('tasks_of_sprint');
  }, 15000);

  it('состояние блоков фасада дошло до значка warnings: «нет прав» названо', async () => {
    show(net(() => json(FACADE)), true);
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    const pop = await openWarnings();
    expect(pop.textContent).toContain('нет прав на задачи');
  }, 15000);

  it('фасад выключен — паспорт из срезов, и причина отката НАЗВАНА на экране', async () => {
    show(net(() => json({ error: 'DISABLED', detail: 'фасад выключен' }, 501)), true);
    // Виден паспорт из срезов…
    await screen.findByText('Название из среза', {}, { timeout: 8000 });
    // …и в поповере warnings сказано, почему он собран на клиенте.
    const pop = await openWarnings();
    expect(pop.textContent).toContain('собран на клиенте');
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

  // S4-24: цель — выбором с поиском из среза её типа (у ADR — adrs), а не вводом кода.
  it('связь с путём привязки — выбор цели есть, хотя вид UML это запрещал', async () => {
    show(net(() => json(withRelation(true))));
    await openDeps();
    await waitFor(() => expect(screen.getByRole('searchbox')).toBeTruthy());
  }, 15000);

  it('связь без пути — формы нет: иначе человек введёт код и получит UNKNOWN_RELATION', async () => {
    show(net(() => json(withRelation(false))));
    await openDeps();
    await waitFor(() => expect(document.querySelector('.sk-rel__add, .sk-rel__pick')).toBeNull());
  }, 15000);

  it('сервер отказал по роли — причина напечатана, а не проглочена', async () => {
    const http = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname.endsWith('/relation')) return json({ error: 'FORBIDDEN', detail: 'admin role required' }, 403);
      if (url.pathname.startsWith('/lore/record/')) return json(withRelation(true));
      if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      if (url.pathname === '/lore/slice/adrs') return json({ rows: [{ adr_id: 'ADR-B', name: 'Второй' }] });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    show(http);
    await openDeps();
    const box = await screen.findByRole('searchbox', {}, { timeout: 8000 });
    fireEvent.change(box, { target: { value: 'adr-b' } });
    fireEvent.click(await screen.findByRole('button', { name: /Привязать.*ADR-B/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/роль администратора/));
    // Поиск не потерян: выбор можно повторить, не набирая заново.
    expect((box as HTMLInputElement).value).toBe('adr-b');
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
    fireEvent.click(await screen.findByRole('button', { name: 'режим markdown-источника' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'режим markdown-источника' }));
    const box = screen.getByLabelText(/исходник markdown/i);
    fireEvent.change(box, { target: { value: 'мой текст' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/изменили, пока вы её правили/));
    // Текст не потерян: перенабирать не придётся.
    expect((box as HTMLTextAreaElement).value).toBe('мой текст');
  }, 20000);

  // S5-08, слияние по блокам: 409 → перечитали запись → слили три текста поля.
  /** Сеть, где после первой записи «кто-то» уже поменял текст: первая запись — 409. */
  function racing(theirs: string, sent: Record<string, unknown>[]) {
    let reads = 0;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname === '/lore/sprint/update') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sent.push(body);
        if (body.expected_version === 'v1') {
          return json({ error: 'VERSION_CONFLICT', detail: 'stale', current: { version: 'v2', updated_by: 'agent-x' } }, 409);
        }
        return json({ ok: true });
      }
      if (url.pathname.startsWith('/lore/record/')) {
        reads++;
        // Первое чтение — то, что человек открыл; дальше — запись после чужой правки.
        return reads === 1
          ? json({ ...withBody, record: { ...withBody.record, version: 'v1' }, values: { ...withBody.values, context_md: 'А.\n\nБ.\n\nВ.' } })
          : json({ ...withBody, record: { ...withBody.record, version: 'v2' }, values: { ...withBody.values, context_md: theirs } });
      }
      if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
  }

  async function editAndSave(text: string) {
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    fireEvent.click(await screen.findByRole('button', { name: /Править/ }, { timeout: 8000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'режим markdown-источника' }));
    fireEvent.change(screen.getByLabelText(/исходник markdown/i), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
  }

  it('правки разных блоков сливаются сами: вторая запись — слитый текст с новой версией', async () => {
    const sent: Record<string, unknown>[] = [];
    show(racing('А.\n\nБ.\n\nВ — их.', sent));
    await editAndSave('А — моё.\n\nБ.\n\nВ.');
    await waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]).toMatchObject({ context_md: 'А — моё.\n\nБ.\n\nВ — их.', expected_version: 'v2' });
    expect(document.body.textContent).not.toMatch(/Не сохранилось/);
  }, 20000);

  it('правка одного блока обеими — дифф только спорного блока, записи поверх нет', async () => {
    const sent: Record<string, unknown>[] = [];
    show(racing('А.\n\nБ — их.\n\nВ.', sent));
    await editAndSave('А.\n\nБ — моё.\n\nВ.');
    const panel = await screen.findByRole('group', { name: /Спорные блоки/ }, { timeout: 8000 });
    expect(panel.textContent).toContain('Б — их.');
    expect(panel.textContent).toContain('Б — моё.');
    expect(panel.textContent).toContain('agent-x');
    expect(document.querySelectorAll('.sk-mdmerge__block')).toHaveLength(1);
    expect(sent).toHaveLength(1);
    // Решили спор — следующая запись уходит с версией ПЕРЕЧИТАННОЙ записи, а не 409 снова.
    fireEvent.click(screen.getByRole('button', { name: /Оставить моё/ }));
    fireEvent.click(screen.getByRole('button', { name: /Применить/ }));
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]).toMatchObject({ context_md: 'А.\n\nБ — моё.\n\nВ.', expected_version: 'v2' });
  }, 20000);
});

// Вкладка паспорта живёт в адресе (аудит D-21).
//
// Было: `ListPassport` держал вкладку местным состоянием, и адрес о ней не
// знал. Следствие по словам аудита: «вкладки не живут в URL» — ссылку на
// «Связи» или «Историю» переслать нельзя, перезагрузка всегда возвращает
// «Обзор». Хук kit `useRecordTab` это умел и не вызывался ниоткуда.
describe('паспорт v2 — вкладка в адресе', () => {
  /** Окно с историей, как у списка: паспорт обязан писать именно в него. */
  const urlWin = (search = '') => {
    const w: UrlWindow = {
      location: { pathname: '/', search, hash: '' },
      history: {
        pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
        replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      },
    };
    return w;
  };

  const showWithWin = (f: typeof fetch, w: UrlWindow) => render(
    <ListPassport type="sprint" id="SP" placement="bottom" fetchImpl={f} backLabel="Спринты" onBack={() => {}} win={w} />,
  );

  it('положительный контроль: паспорт открылся', async () => {
    showWithWin(net(() => json(FACADE)), urlWin());
    expect(await screen.findByText('Название от фасада', {}, { timeout: 8000 })).toBeTruthy();
  }, 15000);

  it('выбор вкладки пишется в адрес — ссылкой можно поделиться', async () => {
    const w = urlWin();
    showWithWin(net(() => json(FACADE)), w);
    const tab = await screen.findByRole('tab', { name: /Связи/ }, { timeout: 8000 });
    fireEvent.click(tab);
    await waitFor(() => expect(w.location.search).toContain('tab=links'));
  }, 15000);

  it('адрес с вкладкой открывает её сразу, а не «Обзор»', async () => {
    showWithWin(net(() => json(FACADE)), urlWin('?tab=links'));
    await screen.findByText('Название от фасада', {}, { timeout: 8000 });
    const tab = await screen.findByRole('tab', { name: /Связи/ }, { timeout: 8000 });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  }, 15000);
});
