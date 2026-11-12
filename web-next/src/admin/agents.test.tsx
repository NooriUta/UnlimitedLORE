// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-15, S7B-16 — агенты: harness и машина в админке v2.
// Форма ответа — от сервера (d8097ab4, миграция V75): agent_owners + harness,
// реестр — справочник harness (срез dictionary?dict_type=harness: только is_active,
// по sort_order), правка POST /lore/actor/owner (harness "" — сброс).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { filterAgents, harnessCounts, HARNESS_NONE, offRegistry, parseAgents, parseHarnessDict, setAgentHarness, setAgentMachine } from './agents';

beforeAll(() => { registerGameIcons(gameIcons); });

const REG = ['claude-code', 'kimi-code', 'dsh', 'codex', 'opencode'];
// Справочник: порядок по sort_order, opencode неактивен — в выбор не попадает.
const DICT = [
  { code: 'kimi-code', label_ru: 'Kimi Code', label_en: 'Kimi Code', sort_order: 2, is_active: true },
  { code: 'claude-code', label_ru: 'Claude Code', label_en: 'Claude Code', sort_order: 1, is_active: true },
  { code: 'dsh', label_ru: 'DSH', label_en: 'DSH', sort_order: 3, is_active: true },
  { code: 'codex', label_ru: 'Codex', label_en: 'Codex', sort_order: 4, is_active: true },
  { code: 'opencode', label_ru: 'OpenCode', label_en: 'OpenCode', sort_order: 5, is_active: false },
];
const ACTIVE = ['claude-code', 'kimi-code', 'dsh', 'codex'];
const ROWS = [
  { actor_id: 'A1', name: 'Claude Code (full)', client_id: 'lore-full', agent_role: 'full', machine_id: 'lorcetus', session_id: null, harness: 'claude-code', owner_kc_sub: 'u1', owner_display_name: 'Владелица' },
  { actor_id: 'A2', name: 'Kimi', client_id: 'lore-full', agent_role: 'full', machine_id: null, session_id: null, harness: 'kimi-code', owner_kc_sub: 'u1', owner_display_name: 'Владелица' },
  { actor_id: 'A3', name: 'Непонятный', client_id: 'lore-ro', agent_role: 'reader', machine_id: null, session_id: null, harness: null, owner_kc_sub: null, owner_display_name: null },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fake(body: unknown, status = 200, dict: unknown[] | 'fail' = DICT) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('/lore/actor/owner')) return json({ ok: true });
    if (url.startsWith('/lore/slice/dictionary')) return dict === 'fail' ? json({ error: 'DOWN' }, 502) : json({ rows: dict });
    return json(body, status);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={f} /></KitLangProvider>);

describe('модель агентов', () => {
  it('владелец приходит массивом (как отдаёт agent_owners) — читается, а не «не указан»', () => {
    const d = parseAgents({ rows: [{ ...ROWS[0], owner_kc_sub: ['u1'], owner_display_name: ['omiloreadmin'] }] } as never);
    expect(d.rows[0].owner_display_name).toBe('omiloreadmin');
    expect(d.rows[0].owner_kc_sub).toBe('u1');
  });

  it('два владельца — оба видны; для правки берётся первый', () => {
    const d = parseAgents({ rows: [{ ...ROWS[0], owner_kc_sub: ['u1', 'u2'], owner_display_name: ['a', 'b'] }] } as never);
    expect(d.rows[0].owner_display_name).toBe('a, b');
    expect(d.rows[0].owner_kc_subs).toEqual(['u1', 'u2']);
  });

  it('harness и машина читаются; пустая строка — null, а не «»', () => {
    const d = parseAgents({ rows: [{ ...ROWS[0], machine_id: '' }] } as never, parseHarnessDict(DICT));
    expect(d.rows[0].harness).toBe('claude-code');
    expect(d.rows[0].machine_id).toBeNull();
    expect(d.registry).toEqual(ACTIVE);
    expect(d.labels['kimi-code']).toBe('Kimi Code');
  });

  it('справочник пуст (миграция не прошла) — правки нет, причина «пуст»; свой список не подставляем', () => {
    const d = parseAgents({ rows: ROWS } as never, []);
    expect(d.registry).toBeNull();
    expect(d.registryProblem).toEqual({ kind: 'empty' });
  });

  it('справочник не прочитался — правки нет, причина «ошибка» с текстом, а не «пуст»', () => {
    const d = parseAgents({ rows: ROWS } as never, { error: 'HTTP 502' });
    expect(d.registryProblem).toEqual({ kind: 'error', reason: 'HTTP 502' });
  });

  it('в выбор — только активные, по sort_order; неактивный код у актора — «вне справочника»', () => {
    const d = parseAgents({ rows: [{ ...ROWS[0], harness: 'opencode' }] } as never, parseHarnessDict(DICT));
    expect(d.registry).toEqual(ACTIVE);
    expect(offRegistry('opencode', d.registry)).toBe(true);
    expect(offRegistry('claude-code', d.registry)).toBe(false);
    expect(offRegistry(null, d.registry)).toBe(false);
  });

  it('разбивка: каждый harness реестра, «не указан» отдельно; пустые harness реестра — с нулём', () => {
    const c = harnessCounts(parseAgents({ rows: ROWS } as never).rows, REG);
    expect(c.find(x => x.key === 'claude-code')?.n).toBe(1);
    expect(c.find(x => x.key === 'dsh')?.n).toBe(0);
    expect(c.find(x => x.key === HARNESS_NONE)?.n).toBe(1);
  });

  it('фильтр «не указан» отбирает агентов без harness', () => {
    const rows = parseAgents({ rows: ROWS } as never).rows;
    expect(filterAgents(rows, HARNESS_NONE).map(r => r.actor_id)).toEqual(['A3']);
    expect(filterAgents(rows, null)).toHaveLength(3);
  });

  it('правка: тело по договору с сервером; сброс — harness ""', async () => {
    const { f, calls } = fake({});
    await setAgentHarness({ actor_id: 'A3', client_id: 'lore-ro', owner_kc_sub: null }, null, f);
    expect(calls[0].url).toBe('/lore/actor/owner');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ actor_id: 'A3', client_id: 'lore-ro', kc_sub: null, harness: '' });
  });

  it('400 вне реестра — ошибка со статусом, не молчаливый успех', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_HARNESS', detail: 'допустимо: claude-code, …' }, 400)) as unknown as typeof fetch;
    await expect(setAgentHarness({ actor_id: 'A1', client_id: null, owner_kc_sub: null }, 'x', f)).rejects.toMatchObject({ status: 400 });
  });
});

describe('экран «Агенты»', () => {
  it('сводка чипами: сколько агентов какого harness; «не указан» видно отдельно', async () => {
    mount(fake({ rows: ROWS }).f);
    const chips = await screen.findByTestId('adm-harness-chips');
    expect(within(chips).getByTestId('adm-harness-claude-code').textContent).toContain('1');
    expect(within(chips).getByTestId(`adm-harness-${HARNESS_NONE}`).textContent).toMatch(/не указан.*1/);
  });

  it('чип «без машины» — число и фильтр; выбор в адресе (adm-agents-f=nomachine), S7B-25', async () => {
    window.history.replaceState(null, '', '/');
    mount(fake({ rows: ROWS }).f);
    const chip = await screen.findByTestId('adm-agents-nomachine');
    expect(chip.textContent).toMatch(/без машины.*2/);
    fireEvent.click(chip);
    expect(new URLSearchParams(window.location.search).get('adm-agents-f')).toBe('nomachine');
    expect(screen.queryByTestId('adm-agent-A1')).toBeNull();
    expect(screen.getByTestId('adm-agent-A2')).toBeTruthy();
    expect(screen.getByTestId('adm-agent-A3')).toBeTruthy();
    fireEvent.click(chip);
    expect(new URLSearchParams(window.location.search).get('adm-agents-f')).toBeNull();
    expect(screen.getByTestId('adm-agent-A1')).toBeTruthy();
  });

  it('у агента без машины — «не привязана» словами, а не пустая клетка', async () => {
    mount(fake({ rows: ROWS }).f);
    const row = await screen.findByTestId('adm-agent-A2');
    expect(row.textContent).toContain('не привязана');
    expect((await screen.findByTestId('adm-agent-A1')).textContent).toContain('lorcetus');
  });

  it('чип фильтрует таблицу; повторное нажатие снимает', async () => {
    mount(fake({ rows: ROWS }).f);
    fireEvent.click(await screen.findByTestId('adm-harness-kimi-code'));
    expect(screen.queryByTestId('adm-agent-A1')).toBeNull();
    expect(screen.getByTestId('adm-agent-A2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('adm-harness-kimi-code'));
    expect(screen.getByTestId('adm-agent-A1')).toBeTruthy();
  });

  it('выбор harness НЕ пишет сразу: дифф «было → станет», «Отмена» ничего не пишет (S7B-25)', async () => {
    const { f, calls } = fake({ rows: ROWS });
    mount(f);
    const sel = within(await screen.findByTestId('adm-agent-A2')).getByRole('combobox');
    fireEvent.change(sel, { target: { value: 'dsh' } });
    const pend = await screen.findByTestId('adm-harness-pending-A2');
    expect(pend.textContent).toContain('Kimi Code');
    expect(pend.textContent).toContain('DSH');
    expect(calls.some(c => c.url === '/lore/actor/owner')).toBe(false);
    fireEvent.click(within(pend).getByTestId('adm-harness-cancel'));
    expect(screen.queryByTestId('adm-harness-pending-A2')).toBeNull();
    expect(calls.some(c => c.url === '/lore/actor/owner')).toBe(false);
  });

  it('применённый harness можно вернуть одним нажатием — прежнее значение уходит на сервер (S7B-25)', async () => {
    const { f, calls } = fake({ rows: ROWS });
    mount(f);
    const sel = within(await screen.findByTestId('adm-agent-A2')).getByRole('combobox');
    fireEvent.change(sel, { target: { value: 'dsh' } });
    fireEvent.click(within(await screen.findByTestId('adm-harness-pending-A2')).getByTestId('kit-diff-apply'));
    const back = await screen.findByTestId('adm-harness-revert-A2');
    expect(back.textContent).toContain('Kimi Code');
    fireEvent.click(back);
    await waitFor(() => expect(calls.filter(c => c.url === '/lore/actor/owner')).toHaveLength(2));
    const posts = calls.filter(c => c.url === '/lore/actor/owner').map(c => JSON.parse(String(c.init?.body)).harness);
    expect(posts).toEqual(['dsh', 'kimi-code']);
  });

  it('выбор harness из реестра после «Применить» сохраняется на сервер и список перечитывается', async () => {
    const { f, calls } = fake({ rows: ROWS });
    mount(f);
    const sel = within(await screen.findByTestId('adm-agent-A3')).getByRole('combobox');
    fireEvent.change(sel, { target: { value: 'dsh' } });
    fireEvent.click(within(await screen.findByTestId('adm-harness-pending-A3')).getByTestId('kit-diff-apply'));
    await waitFor(() => expect(calls.some(c => c.url === '/lore/actor/owner')).toBe(true));
    const post = calls.find(c => c.url === '/lore/actor/owner')!;
    expect(JSON.parse(String(post.init?.body)).harness).toBe('dsh');
    await waitFor(() => expect(calls.filter(c => c.url.startsWith('/lore/slice/agent_owners')).length).toBe(2));
  });

  it('справочник пуст: правки нет, harness показан как есть, причина сказана', async () => {
    mount(fake({ rows: ROWS }, 200, []).f);
    const note = await screen.findByTestId('adm-no-registry');
    expect(note.dataset.kind).toBe('empty');
    expect(note.textContent).toMatch(/пуст/);
    expect(within(screen.getByTestId('adm-agent-A1')).queryByRole('combobox')).toBeNull();
  });

  it('справочник упал — агенты всё равно видны, правки нет, сказано «не прочитался»', async () => {
    mount(fake({ rows: ROWS }, 200, 'fail').f);
    const note = await screen.findByTestId('adm-no-registry');
    expect(note.dataset.kind).toBe('error');
    expect(screen.getByTestId('adm-agent-A1')).toBeTruthy();
  });

  it('неактивный в справочнике код у агента — виден с пометкой «вне справочника»', async () => {
    mount(fake({ rows: [{ ...ROWS[0], harness: 'opencode' }] }).f);
    expect(await screen.findByTestId('adm-off-dict')).toBeTruthy();
    const sel = within(screen.getByTestId('adm-agent-A1')).getByRole('combobox') as HTMLSelectElement;
    expect(sel.value).toBe('opencode');
    expect([...sel.options].map(o => o.value)).toEqual(['', 'opencode', ...ACTIVE]);
  });

  it('403 — «нет прав», а не «агентов нет»', async () => {
    mount(fake({ error: 'FORBIDDEN', detail: 'admin only' }, 403).f);
    await waitFor(() => expect(document.body.textContent).toMatch(/прав/i));
    expect(document.body.textContent).not.toContain('Агентов нет');
  });
});

// ── S7B-16: привязка машины в карточке агента ───────────────────────────────
// Сервер (#1031, LoreProductResource.setActorOwner): POST /lore/actor/owner
// {actor_id, client_id, kc_sub, machine_id}; machine_id null — не трогать,
// "" — отвязать; две машины с одним именем — 400 с названием занявшего.
describe('карточка агента · машина (S7B-16)', () => {
  const open = (id: string) => window.history.replaceState(null, '', `/?adm-agent=${id}`);

  function fakeM(ownerStatus = 200, ownerBody: unknown = { ok: true }) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith('/lore/actor/owner')) return json(ownerBody, ownerStatus);
      if (url.startsWith('/lore/slice/dictionary')) return json({ rows: DICT });
      if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: ROWS });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    const posts = () => calls.filter(c => c.url === '/lore/actor/owner').map(c => JSON.parse(String(c.init?.body)) as Record<string, unknown>);
    return { f, calls, posts };
  }

  it('модель: тело — только machine_id, harness не трогаем; отвязка — ""', async () => {
    const { f, posts } = fakeM();
    await setAgentMachine({ actor_id: 'A2', client_id: 'lore-full', owner_kc_sub: 'u1' }, 'lorcetus', f);
    await setAgentMachine({ actor_id: 'A2', client_id: 'lore-full', owner_kc_sub: 'u1' }, null, f);
    expect(posts()[0]).toEqual({ actor_id: 'A2', client_id: 'lore-full', kc_sub: 'u1', machine_id: 'lorcetus' });
    expect(posts()[1].machine_id).toBe('');
    expect('harness' in posts()[0]).toBe(false);
  });

  it('не привязана — сказано словами; ввод имени и «Привязать» пишет machine_id и перечитывает список', async () => {
    open('A2');
    const fk = fakeM();
    mount(fk.f);
    const box = await screen.findByTestId('adm-machine-A2');
    expect(box.getAttribute('data-bound')).toBe('false');
    expect(box.textContent).toContain('не привязана');
    fireEvent.change(within(box).getByTestId('adm-machine-input'), { target: { value: 'lorcetus' } });
    fireEvent.click(within(box).getByTestId('adm-machine-save'));
    await waitFor(() => expect(fk.posts()).toHaveLength(1));
    expect(fk.posts()[0]).toMatchObject({ actor_id: 'A2', machine_id: 'lorcetus', kc_sub: 'u1' });
    await waitFor(() => expect(fk.calls.filter(c => c.url.startsWith('/lore/slice/agent_owners')).length).toBe(2));
  });

  it('привязана — видно имя машины и есть «Отвязать» (machine_id "")', async () => {
    open('A1');
    const fk = fakeM();
    mount(fk.f);
    const box = await screen.findByTestId('adm-machine-A1');
    expect(box.getAttribute('data-bound')).toBe('true');
    expect(box.textContent).toContain('lorcetus');
    fireEvent.click(within(box).getByTestId('adm-machine-unbind'));
    // S7B-25: отвязка — не в один клик: сперва вопрос с именем машины, записи ещё нет.
    const ask = within(box).getByTestId('adm-machine-unbind-ask');
    expect(ask.textContent).toContain('lorcetus');
    expect(fk.posts()).toHaveLength(0);
    fireEvent.click(within(ask).getByTestId('adm-machine-unbind-no'));
    expect(within(box).queryByTestId('adm-machine-unbind-ask')).toBeNull();
    expect(fk.posts()).toHaveLength(0);
    fireEvent.click(within(box).getByTestId('adm-machine-unbind'));
    fireEvent.click(within(box).getByTestId('adm-machine-unbind-yes'));
    await waitFor(() => expect(fk.posts()).toHaveLength(1));
    expect(fk.posts()[0].machine_id).toBe('');
  });

  it('две машины с одним именем — слова сервера (400), а не молчаливый успех', async () => {
    open('A2');
    const fk = fakeM(400, { error: 'BAD_PARAMS', detail: "machine_id 'lorcetus' уже занят машиной 'M9'" });
    mount(fk.f);
    const box = await screen.findByTestId('adm-machine-A2');
    fireEvent.change(within(box).getByTestId('adm-machine-input'), { target: { value: 'lorcetus' } });
    fireEvent.click(within(box).getByTestId('adm-machine-save'));
    const err = await within(box).findByTestId('adm-machine-error');
    expect(err.textContent).toContain('уже занят');
  });

  it('подсказка занятых имён: известные машины в подсказке ввода; имя уже есть — сказано, у кого (S7B-25)', async () => {
    open('A2');
    const fk = fakeM();
    mount(fk.f);
    const box = await screen.findByTestId('adm-machine-A2');
    const input = within(box).getByTestId('adm-machine-input') as HTMLInputElement;
    const list = document.getElementById(input.getAttribute('list') ?? '');
    expect(list).toBeTruthy();
    expect([...list!.querySelectorAll('option')].map(o => o.getAttribute('value'))).toEqual(['lorcetus']);
    fireEvent.change(input, { target: { value: 'lorcetus' } });
    expect(within(box).getByTestId('adm-machine-taken').textContent).toContain('Claude Code (full)');
    fireEvent.change(input, { target: { value: 'новая' } });
    expect(within(box).queryByTestId('adm-machine-taken')).toBeNull();
  });

  it('у агента нет владельца — правки нет, причина сказана (сервер требует kc_sub)', async () => {
    open('A3');
    mount(fakeM().f);
    const box = await screen.findByTestId('adm-machine-A3');
    expect(within(box).getByTestId('adm-machine-noowner')).toBeTruthy();
    expect(within(box).queryByTestId('adm-machine-save')).toBeNull();
  });
});

describe('экран «Агенты» · «не привязана» не рвётся на две строки', () => {
  // P-10: в узкой колонке «не привязана» переносилась посередине слова и
  // читалась как две подписи. Статус — одной строкой (nowrap в Admin.css),
  // полный текст остаётся в подсказке.
  it('в ячейке машины плейсхолдер с подсказкой, а CSS держит его в одну строку', async () => {
    mount(fake({ rows: ROWS }).f);
    const row = await screen.findByTestId('adm-agent-A2');
    const missing = within(row).getByText('не привязана');
    expect(missing.getAttribute('title')).toBe('не привязана');
    const css = readFileSync(join(process.cwd(), 'src/admin/Admin.css'), 'utf8');
    expect(css).toMatch(/\.adm-missing\s*\{[^}]*white-space:\s*nowrap/);
  });
});
