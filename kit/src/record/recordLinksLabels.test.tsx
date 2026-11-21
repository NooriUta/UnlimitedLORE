// @vitest-environment jsdom
// Вкладка «Связи»: подпись ребра — словами, а не кодом (SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS).
//
// Пилот «Дата-странников» 15.11 (перепроверка 6a0c66d6): во «Связях» стояли ON_TRAIL и QUIZ_OF,
// хотя подписи связей у видов есть. kit брал подпись только из config.edges. Теперь — по порядку:
// config.edges (главнее: у LORE подписи там выверены) → связь вида записи → связь любого вида → код.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { RecordLinks } from './RecordLinks';

const ctx = (edges?: KitCtx['config']['edges']): KitCtx => ({
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    ...(edges ? { edges } : {}),
    kinds: {
      quiz: { title: 'Квиз', icon: 'checkbox-tree', relations: [{ key: 'trails', label: 'Лежит на тропах', relation: 'aggregation', rel: 'ON_TRAIL', dir: 'out' }] },
      topic: { title: 'Тема', icon: 'scroll-unfurled', relations: [{ key: 'quizzes', label: 'Квизы темы', relation: 'association', rel: 'QUIZ_OF', dir: 'in' }] },
      trail: { title: 'Тропа', icon: 'path-distance' },
    },
  },
  data: {
    records: [
      { id: 'Q-1', kind: 'quiz', title: 'Квиз', status: '', fields: {} },
      { id: 'TR-1', kind: 'trail', title: 'Тропа', status: '', fields: {} },
      { id: 'T-1', kind: 'topic', title: 'Тема', status: '', fields: {} },
    ],
    edges: [{ from: 'Q-1', to: 'TR-1', type: 'ON_TRAIL' }, { from: 'Q-1', to: 'T-1', type: 'QUIZ_OF' }, { from: 'Q-1', to: 'X', type: 'ODD_ONE' }],
    journal: [], meta: { generated_at: '' },
  },
  href: id => '#' + id, esc: s => s, md: s => s,
});

const titles = () => [...document.querySelectorAll('[data-testid="kit-link-group"]')].map(g => g.getAttribute('aria-label'));

describe('RecordLinks · подпись ребра', () => {
  it('нет config.edges — подпись связи вида записи; ребро чужого вида — подпись того вида; неизвестное — кодом', () => {
    const c = ctx();
    render(<KitLangProvider lang="ru"><RecordLinks record={c.data.records[0]} ctx={c} lang="ru" /></KitLangProvider>);
    // QUIZ_OF у квиза исходящая, а подписана только входящая сторона («Квизы темы» у темы) — словами
    // «исходящая: …», а не молча чужое слово (K5-MODEL-NAV-EDGE-LABELS, шаг 4).
    expect(titles()).toEqual(['ODD_ONE', 'Лежит на тропах', 'исходящая: Квизы темы']);
  });

  it('config.edges главнее — подписи LORE не меняются', () => {
    const c = ctx({ ON_TRAIL: { label: 'На тропе', color: 'var(--acc)' } });
    render(<KitLangProvider lang="ru"><RecordLinks record={c.data.records[0]} ctx={c} lang="ru" /></KitLangProvider>);
    expect(titles()).toContain('На тропе');
    expect(screen.getAllByText('ON_TRAIL').length).toBeGreaterThan(0); // код остаётся рядом пилюлей
  });
});
