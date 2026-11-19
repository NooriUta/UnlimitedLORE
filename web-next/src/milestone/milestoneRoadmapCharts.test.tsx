// @vitest-environment jsdom
// K4-CHARTS, владелица 19.11.2026: «можно и на дорожную карту». Отдельного экрана «дорожная карта» в v2 нет —
// вехи живут в разделе «Вехи». Графики вехи (Velocity и Burnup по спринтам вехи) стоят:
//   • на телефоне и в списке — под вехой, раскрытием строки (nested.render экрана milestones);
//   • на компьютере при выборе вехи — в боковой панели (паспорт, ListPassport — тест MilestoneSprintCharts).
// Тест до кода: раскрытие строки вехи рисует и строку сгорания (PU-27), и блок графиков вехи.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { LIST_SCREENS } from '../lists/screens';

describe('раздел «Вехи»: графики вехи в раскрытии строки', () => {
  it('раскрытие вехи — сгорание и графики спринтов вехи', () => {
    const nested = LIST_SCREENS.milestones.nested!;
    const node = nested.render('M1');
    const { container } = render(<KitLangProvider lang="ru">{node}</KitLangProvider>);
    expect(container.querySelector('[data-testid="milestone-charts"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="kit-chart"]').length).toBe(2);
  });
});
