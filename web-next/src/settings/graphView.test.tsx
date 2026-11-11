// @vitest-environment jsdom
// Вид вкладки «Граф» по умолчанию — личная настройка человека
// (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03; владелица 11.11.2026: «настройкой в
// настройках человека»). Одна правда: настройка сервера → атрибут на корне →
// конфиг паспорта читает применённое (applied.ts), а не своё хранилище.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '../api/contracts/s2';
import { applySettings } from './applySettings';
import { appliedGraphView } from './applied';
import { PersonalSettings } from './PersonalSettings';
import { baseConfig } from '../record/passportAdapters';

const host = () => {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => { attrs.set(n, v); },
    removeAttribute: (n: string) => { attrs.delete(n); },
  };
};

describe('graph_view', () => {
  it('auto — атрибута нет; выбранный вид ложится атрибутом на корень', () => {
    const h = host();
    applySettings(h as never, { ...DEFAULT_SETTINGS, graph_view: 'obsidian' });
    expect(h.getAttribute('data-graph-view')).toBe('obsidian');
    applySettings(h as never, { ...DEFAULT_SETTINGS, graph_view: 'auto' });
    expect(h.getAttribute('data-graph-view')).toBeNull();
  });

  it('применённое переводится в вид kit: секторы → graph, список → links; молчание — не выбирал', () => {
    const at = (v: string | null) => ({ getAttribute: (n: string) => (n === 'data-graph-view' ? v : null) });
    expect(appliedGraphView(at(null))).toBeUndefined();
    expect(appliedGraphView(at('sectors'))).toBe('graph');
    expect(appliedGraphView(at('list'))).toBe('links');
    expect(appliedGraphView(at('force'))).toBe('force');
    expect(appliedGraphView(at('obsidian'))).toBe('obsidian');
    expect(appliedGraphView(at('мусор'))).toBeUndefined();
  });

  it('конфиг паспорта несёт выбранный вид в config.graph.view', () => {
    document.documentElement.setAttribute('data-graph-view', 'force');
    try {
      expect(baseConfig('ru', {}).graph?.view).toBe('force');
    } finally {
      document.documentElement.removeAttribute('data-graph-view');
    }
    expect(baseConfig('ru', {}).graph?.view).toBeUndefined();
  });

  it('в панели настроек есть строка «Вид графа» с пятью вариантами', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    render(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    expect(screen.getAllByText('Вид графа').length).toBeGreaterThan(0);
    for (const label of ['Как удобнее экрану', 'Секторы', 'Список', 'Force', 'Обсидиан']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });
});
