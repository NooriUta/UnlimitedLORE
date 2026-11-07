// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-08 — собранный бандл (не исходники) реально
// монтируется: React внутри, иконки kit внутри, запись и честные состояния
// рисуются. Ловит «исходники зелёные, а dist сломан/устарел».
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// path через node, а не new URL(…, import.meta.url): в jsdom vite переписывает его как ассет.
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'seidr-kit.js');

describe('K-08 · kit/dist/seidr-kit.js монтируется в DOM', () => {
  it('SeidrKit.mount рисует записи из конфига и данных', async () => {
    expect(existsSync(FILE)).toBe(true);
    const mod = await import(/* @vite-ignore */ FILE);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = mod.SeidrKit.mount(el, {
      modules: [{ id: 'method', title: 'Методология', icon: 'scroll-unfurled' }],
      menu: { groups: [] },
      kinds: { Quiz: { title: 'Квизы', icon: 'rune-stone', overview: (r: { fields: { q: string } }) => `Вопрос: ${r.fields.q}` } },
      statuses: { items: [{ code: 'ok', title: 'согласовано', category: 'done', icon: 'check-mark', color: '--suc' }] },
    }, {
      records: [{ id: 'q1', kind: 'Quiz', title: 'Квиз о рунах', status: 'ok', fields: { q: 'ᚠ?' } }],
      edges: [], journal: [], meta: { generated_at: '2026-11-07', errors: [{ block: 'quality', reason: 'таймаут' }] },
    });
    for (let i = 0; i < 50 && !el.querySelector('[data-kit-mount]'); i++) await new Promise(r => setTimeout(r, 20));
    expect(el.querySelector('[data-kit-mount]')?.getAttribute('data-kit-version')).toBe(mod.SEIDR_KIT_VERSION);
    expect(el.textContent).toContain('Квиз о рунах');
    expect(el.textContent).toContain('Вопрос: ᚠ?');
    expect(el.querySelector('[data-kit-meta-error="quality"]')?.textContent).toContain('таймаут');
    // Свои иконки kit (состояния) — во встроенном подмножестве, не заглушки.
    // Иконки конфига приложение даёт само — без них честная заглушка data-missing.
    const missing = [...el.querySelectorAll('[data-missing]')].map(n => n.getAttribute('data-missing')).sort();
    expect(missing).toEqual(['rune-stone', 'scroll-unfurled']);
    handle.unmount();
    expect(el.innerHTML).toBe('');
  }, 60000);

  it('иконки конфига — опцией icons: заглушек не остаётся', async () => {
    const mod = await import(/* @vite-ignore */ FILE);
    const all = (await import('@iconify-json/game-icons/icons.json')).default as { prefix: string; icons: Record<string, unknown>; width?: number; height?: number };
    const icons = { prefix: all.prefix, width: all.width, height: all.height, icons: { 'rune-stone': all.icons['rune-stone'], 'scroll-unfurled': all.icons['scroll-unfurled'] } };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = mod.SeidrKit.mount(el, {
      modules: [{ id: 'method', title: 'Методология', icon: 'scroll-unfurled' }],
      menu: { groups: [] },
      kinds: { Quiz: { title: 'Квизы', icon: 'rune-stone' } },
      statuses: { items: [] },
    }, { records: [{ id: 'q1', kind: 'Quiz', title: 'Квиз', status: 'x', fields: {} }], edges: [], journal: [], meta: { generated_at: 'x' } }, { icons });
    for (let i = 0; i < 50 && !el.querySelector('[data-kit-mount]'); i++) await new Promise(r => setTimeout(r, 20));
    expect(el.querySelector('[data-kit-mount]')).not.toBeNull();
    expect(el.querySelectorAll('[data-missing]').length).toBe(0);
    handle.unmount();
  }, 60000);
});
