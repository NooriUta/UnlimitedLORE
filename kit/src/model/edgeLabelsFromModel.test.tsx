// @vitest-environment jsdom
// Подписи связи в обе стороны — из документа модели (SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS).
//
// Из замечаний пилота «Дата-странники» к методике: у связи нужна подпись в обе стороны
// («требует» и «нужна для»), иначе вкладка входящих подписана тем же словом. Методика §7.3.2.
//
// Решение владелицы 20.11.2026 (вариант «а»): у связи в модели есть `inverse_label` — подпись,
// которой связь называется с ДРУГОГО конца (`types[].relations[].inverse_label`). Запасной путь —
// подпись той же связи у типа на другом конце (`dir` с обратной стороны). Нет обратной нигде —
// kit говорит это словами: «входящая: <подпись>», а не молча то же слово (шаг 4 задачи).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { RecordLinks } from '../record/RecordLinks';
import { edgeLabelsFromModel } from './edgeLabelsFromModel';
import { configFromModel } from './configFromModel';
import type { LoreModelDoc } from './loadModel';

const model = (types: Record<string, unknown>): LoreModelDoc => ({
  format: 'x', version: '1', partial: false, missing: [], statusesKnown: [],
  statuses: {}, dictionaries: {}, types, surfaces: {},
} as unknown as LoreModelDoc);

const DOC = model({
  topic: { label: 'Тема', fields: [], relations: [
    { key: 'requires', label: 'Требует', rel: 'REQUIRES', dir: 'out', relation: 'association', place: 'link_tab' },
    { key: 'neededBy', label: 'Нужна для', rel: 'REQUIRES', dir: 'in', relation: 'association', place: 'prop' },
    { key: 'trails', label: 'На тропах', rel: 'ON_TRAIL', dir: 'out', relation: 'aggregation', place: 'part' },
    { key: 'quiz', label: 'Квиз руны', inverse_label: 'Квизы темы', rel: 'QUIZ_OF', dir: 'out', relation: 'association', place: 'link_tab' },
  ] },
});

describe('edgeLabelsFromModel · пара подписей связи', () => {
  it('прямая и обратная подпись — с двух сторон связи, на любом месте показа', () => {
    const r = edgeLabelsFromModel(DOC);
    expect(r.labels.REQUIRES).toEqual({ out: 'Требует', in: 'Нужна для' });
    expect(r.labels.ON_TRAIL).toEqual({ out: 'На тропах' });
  });

  it('inverse_label связи — обратная подпись (решение владелицы 20.11, вариант «а»)', () => {
    expect(edgeLabelsFromModel(DOC).labels.QUIZ_OF).toEqual({ out: 'Квиз руны', in: 'Квизы темы' });
  });

  it('нет обратной подписи — названо словами', () => {
    const r = edgeLabelsFromModel(DOC);
    expect(r.notes.join(' ')).toMatch(/ON_TRAIL/);
    expect(r.notes.join(' ')).not.toMatch(/REQUIRES/);
  });

  it('configFromModel отдаёт ту же пару — приложение не собирает подписи само', () => {
    const c = configFromModel(DOC, { statusDict: 'none' });
    expect(c.edgeLabels.REQUIRES).toEqual({ out: 'Требует', in: 'Нужна для' });
    expect(c.notes.edges.join(' ')).toMatch(/ON_TRAIL/);
  });
});

const ctx = (edgeLabels?: KitCtx['config']['edgeLabels'], edges?: KitCtx['config']['edges']): KitCtx => ({
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    ...(edgeLabels ? { edgeLabels } : {}), ...(edges ? { edges } : {}),
    kinds: { topic: { title: 'Тема', icon: 'scroll-unfurled' } },
  },
  data: {
    records: [
      { id: 'T-1', kind: 'topic', title: 'Первая', status: '', fields: {} },
      { id: 'T-2', kind: 'topic', title: 'Вторая', status: '', fields: {} },
      { id: 'T-3', kind: 'topic', title: 'Третья', status: '', fields: {} },
    ],
    // T-1 требует T-2, а T-3 требует T-1: у T-1 одна и та же связь в обе стороны.
    edges: [{ from: 'T-1', to: 'T-2', type: 'REQUIRES' }, { from: 'T-3', to: 'T-1', type: 'REQUIRES' }, { from: 'T-3', to: 'T-1', type: 'ON_TRAIL' }],
    journal: [], meta: { generated_at: '' },
  },
  href: id => '#' + id, esc: s => s, md: s => s,
});
const groups = () => [...document.querySelectorAll('[data-testid="kit-link-group"]')]
  .map(g => `${g.getAttribute('data-dir')}:${g.getAttribute('aria-label')}`);

describe('вкладка «Связи» · подпись по стороне', () => {
  it('исходящие и входящие одной связи — разными группами, каждая своим словом', () => {
    const c = ctx(edgeLabelsFromModel(DOC).labels);
    render(<KitLangProvider lang="ru"><RecordLinks record={c.data.records[0]} ctx={c} lang="ru" /></KitLangProvider>);
    expect(groups()).toContain('out:Требует');
    expect(groups()).toContain('in:Нужна для');
  });

  it('обратной подписи нет — словами «входящая: <подпись>», а не молча то же слово', () => {
    const c = ctx(edgeLabelsFromModel(DOC).labels);
    render(<KitLangProvider lang="ru"><RecordLinks record={c.data.records[0]} ctx={c} lang="ru" /></KitLangProvider>);
    const g = document.querySelector('[data-testid="kit-link-group"][data-type="ON_TRAIL"]')!;
    expect(g.getAttribute('aria-label')).toBe('входящая: На тропах');
  });

  it('у config.edges есть labelIn — входящие подписаны им (подписи приложения главнее)', () => {
    const c = ctx(undefined, { REQUIRES: { label: 'Зависит от', labelIn: 'Блокирует', color: 'var(--acc)' } });
    render(<KitLangProvider lang="ru"><RecordLinks record={c.data.records[0]} ctx={c} lang="ru" /></KitLangProvider>);
    expect(groups()).toContain('out:Зависит от');
    expect(groups()).toContain('in:Блокирует');
  });

  it('положительный контроль: прямая подпись без оговорки', () => {
    const c = ctx(edgeLabelsFromModel(DOC).labels);
    render(<KitLangProvider lang="ru"><RecordLinks record={c.data.records[0]} ctx={c} lang="ru" /></KitLangProvider>);
    const g = document.querySelector('[data-testid="kit-link-group"][data-type="REQUIRES"][data-dir="out"]')!;
    expect(g.getAttribute('aria-label')).toBe('Требует');
    expect(screen.getAllByText('REQUIRES').length).toBeGreaterThan(0);
  });
});
