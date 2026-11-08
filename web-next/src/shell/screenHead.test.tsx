// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-23 (волна 1a): заголовок раздела-списка — шапка экрана kit
// (ScreenHead), а не отдельный h1 оболочки над полосами списка. Тогда виды
// встают в строку заголовка, и таблица начинается на полосу выше (в v2 — y=186
// против 142 в прототипе v4). h1 по-прежнему один, раздел им подписан.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import App from '../App';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}
const mem = () => createSafeStorage(() => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } as unknown as Storage;
});

const slice = { rows: [
  { adr_id: 'ADR-1', name: 'Первое', status: 'accepted', decisions: 1, updated_at: '2026-11-01' },
  { adr_id: 'ADR-2', name: 'Второе', status: 'proposed', decisions: 0, updated_at: '2026-11-02' },
] };
const okFetch = (async () => new Response(JSON.stringify(slice), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

describe('раздел ADR: заголовок — шапка экрана kit', () => {
  it('в оболочке — один h1 «ADR», и он внутри ScreenHead раздела', () => {
    const { container } = render(<App path="/" win={fakeWin()} storage={mem()} narrow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'ADR' }));
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('ADR');
    expect(h1s[0].closest('[data-testid="kit-screenhead"]')).not.toBeNull();
    expect(container.querySelector('[data-section="adr"]')?.getAttribute('aria-labelledby')).toBe(h1s[0].id);
  });

  it('список загружен — виды «Список / Доска» в строке заголовка, а не отдельной полосой', async () => {
    render(<ListScreen screen="adrs" fetchImpl={okFetch} urlState={false} />);
    await screen.findAllByText(/Первое/);
    const head = screen.getByTestId('kit-screenhead');
    expect(within(head).getByRole('heading', { level: 1 }).textContent).toBe('ADR');
    expect(within(head).getByRole('radiogroup')).toBeTruthy();
  });
});
