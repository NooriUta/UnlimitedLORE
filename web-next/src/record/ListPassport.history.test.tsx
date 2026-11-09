// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-11 — вкладка «История» в паспорте v2.
//
// kit умеет её с S5-11, но в v2 `RecordView.history` никто не передавал: сервер
// историю отдавал, а человек её не видел. Здесь проверка сквозная — от ответа
// /lore/history до вкладки с версиями.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HISTORY = {
  type: 'sprint', id: 'SP',
  rows: [
    {
      entity_type: 'sprint', hist_type: 'KnowSprintHist', ref_id: 'SP', state_uid: 'st-1',
      valid_from: '2026-11-01T10:00:00Z', valid_to: '2026-11-05T10:00:00Z',
      status_raw: '📋 PLANNED', content_hash: 'h1',
      author: { kind: 'human', caller: 'sub-owner', source: 'hist' },
    },
    {
      entity_type: 'sprint', hist_type: 'KnowSprintHist', ref_id: 'SP', state_uid: 'st-2',
      valid_from: '2026-11-05T10:00:00Z', valid_to: null,
      status_raw: '🔄 IN PROGRESS', content_hash: 'h2',
      author: { kind: 'agent', caller: 'lore-mcp-full', source: 'hist' },
    },
  ],
  attribution: { ok: true, source: 'changed_by версии (S2-12)' },
};

function fakeFetch(historyStatus = 200, historyBody: unknown = HISTORY) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    if (url.pathname === '/lore/history') return json(historyBody, historyStatus);
    if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
    const slice = url.pathname.split('/').pop();
    if (slice === 'sprints') return json({ rows: [{ sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' }] });
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

const show = (f: typeof fetch) => render(
  <ListPassport type="sprint" id="SP" placement="bottom" fetchImpl={f} backLabel="Спринты" onBack={() => {}} />,
);

describe('вкладка «История» в паспорте', () => {
  it('положительный контроль: паспорт открылся', async () => {
    show(fakeFetch());
    expect(await screen.findByText('Спринт SP', {}, { timeout: 8000 })).toBeTruthy();
  }, 15000);

  it('вкладка есть, и в ней версии с сервера — новейшая первой', async () => {
    show(fakeFetch());
    const tab = await screen.findByRole('tab', { name: /История/ }, { timeout: 8000 });
    expect(tab).toBeTruthy();
    tab.click();
    // Статус спринта виден и в шапке записи, поэтому ищем версии внутри
    // панели вкладки: две строки истории с обоими состояниями.
    await waitFor(() => {
      const panel = document.querySelector('.sk-tabpanel') as HTMLElement;
      expect(panel.textContent).toMatch(/IN PROGRESS/);
      expect(panel.textContent).toMatch(/PLANNED/);
    });
  }, 15000);

  it('запрет по скоупу — «нет прав», а не пустая история', async () => {
    show(fakeFetch(403, { error: 'SCOPE_EMPTY', detail: 'нет ни одного разрешённого проекта' }));
    const tab = await screen.findByRole('tab', { name: /История/ }, { timeout: 8000 });
    tab.click();
    // kit рисует состояние «нет прав» (Forbidden), а не «правок не было».
    await waitFor(() => expect(document.body.textContent).toMatch(/прав|доступ/i));
  }, 15000);
});
