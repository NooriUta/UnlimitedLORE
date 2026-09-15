import { describe, expect, it } from 'vitest';
import { BURN_H } from './sprintBurndown';

// Регресс 15.09.2026 (владелец: «это очень внезапно»): SVG с одним viewBox и
// width=100% масштабировал ВЫСОТУ вместе с шириной панели — на широком экране
// burn-down вырастал до ~400px и выталкивал задачи спринта за экран.
// Высота обязана быть фиксированной и небольшой, свёрнутый вид — спарклайн.
describe('burn-down: высота фиксирована, а не пропорциональна ширине', () => {
  it('свёрнутый — строка-спарклайн не выше 32px', () => {
    expect(BURN_H.collapsed).toBeGreaterThan(0);
    expect(BURN_H.collapsed).toBeLessThanOrEqual(32);
  });
  it('развёрнутый — не выше 140px', () => {
    expect(BURN_H.expanded).toBeGreaterThan(BURN_H.collapsed);
    expect(BURN_H.expanded).toBeLessThanOrEqual(140);
  });
});
