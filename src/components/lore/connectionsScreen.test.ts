import { describe, expect, it } from 'vitest';
import ru from '../../i18n/locales/ru/common.json';
import en from '../../i18n/locales/en/common.json';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-10 (хвосты) · «Подключения» описывают живой канал.
 *
 * Вкладка учила подключать mobilepoc-channel, выключенный 23.08.2026: команда
 * setx с его секретом, путь D:/Mobilepoc/channel, блок в .mcp.json проекта.
 * Единственный канал — minilore-link (user-скоуп MCP, C:/Mobilepoc/v2/link,
 * роутер 127.0.0.1:8789). Секретов на странице нет.
 */
const raw = import.meta.glob('./LoreConnectionsScreen.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const screen = Object.values(raw)[0] ?? '';
const texts = [screen, JSON.stringify((ru as any).lore.connections), JSON.stringify((en as any).lore.connections)];

describe('Подключения — minilore-link, без выключенного канала', () => {
  it('исходник найден', () => { expect(screen.length).toBeGreaterThan(1000); });

  for (const [i, s] of texts.entries()) {
    it(`нет следов mobilepoc-channel (${['tsx', 'ru', 'en'][i]})`, () => {
      expect(s).not.toMatch(/mobilepoc-channel/i);
      expect(s).not.toContain('D:/Mobilepoc/channel');
      expect(s).not.toContain('MOBILEPOC_CHANNEL_SECRET');
      expect(s).not.toMatch(/\bsetx\b/);
    });
  }

  it('рецепт minilore-link: user-скоуп, путь v2/link, роутер 8789, attach по sessionId', () => {
    expect(screen).toContain('"minilore-link"');
    expect(screen).toContain('C:/Mobilepoc/v2/link/dist/mcp-server.js');
    expect(screen).toContain('http://127.0.0.1:8789');
    expect(screen).toContain('server:minilore-link --resume <sessionId>');
  });

  it('секрет не вписан — только отсылка к настройкам канала (ru и en)', () => {
    expect(JSON.stringify((ru as any).lore.connections)).toContain('задаётся в настройках канала');
    expect(JSON.stringify((en as any).lore.connections)).toContain('set in the channel settings');
  });
});
