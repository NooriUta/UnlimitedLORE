// @vitest-environment jsdom
// BurnChart headless (SPRINT_UXR_POLISH_UAT_1113/PU-10): хозяин уже сказал сводку и вердикт строкой —
// у графика нет своей шапки (иначе «осталось N из M» дважды), панель открыта, режимы на месте.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BurnChart } from './BurnChart';

const points = [
  { date: '2026-11-01', scope: 2, done: 0, remaining: 2 },
  { date: '2026-11-03', scope: 2, done: 1, remaining: 1 },
];

describe('BurnChart headless', () => {
  it('без шапки, график и вертикаль срока видны сразу', () => {
    const { container } = render(<BurnChart headless state="ok" points={points} deadline="2026-11-10" />);
    expect(container.querySelector('.sk-burn__head')).toBeNull();
    expect(container.querySelector('[data-series="deadline"]')).toBeTruthy();
    expect(container.querySelectorAll('.sk-burn__mode')).toHaveLength(2);
  });
  it('без headless — как раньше: шапка и свёрнутая панель', () => {
    const { container } = render(<BurnChart state="ok" points={points} deadline="2026-11-10" />);
    expect(container.querySelector('.sk-burn__head')).toBeTruthy();
    expect(container.querySelector('[data-series="deadline"]')).toBeNull();
  });
});
