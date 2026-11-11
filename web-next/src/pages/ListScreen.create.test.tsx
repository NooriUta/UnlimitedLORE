// @vitest-environment jsdom
// «+ Новая» в шапке раздела (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
//
// Слово владелицы 08.11: «форма „новая“ открывает ту же форму, что и кнопка
// „читать целиком“». Закрепляется:
//   - кнопка есть, только если сервер разрешает создавать (perms.can_create
//     паспорта `_new`): кнопка, которая откажет после заполнения, хуже её
//     отсутствия;
//   - черновик открывается в ТОМ ЖЕ доке записи и в том же месте, что запись
//     (личная настройка «Где открывать запись», по умолчанию — справа);
//   - после сохранения в том же доке открывается сама запись.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
afterEach(() => { document.documentElement.removeAttribute('data-passport-place'); });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPRINTS = [{ sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 ACTIVE' }];

function net(canCreate: boolean) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, init });
    if (u.includes('/lore/record/sprint/_new')) return json(200, { perms: { can_create: canCreate, reason: canCreate ? null : 'нет прав' } });
    if (u.includes('/lore/record/sprint/S_NEW')) {
      // До записи кода нет (404); после — паспорт есть.
      const created = calls.some(c => c.init?.method === 'POST');
      return created ? json(500, { error: 'не важно для теста' }) : json(404, { error: 'NOT_FOUND' });
    }
    if (u.includes('/lore/sprint/create')) return json(200, { ok: true, sprint_id: 'S_NEW', created: true });
    if (u.includes('/lore/model')) return json(502, { error: 'нет модели' });
    return json(200, { rows: SPRINTS });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const newBtn = () => screen.queryByRole('button', { name: /Новая/ });

describe('S4-24 · «+ Новая» открывает черновик в доке записи', () => {
  it('положительный контроль: список нарисован', async () => {
    const { impl } = net(true);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="S_A"]')).toBeTruthy());
  });

  it('права создавать нет — кнопки нет', async () => {
    const { impl, calls } = net(false);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="S_A"]')).toBeTruthy());
    await waitFor(() => expect(calls.some(c => c.url.includes('/lore/record/sprint/_new'))).toBe(true));
    expect(newBtn()).toBeNull();
  });

  it('право есть — кнопка в шапке; нажатие открывает черновик в доке справа', async () => {
    const { impl } = net(true);
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(newBtn()).toBeTruthy());
    fireEvent.click(newBtn()!);
    const form = await screen.findByTestId('record-create', {}, { timeout: 5000 });
    expect(form.getAttribute('data-type')).toBe('sprint');
    expect(form.closest('[data-testid="kit-rec-dock"]')?.getAttribute('data-placement')).toBe('right');
  });

  it('личная настройка «снизу» — черновик в доке снизу', async () => {
    document.documentElement.setAttribute('data-passport-place', 'bottom');
    const { impl } = net(true);
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(newBtn()).toBeTruthy());
    fireEvent.click(newBtn()!);
    const form = await screen.findByTestId('record-create', {}, { timeout: 5000 });
    expect(form.closest('[data-testid="kit-rec-dock"]')?.getAttribute('data-placement')).toBe('bottom');
  });

  it('сохранили — запись уходит на сервер, и в том же доке открывается сама запись', async () => {
    const { impl, calls } = net(true);
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await waitFor(() => expect(newBtn()).toBeTruthy());
    fireEvent.click(newBtn()!);
    const form = await screen.findByTestId('record-create', {}, { timeout: 5000 });
    const inputs = form.querySelectorAll('input[type="text"], input:not([type])');
    fireEvent.change(inputs[0], { target: { value: 'S_NEW' } });
    fireEvent.change(inputs[1], { target: { value: 'Новый спринт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls.some(c => c.init?.method === 'POST' && c.url.includes('/lore/sprint/create'))).toBe(true));
    const post = calls.find(c => c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ sprint_id: 'S_NEW', name: 'Новый спринт' });
    // Черновика больше нет — в доке запись S_NEW (паспорт грузится по её коду).
    await waitFor(() => expect(screen.queryByTestId('record-create')).toBeNull());
    expect(screen.getByTestId('kit-rec-dock')).toBeTruthy();
  });
});
