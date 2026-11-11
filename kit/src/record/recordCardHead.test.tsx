// @vitest-environment jsdom
// Шапка карточки записи — ОДНА на ленту и на Peek (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10,
// D-2026-LORE-PEEK-ONE-CARD; договорённость с kit-сессией 11.11.2026): вид, ID, название,
// при желании статус. Вторая похожая шапка разъехалась бы с первой первой же правкой.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordCardHead } from './RecordCardHead';

describe('RecordCardHead', () => {
  it('вид, ID-пилюля, название — те же классы, что у строки ленты', () => {
    const { container } = render(<RecordCardHead kind="ADR" id="ADR-1" title="Решение о ссылках" />);
    expect(container.querySelector('.sk-feed__head .sk-feed__kind')?.textContent).toBe('ADR');
    expect(container.querySelector('.sk-feed__head')?.textContent).toContain('ADR-1');
    expect(container.querySelector('.sk-feed__title')?.textContent).toBe('Решение о ссылках');
  });
  it('статус — в строке шапки, только если передан (нет статуса — нет пустого места)', () => {
    const { container, rerender } = render(<RecordCardHead kind="ADR" id="ADR-1" title="t" status={<span data-st>ACCEPTED</span>} />);
    expect(container.querySelector('.sk-feed__head [data-st]')?.textContent).toBe('ACCEPTED');
    rerender(<RecordCardHead kind="веха" id="M-1" title="t" />);
    expect(container.querySelector('.sk-card__status')).toBeNull();
  });
  it('лента рисует шапку этим же элементом, а не своей вёрсткой', () => {
    const src = readFileSync(join(process.cwd(), 'src/list/ListView.tsx'), 'utf8');
    expect(src).toContain('<RecordCardHead');
    // строка-провал (feedGapRow) законно рисует свою подпись блока — сторож только про шапку записи
    expect(src).not.toContain(`sk-feed__kind">{labels.valueTitle('kind'`);
  });
});
