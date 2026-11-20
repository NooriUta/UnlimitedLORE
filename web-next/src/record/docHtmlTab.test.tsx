// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (часть 2) — вкладка «HTML» в паспорте документа.
// Владелица 20.11.2026: «HTML выведи отдельной вкладкой в паспорт и посмотри рендеринг».
// HTML рисуется только в песочнице (SandboxedHtmlFrame, правило проекта); у дока без HTML вкладки нет.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitRecord } from '@seidr/kit';
import { DOC_HTML_TAB, withDocHtmlTab } from './docHtmlTab';

const config = { kinds: { doc: { label: 'Документ', tabs: [{ key: 'other', title: 'Другое', render: () => 'x' }] } } } as unknown as KitConfig;
const rec = { id: 'DOC-1', kind: 'doc', title: 'Док', status: '', fields: {} } as KitRecord;

describe('вкладка HTML паспорта документа', () => {
  it('есть HTML — вкладка «HTML» первой, прочие вкладки вида на месте', () => {
    const c = withDocHtmlTab(config, 'doc', 'HTML', '<p>привет</p>');
    const tabs = c.kinds.doc.tabs ?? [];
    expect(tabs.map(t => t.key)).toEqual([DOC_HTML_TAB, 'other']);
    expect(tabs[0].title).toBe('HTML');
  });

  it('рендер — только iframe-песочница, без исполнения HTML в странице', () => {
    const c = withDocHtmlTab(config, 'doc', 'HTML', '<p id="in">привет</p><script>window.__x=1</script>');
    const tab = (c.kinds.doc.tabs ?? [])[0];
    const { container } = render(<>{tab.render(rec, {} as never)}</>);
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(container.querySelector('#in')).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it('HTML нет или пусто — конфиг как был, вкладки нет', () => {
    expect(withDocHtmlTab(config, 'doc', 'HTML', null)).toBe(config);
    expect(withDocHtmlTab(config, 'doc', 'HTML', '   ')).toBe(config);
    expect(withDocHtmlTab(config, 'missing', 'HTML', '<p/>')).toBe(config);
  });
});
