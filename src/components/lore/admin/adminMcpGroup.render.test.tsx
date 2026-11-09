// SPRINT_UXR_S0_SAFETY/S0-07 — рендер вместо чтения исходника как текста.
//
// Раньше adminMcpGroup.test.ts искал в LoreAdminPanel.tsx / LorePage.tsx строки
// вида `tab === 'mcpApi' && <LoreMcpApiScreen` — любой перенос кода (карта
// вкладок, вынос в под-компонент, другой файл) ронял тест при работающем экране,
// а сломанный экран с той же строкой проходил. Теперь проверяется поведение:
// по адресу рисуется нужный экран.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { renderUi } from '../../../test/render';
import { TAB_I18N, TAB_TITLES } from './adminTabs';

// Экраны MCP — заглушки с меткой: проверяем маршрутизацию, а не их содержимое.
vi.mock('../LoreMcpApiScreen', () => ({ default: () => <div data-testid="screen-mcp-api" /> }));
vi.mock('../LoreConnectionsScreen', () => ({ default: () => <div data-testid="screen-connections" /> }));

// Данные админки — пустые, но «загруженные»; KC-мост не настроен.
vi.mock('../../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/lore')>()),
  fetchLoreSlice: () => Promise.resolve([]),
}));
vi.mock('../kc-state', async importOriginal => ({
  ...(await importOriginal<typeof import('../kc-state')>()),
  loadKc: () => Promise.resolve({ k: 'off', detail: 'test' }),
  loadKcObj: () => Promise.resolve(null),
}));

const { default: LoreAdminPanel } = await import('./LoreAdminPanel');

describe('Админка · группа «MCP» (render)', () => {
  beforeEach(() => { void i18n.changeLanguage('ru'); });

  it('?tab=mcpApi рисует справочник инструментов MCP', async () => {
    renderUi(<LoreAdminPanel onError={() => {}} />, { route: '/lore?section=admin&tab=mcpApi' });
    expect(await screen.findByTestId('screen-mcp-api')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-connections')).toBeNull();
  });

  it('?tab=connections рисует рецепт подключения', async () => {
    renderUi(<LoreAdminPanel onError={() => {}} />, { route: '/lore?section=admin&tab=connections' });
    expect(await screen.findByTestId('screen-connections')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-mcp-api')).toBeNull();
  });

  it('клик по вкладке «Подключения» в навигации открывает экран', async () => {
    renderUi(<LoreAdminPanel onError={() => {}} />, { route: '/lore?section=admin&tab=mcpApi' });
    await screen.findByTestId('screen-mcp-api');
    const label = i18n.t(TAB_I18N.connections, TAB_TITLES.connections);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    expect(await screen.findByTestId('screen-connections')).toBeInTheDocument();
  });
});

// Старые адреса ?section=mcp / ?section=connections (закладки, ссылки в доках)
// должны продолжать открывать те же экраны вне админки.
describe('LorePage · старые адреса экранов MCP (render)', () => {
  // Первый импорт LorePage (тяжёлая страница, сотни модулей) стоил секунды трансформации и
  // шёл ВНУТРИ теста — под лимитом 5 с. На загруженном раннере тест падал по таймауту
  // (прогон 4884, PR #1020; push preprod 09.11), второй тест — нет: модуль уже в кэше.
  // Импорт — в beforeAll со своим лимитом; тест мерит только маршрутизацию.
  let LorePage: typeof import('../../../pages/LorePage').default;
  beforeAll(async () => {
    ({ default: LorePage } = await import('../../../pages/LorePage'));
  }, 60_000);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('?section=mcp открывает справочник инструментов', async () => {
    renderUi(<LorePage />, { route: '/lore?section=mcp' });
    expect(await screen.findByTestId('screen-mcp-api')).toBeInTheDocument();
  });

  it('?section=connections открывает рецепт подключения', async () => {
    renderUi(<LorePage />, { route: '/lore?section=connections' });
    expect(await screen.findByTestId('screen-connections')).toBeInTheDocument();
  });
});
