// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-04 · тело записи — Markdown через рендер чтения
// kit (MartProse + KaTeX из content/markdown.ts), а не своим разбором.
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { MartProse } from '../content';
import { RecordView } from './RecordView';
import type { KitCtx } from '../core/contract';

describe('K-04 · тело записи через MartProse', () => {
  it('MD с таблицей и формулой KaTeX рендерится, HTML санитизирован', () => {
    const ctx: KitCtx = {
      data: { records: [], edges: [], journal: [], meta: { generated_at: 'x' } },
      config: { modules: [], menu: { groups: [] }, kinds: {}, statuses: { items: [] } },
      href: id => `#${id}`,
      esc: s => s,
      md: s => <MartProse text={s} />,
    };
    const { container } = render(
      <RecordView
        record={{ id: 'R', kind: 'Doc', title: 'Doc', status: 'x', fields: {}, body_md: '## Тело\n\n$a^2+b^2$\n\n<script>alert(1)</script>' }}
        ctx={ctx} tab="overview" onTab={() => {}}
      />,
    );
    const prose = container.querySelector('.sk-prose');
    expect(prose?.querySelector('h2')?.textContent).toBe('Тело');
    expect(prose?.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });
});
