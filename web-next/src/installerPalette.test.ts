// Палитра мастера установки/переноса (scripts/model-migration/ui.mjs) — фирменная Amber Forest из kit,
// светлая и тёмная (17.11: «у тебя не наша фирменная … возьми нашу»). Переехало сюда из
// scripts/model-migration/ui.test.mjs (K5-PACKAGE-DELIVERY, 25.11): kit — пакет @seidr/kit, и его CSS-слой
// есть только там, где стоят зависимости web-next; прогон node --test пакета установки идёт без них.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_CSS } from './test/kitPaths';

const block = (css: string, sel: string) => {
  const i = css.indexOf(sel + '{') >= 0 ? css.indexOf(sel + '{') : css.indexOf(sel + ' {');
  return css.slice(i, css.indexOf('}', i));
};
const tok = (txt: string, k: string) => {
  const m = new RegExp('--' + k + ':\\s*(#[0-9a-fA-F]{3,8})').exec(txt);
  return m && m[1].toLowerCase();
};

describe('палитра установщика = фирменная палитра kit', () => {
  it('светлая и тёмная — те же 12 токенов', () => {
    const ui = readFileSync(resolve(__dirname, '../../scripts/model-migration/ui.mjs'), 'utf8');
    const kit = readFileSync(KIT_CSS, 'utf8');
    const kitDark = block(kit, ':root'), kitLight = block(kit, "[data-mode='light']");
    const uiLight = block(ui, ':root'), uiDark = block(ui, '[data-theme=dark]');
    expect(tok(kitDark, 'acc')).toMatch(/^#/); // положительный контроль чтения
    for (const k of ['bg0', 'bg1', 'bg2', 'bd', 't1', 't2', 't3', 'acc', 'suc', 'wrn', 'inf', 'dng']) {
      expect(tok(uiLight, k), 'светлая --' + k).toBe(tok(kitLight, k));
      expect(tok(uiDark, k), 'тёмная --' + k).toBe(tok(kitDark, k));
    }
  });
});
