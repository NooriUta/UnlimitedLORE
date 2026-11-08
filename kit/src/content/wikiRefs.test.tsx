// @vitest-environment jsdom
// Вики-ссылки [[…]] в чтении MD (владелица 08.11): «вики-стиль должен корректно отрабатывать —
// рамочка вокруг, а не явное повторение [[ ]]». Исходник не меняется — только отрисовка.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { marked } from './markdown';
import { sanitizeMd } from './sanitizeHtml';
import { MartProse } from './MartProse';

const html = (md: string) => sanitizeMd(marked.parse(md) as string);

describe('[[…]] — ссылка-рамка, а не скобки', () => {
  it('[[ADR-LORE-015]] — рамка с ID, скобок в тексте нет', () => {
    const h = html('Классы заданы в [[ADR-LORE-015]] и [[SPRINT_X/CO-11]].');
    expect(h).toContain('<span class="sk-wref" data-ref="ADR-LORE-015" title="ADR-LORE-015">ADR-LORE-015</span>');
    expect(h).toContain('data-ref="SPRINT_X/CO-11"');
    expect(h).not.toContain('[[');
  });
  it('с типом: [[task:SPRINT_X/CO-11]] — в рамке ID, тип — в подсказке', () => {
    const h = html('см. [[task:SPRINT_X/CO-11]]');
    expect(h).toContain('data-ref="SPRINT_X/CO-11"');
    expect(h).toContain('data-ref-type="task"');
    expect(h).toContain('>SPRINT_X/CO-11</span>');
  });
  it('внутри кода [[…]] остаётся как есть', () => {
    const h = html('код `[[raw]]` и\n\n```\n[[block]]\n```');
    expect(h).toContain('[[raw]]');
    expect(h).toContain('[[block]]');
    expect(h).not.toContain('data-ref="raw"');
  });
  it('MartProse рисует рамку (класс есть в seidr.css)', () => {
    const { container } = render(<MartProse text="решение — [[D-2026-X]]" />);
    const ref = container.querySelector('.sk-wref');
    expect(ref?.textContent).toBe('D-2026-X');
  });
});
