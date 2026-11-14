// @vitest-environment jsdom
// Находка на preprod 14.11.2026: открытие отсутствующей записи (ADR-LORE-050 в старом снимке базы)
// показывало «Не смогли загрузить — это не «пусто»: данные не получены», хотя сервер ответил 404
// «не найден». Это ложь в обратную сторону: данные получены, и ответ — «записи нет». «Не нашли»,
// «нет прав» и «сломалось» — три разных утверждения (liveRecord: RecordNotFound / Forbidden / FetchError).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const win: UrlWindow = { location: { pathname: '/', search: '?open=ADR-X', hash: '' }, history: { pushState: vi.fn(), replaceState: vi.fn() } };

describe('паспорт: записи нет (404) — это не сбой загрузки', () => {
  it('404 — «Запись … не найдена» с кодом, без «не смогли загрузить»', async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://x').pathname;
      if (path.startsWith('/lore/record/')) return json({ error: 'NOT_FOUND', detail: "adr 'ADR-X' не найден" }, 404);
      return json({ rows: [] });
    });
    render(<ListPassport type="adr" id="ADR-X" placement="right" fetchImpl={f as unknown as typeof fetch} win={win} />);
    expect(await screen.findByText('Запись ADR-X не найдена', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText(/Не смогли загрузить/)).toBeNull();
    expect(screen.getAllByText(/ADR-X/).length).toBeGreaterThan(0);
  });

  it('положительный контроль: 502 — по-прежнему «не смогли загрузить» с «повторить»', async () => {
    const f = vi.fn(async () => json({ error: 'LORE_UPSTREAM', detail: 'db down' }, 502));
    render(<ListPassport type="adr" id="ADR-X" placement="right" fetchImpl={f as unknown as typeof fetch} win={win} />);
    expect(await screen.findByRole('button', { name: /Повторить/ }, { timeout: 8000 })).toBeTruthy();
  });
});
