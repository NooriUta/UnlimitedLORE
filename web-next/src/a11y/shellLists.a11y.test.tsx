// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-12 — доступность оболочки и списков v2.
//
// Шаг «a11y» фронтового CI (frontend-ci, job web-next) гоняет весь каталог
// src/a11y/ вместе с витриной /kit: экран списка, добавленный в v2, кладёт
// сюда свой *.a11y.test.tsx и попадает под тот же гейт без правки workflow.
//
// Что здесь проверяется (то, что jsdom честно умеет):
//   • axe — роли, имена, ARIA, вложенность интерактива — у оболочки (широкой и
//     узкой с открытым меню) и у списков kit во всех видах (список, группы,
//     доска, дерево), на ru и en;
//   • skip link — первая цель Tab, ведёт к <main>, <main> принимает фокус;
//   • цели касания — у КАЖДОГО интерактивного элемента оболочки и списков есть
//     правило seidr.css с высотой от var(--tap) (44px на сенсоре и узком экране).
// Контраст WCAG AA в обеих темах axe в jsdom не считает — его гейт стоит на
// токенах (kit/src/styles/contrast.test.ts, шаг «Seiðr-kit (kit)»).
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import axe from 'axe-core';
import gameIcons from '@iconify-json/game-icons/icons.json';
import {
  KitLangProvider, KitShell, ListView, TreeView, createSafeStorage, registerGameIcons,
} from '@seidr/kit';
import type { KitLang } from '@seidr/kit';
import { loreConfig, loreData } from '@seidr/kit/demo/lore';

// axe пробует canvas (иконки/шрифты) — в jsdom его нет; без заглушки лог
// засыпан «Not implemented: getContext», а проверка от этого не зависит.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const require = createRequire(import.meta.url);
const seidrCss = readFileSync(require.resolve('@seidr/kit/styles/seidr.css'), 'utf8');

async function axeViolations(root: Element): Promise<string[]> {
  const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return res.violations.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.html).join(' | ')})`);
}

const memWin = () => ({
  location: { pathname: '/', search: '', hash: '' },
  history: { pushState: () => {}, replaceState: () => {} },
});

type ListMode = 'list' | 'grouped' | 'board' | 'tree';

function Lists({ mode }: { mode: ListMode }) {
  if (mode === 'tree') return <TreeView config={loreConfig} data={loreData} href={id => `#${id}`} />;
  const initial = mode === 'board' ? { view: 'board' as const } : mode === 'grouped' ? { group: 'status' } : {};
  return <ListView config={loreConfig} data={loreData} urlState={false} initial={initial} href={id => `#${id}`} />;
}

function screenOf(lang: KitLang, mode: ListMode, narrow = false): ReactElement {
  return (
    <KitLangProvider lang={lang}>
      <KitShell
        config={loreConfig}
        data={loreData}
        brand="LORE"
        storage={createSafeStorage(() => null)}
        storageKey="a11y"
        win={memWin()}
        narrow={narrow}
      >
        <Lists mode={mode} />
      </KitShell>
    </KitLangProvider>
  );
}

const MODES: ListMode[] = ['list', 'grouped', 'board', 'tree'];
const LANGS: KitLang[] = ['ru', 'en'];

describe('S4-12 · axe: оболочка и списки', () => {
  for (const lang of LANGS) for (const mode of MODES) {
    it(`${lang} · ${mode}`, async () => {
      const { container } = render(screenOf(lang, mode));
      expect(container.querySelector('.sk-shell')).toBeTruthy();
      expect(await axeViolations(container)).toEqual([]);
    });
  }

  for (const lang of LANGS) {
    it(`${lang} · узкий экран, меню открыто (drawer)`, async () => {
      render(screenOf(lang, 'list', true));
      fireEvent.click(screen.getByRole('button', { name: lang === 'ru' ? /меню/i : /menu/i }));
      await act(async () => {});
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      expect(await axeViolations(document.body)).toEqual([]);
    });
  }
});

describe('S4-12 · skip link «к содержимому»', () => {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

  for (const lang of LANGS) {
    it(`${lang}: первая цель Tab, ведёт к <main>, <main> принимает фокус`, () => {
      const { container } = render(screenOf(lang, 'list'));
      const first = container.querySelector<HTMLElement>(FOCUSABLE)!;
      expect(first.className).toContain('sk-shell__skip');
      expect(first.textContent?.trim()).not.toBe('');
      const target = first.getAttribute('href')!;
      expect(target).toMatch(/^#./);
      const main = document.getElementById(target.slice(1))!;
      expect(main?.tagName).toBe('MAIN');
      expect(main.tabIndex).toBe(-1);
      expect(main.contains(container.querySelector('.sk-list, .sk-tree'))).toBe(true);
    });
  }

  it('спрятана за краем, но видна при фокусе (а не display:none — иначе Tab её не найдёт)', () => {
    const rule = (sel: string) => cssRules().find(r => r.selectors.includes(sel))?.body ?? '';
    expect(rule('.sk-shell__skip')).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(rule('.sk-shell__skip:focus') || rule('.sk-shell__skip:focus-visible')).toMatch(/left:\s*\d/);
  });
});

// ── цели касания ────────────────────────────────────────────────────────────

interface CssRule { selectors: string[]; body: string }

let parsed: CssRule[] | null = null;
function cssRules(): CssRule[] {
  if (parsed) return parsed;
  const clean = seidrCss.replace(/\/\*[\s\S]*?\*\//g, '');
  parsed = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
    body: m[2],
  }));
  return parsed;
}

/** Высота цели берёт var(--tap): min-height/height с --tap внутри. */
const TAP = /(?:^|[\s;])(?:min-)?height\s*:[^;]*var\(--tap\)/;

/** Селектор без псевдоклассов (:hover, :focus-visible, ::before) — чтобы матчить узел в покое. */
function bare(sel: string): string {
  return sel.replace(/::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?/g, '').trim();
}

function hasTapRule(el: Element): boolean {
  for (const r of cssRules()) {
    if (!TAP.test(r.body)) continue;
    for (const s of r.selectors) {
      const b = bare(s);
      if (!b || b.startsWith('@')) continue;
      try {
        if (el.matches(b)) return true;
      } catch { /* не селектор узла (ключевой кадр, @-правило) — пропускаем */ }
    }
  }
  return false;
}

const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="tab"]', '[role="option"]', '[role="menuitem"]', '[tabindex="0"]',
].join(', ');

function describeEl(el: Element): string {
  const cls = el.getAttribute('class') ?? '';
  const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '';
  return `<${el.tagName.toLowerCase()} class="${cls}"> «${name}»`;
}

function smallTargets(root: ParentNode): string[] {
  const out = new Set<string>();
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    // Чекбокс/радио внутри <label> — цель вся подпись (она и кликабельна).
    const label = el.matches('input') ? el.closest('label') : null;
    if (hasTapRule(el) || (label && hasTapRule(label))) continue;
    out.add(describeEl(el));
  }
  return [...out];
}

describe('S4-12 · цели касания ≥ 44px (var(--tap)) у оболочки и списков', () => {
  it('разбор CSS не слепой: правило IconButton с --tap находится', () => {
    const btn = document.createElement('button');
    btn.className = 'sk-iconbtn';
    expect(hasTapRule(btn)).toBe(true);
    const plain = document.createElement('button');
    plain.className = 'no-such-class';
    expect(hasTapRule(plain)).toBe(false);
  });

  for (const mode of MODES) {
    it(`широкий экран · ${mode}`, () => {
      const { container } = render(screenOf('ru', mode));
      expect(container.querySelectorAll(INTERACTIVE).length).toBeGreaterThan(5);
      expect(smallTargets(container)).toEqual([]);
    });
  }

  it('узкий экран · меню открыто', async () => {
    render(screenOf('ru', 'list', true));
    fireEvent.click(screen.getByRole('button', { name: /меню/i }));
    await act(async () => {});
    expect(smallTargets(document.body)).toEqual([]);
  });
});
