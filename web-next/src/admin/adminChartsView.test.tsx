// @vitest-environment jsdom
// Графики админских журналов — видом «Аналитика», не над журналом (правило владелицы 21.11.2026: графики никогда не
// стоят над содержимым). «Действия» (№13) и «MCP» (№14) прежде рисовали график над таблицей.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { ActionsScreen } from './ActionsScreen';
import { McpScreen } from './McpScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/?mod=admin'); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const f = vi.fn(async (url: string) => (String(url).includes('/lore/') ? json({ rows: [], shown: 0, total: 0, total_state: 'exact', truncated: false, limit: 200, filters: {} }) : json({}, 404))) as unknown as typeof fetch;

const charts = (c: Element) => c.querySelectorAll('.sk-rec-charts, .adm-chart, [data-testid="kit-chart"]');

for (const [name, mount] of [
  ['Действия', () => render(<KitLangProvider lang="ru"><ActionsScreen fetchImpl={f} /></KitLangProvider>)],
  ['MCP', () => render(<KitLangProvider lang="ru"><McpScreen fetchImpl={f} now={Date.UTC(2026, 10, 21)} /></KitLangProvider>)],
] as const) {
  describe(`админка «${name}»: график — видом «Аналитика»`, () => {
    it('по умолчанию (журнал) графика нет; «Аналитика» показывает график и пишет aview=analytics', async () => {
      const { container } = mount();
      const sw = await screen.findByTestId('adm-view-switch');
      expect(charts(container).length, 'над журналом графика нет').toBe(0);
      fireEvent.click(within(sw).getByRole('button', { name: 'Аналитика' }));
      await waitFor(() => expect(container.querySelector('.sk-rec-charts .adm-chart')).not.toBeNull());
      expect(new URL(window.location.href).searchParams.get('aview')).toBe('analytics');
    });
  });
}
