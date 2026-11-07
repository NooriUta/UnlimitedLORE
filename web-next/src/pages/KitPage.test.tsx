// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d — витрина /kit: страница web-next,
// собранная ТОЛЬКО из компонентов Seiðr-kit (D-2026-UXR-KIT-REACT). Её axe-прогон
// — гейт a11y фронтового CI (frontend-ci, job web-next, шаг «axe на /kit»):
// любой элемент kit, потерявший имя, роль или ARIA, валит его здесь.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';

// mermaid и bpmn-js в jsdom не рисуют (нет раскладки) — проверяем, что витрина
// отдаёт им фенс, а не их собственную отрисовку.
vi.mock('mermaid', () => ({
  default: {
    registerLayoutLoaders: vi.fn(),
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" role="img" aria-label="diagram"><text>d</text></svg>` })),
  },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class {
    importXML() { return Promise.resolve(); }
    get() { return { zoom: () => {} }; }
    destroy() {}
  },
}));

import KitPage from './KitPage';
import App from '../App';

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

beforeAll(() => {
  registerGameIcons(gameIcons);
});

async function axeViolations(root: Element): Promise<string[]> {
  // Контраст в jsdom не вычисляется (нет раскладки) — его меряет браузерный прогон.
  // iframes:false — внутрь песочницы (sandbox без allow-same-origin) axe не
  // достучится по определению; сам <iframe> (имя title) он проверяет снаружи.
  const res = await axe.run(root, { iframes: false, rules: { 'color-contrast': { enabled: false } } });
  return res.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(' | ')})`);
}

describe('/kit — витрина Seiðr-kit', () => {
  it('разделы: токены, элементы, состояния, оболочки, MD/HTML', async () => {
    render(<KitPage />);
    for (const id of ['tokens', 'elements', 'states', 'shell', 'content']) {
      expect(document.getElementById(`kit-${id}`), id).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Seiðr-kit/);
  });

  it('четыре честных исхода + обрезка различимы на одной странице', () => {
    const { container } = render(<KitPage />);
    for (const s of ['loading', 'empty', 'error', 'forbidden', 'partial']) {
      expect(container.querySelector(`[data-state="${s}"]`), s).toBeTruthy();
    }
  });

  it('MD/HTML из kit: TipTapField (правка), MartProse (чтение + mermaid), SandboxedHtmlFrame', async () => {
    const { container } = render(<KitPage />);
    const content = document.getElementById('kit-content')!;
    await waitFor(() => expect(within(content).getAllByRole('textbox').length).toBeGreaterThan(0));
    expect(content.querySelector('.sk-md__toolbar')).toBeTruthy();
    expect(content.querySelector('.sk-prose table')).toBeTruthy();
    await waitFor(() => expect(content.querySelector('.sk-prose__mermaid svg')).toBeTruthy());
    const frame = container.querySelector('iframe.sk-frame')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('axe: нарушений нет (ru)', async () => {
    const { container } = render(<KitPage />);
    await waitFor(() => expect(container.querySelector('.sk-md__toolbar')).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
  });

  it('axe: нарушений нет (en), подписи витрины переведены', async () => {
    const { container } = render(<KitLangProvider lang="en"><KitPage /></KitLangProvider>);
    await waitFor(() => expect(container.querySelector('.sk-md__toolbar')).toBeTruthy());
    expect(screen.getByRole('heading', { level: 2, name: /Tokens/ })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('маршрут /kit в App (состояние — в URL)', () => {
  it('/kit открывает витрину (отдельным чанком), корень — оболочку v2', async () => {
    const kit = render(<App path="/kit/" />);
    await waitFor(() => expect(kit.container.querySelector('[data-lore-page="kit"]')).toBeTruthy());
    kit.unmount();
    const root = render(<App path="/" />);
    expect(root.container.querySelector('[data-lore-page="kit"]')).toBeNull();
    expect(root.container.querySelector('[data-lore-app="v2"]')).toBeTruthy();
  });
});
