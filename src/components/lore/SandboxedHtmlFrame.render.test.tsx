import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test/render';
import SandboxedHtmlFrame from './SandboxedHtmlFrame';

// Инвариант: HTML из доков — только в песочнице без same-origin и с CSP.
describe('SandboxedHtmlFrame (render)', () => {
  it('iframe в песочнице allow-scripts без allow-same-origin, CSP default-src none, тело внутри srcDoc', () => {
    const { container } = renderUi(<SandboxedHtmlFrame html="<p>тело дока</p>" title="Док <x>" />);
    const frame = container.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame).toHaveAttribute('title', 'Док <x>');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<p>тело дока</p>');
    expect(doc).toContain('<title>Док &lt;x></title>');
  });
});
