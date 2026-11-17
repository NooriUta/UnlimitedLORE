// SPRINT_UXR_S14_KIT5/K5-LAYOUT-PREFS: настройки раскладки человека — в kit (владелица 16.11: «должно быть
// одинаково и настраиваемо по желанию»). Один источник — атрибуты корня: что применено, то и прочитано
// (правило LORE S4-02). Хранит приложение (у LORE — сервер, у пилота — localStorage); умолчания — тоже его.
import { describe, expect, it } from 'vitest';
import { applyLayoutPrefs, layoutAttrs, readLayoutPrefs } from './layoutPrefs';

const hostOf = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });

describe('readLayoutPrefs', () => {
  it('ничего не выбрано — молчание, а не выдуманный выбор', () => {
    expect(readLayoutPrefs(hostOf({}))).toEqual({ passportPlace: undefined, rightColumn: 'auto', collapseNavOnRead: false, peekHover: true, showTech: false, statusConfirm: false, graphView: undefined });
  });
  it('выбор человека читается из атрибутов; мусор — как невыбранное', () => {
    const p = readLayoutPrefs(hostOf({ 'data-passport-place': 'bottom', 'data-right-column': 'closed', 'data-read-nav': 'collapse', 'data-peek-hover': 'off', 'data-show-tech': 'on', 'data-status-confirm': 'on', 'data-graph-view': 'sectors' }));
    expect(p).toMatchObject({ passportPlace: 'bottom', rightColumn: 'closed', collapseNavOnRead: true, peekHover: false, showTech: true, statusConfirm: true, graphView: undefined });
  });
  it('умолчания приложения — только там, где человек не выбирал', () => {
    const p = readLayoutPrefs(hostOf({ 'data-graph-view': 'force' }), { passportPlace: 'right', graphView: 'obsidian', collapseNavOnRead: true });
    expect(p.passportPlace).toBe('right');
    expect(p.graphView).toBe('force');
    expect(p.collapseNavOnRead).toBe(true);
  });
});

describe('layoutAttrs / applyLayoutPrefs', () => {
  it('туда и обратно: что применено, то и прочитано', () => {
    const attrs: Record<string, string> = {};
    const target = { setAttribute: (n: string, v: string) => { attrs[n] = v; }, removeAttribute: (n: string) => { delete attrs[n]; } };
    applyLayoutPrefs(target, { passportPlace: 'full', rightColumn: 'open', collapseNavOnRead: true, peekHover: false, showTech: true, statusConfirm: true, graphView: 'structure' });
    expect(readLayoutPrefs(hostOf(attrs))).toEqual({ passportPlace: 'full', rightColumn: 'open', collapseNavOnRead: true, peekHover: false, showTech: true, statusConfirm: true, graphView: 'structure' });
  });
  it('невыбранное снимает атрибут, а не пишет «auto»; явный выбор пишется явно', () => {
    expect(layoutAttrs({ rightColumn: 'auto' })).toMatchObject({ 'data-right-column': null, 'data-peek-hover': null, 'data-read-nav': null });
    expect(layoutAttrs({ collapseNavOnRead: false })).toMatchObject({ 'data-read-nav': 'keep' });
  });
  it('выбрал «не сворачивать» при умолчании приложения «сворачивать» — выбор главнее', () => {
    const attrs: Record<string, string> = {};
    applyLayoutPrefs({ setAttribute: (n, v) => { attrs[n] = v; }, removeAttribute: n => { delete attrs[n]; } }, { collapseNavOnRead: false });
    expect(readLayoutPrefs(hostOf(attrs), { collapseNavOnRead: true }).collapseNavOnRead).toBe(false);
  });
});
