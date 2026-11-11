// @vitest-environment jsdom
// Строка состояния во всю ширину внизу окна (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21).
// Владелица 11.11: «внизу статус тулбара нет»; на вопрос «что за строка» — 7а:
// строка состояния во всю ширину внизу окна (свежесть данных, проекты, сеть).
// Граница K-14: что в строке — решает приложение (слот statusBar), kit даёт место.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, registerGameIcons } from '../index';
import type { KitConfig } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: { groups: [{ id: 'g', title: 'Работа', items: [{ id: 'a', title: 'А', icon: 'sprint', view: 'list' }] }] },
  kinds: {}, statuses: { items: [] },
};
const win = () => ({ location: { pathname: '/', search: '', hash: '' }, history: { pushState: () => {}, replaceState: () => {} } });

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('строка состояния оболочки', () => {
  it('приложение передало содержимое — внизу оболочки строка с ним, подписанная', () => {
    render(<KitShell config={CONFIG} win={win()} narrow={false} statusBar={<span>в сети</span>}><p>x</p></KitShell>);
    const bar = screen.getByRole('contentinfo', { name: 'Строка состояния' });
    expect(bar.textContent).toContain('в сети');
    expect(document.querySelector('.sk-shell')?.classList.contains('sk-shell--status')).toBe(true);
  });

  it('без содержимого строки нет; на телефоне нет (там внизу — панель модулей)', () => {
    const { unmount } = render(<KitShell config={CONFIG} win={win()} narrow={false}><p>x</p></KitShell>);
    expect(screen.queryByRole('contentinfo')).toBeNull();
    unmount();
    render(<KitShell config={CONFIG} win={win()} narrow statusBar={<span>в сети</span>}><p>x</p></KitShell>);
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('CSS: строка липнет к низу окна, меню при ней не уходит под неё', () => {
    expect(ruleOf('.sk-shell__status')).toMatch(/position:\s*sticky/);
    expect(ruleOf('.sk-shell__status')).toMatch(/bottom:\s*0/);
    expect(ruleOf('.sk-shell--status .sk-shell__side')).toMatch(/height:\s*calc\(100dvh - var\(--sk-top-h\) - var\(--sk-status-h\)\)/);
  });
});
