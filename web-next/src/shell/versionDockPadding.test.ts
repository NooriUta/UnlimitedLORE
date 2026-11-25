// SPRINT_UXR_MOBILE_POLISH/MP2-15-BOTTOM-BAR — «внизу жирный бар» (владелец 25.11.2026, снимок ленты 412 px).
// Корень: место под нижнюю панель резервировалось ДВАЖДЫ — отступом тела оболочки (kit,
// .sk-shell--narrow .sk-shell__body: padding-bottom = --sk-dock-h + полоса жестов) и ещё раз
// отступом метки версии, которая лежит внутри того же тела. Итог — пустая полоса ~100 px над панелью.
// Правило: место под док резервирует только оболочка; метка версии своего отступа под док не берёт.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../App.css'), 'utf8');

describe('метка версии на телефоне — без второго резерва под нижнюю панель (MP2-15)', () => {
  it('правила .v2-version не ссылаются на --sk-dock-h', () => {
    const rules = [...css.matchAll(/\.v2-version\s*\{[^}]*\}/g)].map(m => m[0]);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/--sk-dock-h/);
  });
  it('положительный контроль: у оболочки kit резерв под док есть (иначе низ ушёл бы под панель)', () => {
    const kit = readFileSync(resolve(__dirname, '../../../kit/src/styles/seidr.css'), 'utf8');
    expect(kit).toMatch(/\.sk-shell--narrow \.sk-shell__body\s*\{[^}]*padding-bottom:\s*calc\(var\(--sk-dock-h\)/);
  });
});
