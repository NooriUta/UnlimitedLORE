import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from './App';

describe('LORE v2 — оболочка', () => {
  it('рендерится и называет себя v2, чтобы её нельзя было спутать с v1', () => {
    const html = renderToString(<App />);
    expect(html).toContain('LORE');
    expect(html).toContain('data-lore-app="v2"');
  });

  it('S4-03: в шапке — выбор нескольких проектов', () => {
    const html = renderToString(<App />);
    expect(html).toContain('sk-scope__trigger');
    expect(html).toMatch(/Проекты/);
  });
});
