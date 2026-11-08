// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG — ось категорий статуса.
//
// Решение владелицы D-2026-UXR-STATUS-AXIS: ось одна, шесть значений —
// not_started, in_progress, in_force, finished, withdrawn, unknown. Бэкенд
// отдаёт её в статусной статье (D-2026-LORE-MODEL-STATUS-ENTRIES), и сужать
// её в kit нельзя.
//
// Почему это важнее, чем кажется: в прежней оси kit не было «действует».
// Принятый ADR схлопывался в «завершено» — а «принято и действует» и
// «сделано и закрыто» разные вещи: по первому живут, второе лежит в архиве.
import { describe, expect, it } from 'vitest';
import { LORE_STATUS_AXIS, isAxisCategory, normalizeAxisCategory } from './statusAxis';

describe('S4-STATUS-AXIS-CONFIG · ось из шести значений', () => {
  it('ось перечислена целиком и в порядке жизненного цикла', () => {
    expect([...LORE_STATUS_AXIS]).toEqual([
      'not_started', 'in_progress', 'in_force', 'finished', 'withdrawn', 'unknown',
    ]);
  });

  it('значения оси проходят как есть', () => {
    for (const c of LORE_STATUS_AXIS) expect(normalizeAxisCategory(c)).toBe(c);
    expect(isAxisCategory('in_force')).toBe(true);
  });

  it('прежние четыре значения kit приводятся к оси — старые конфиги не ломаются', () => {
    expect(normalizeAxisCategory('todo')).toBe('not_started');
    expect(normalizeAxisCategory('active')).toBe('in_progress');
    expect(normalizeAxisCategory('done')).toBe('finished');
    expect(normalizeAxisCategory('cancelled')).toBe('withdrawn');
  });

  it('«действует» ниоткуда не выводится: его можно только прислать', () => {
    // Ни одно старое значение не превращается в in_force — иначе мы бы
    // выдумали смысл, которого в старых данных не было.
    const fromOld = ['todo', 'active', 'done', 'cancelled'].map(normalizeAxisCategory);
    expect(fromOld).not.toContain('in_force');
  });

  it('незнакомое значение — unknown, а не тихо «завершено»', () => {
    expect(normalizeAxisCategory('что-то новое')).toBe('unknown');
    expect(normalizeAxisCategory(undefined)).toBe('unknown');
    expect(normalizeAxisCategory('')).toBe('unknown');
    expect(isAxisCategory('что-то новое')).toBe(false);
  });

  it('регистр и пробелы не мешают: сервер может прислать IN_FORCE', () => {
    expect(normalizeAxisCategory(' IN_FORCE ')).toBe('in_force');
  });
});

describe('S4-STATUS-AXIS-CONFIG · что считается закрытым', () => {
  it('закрытые — завершено и отозвано; «действует» к ним не относится', async () => {
    const { isClosedCategory } = await import('./statusAxis');
    expect(isClosedCategory('finished')).toBe(true);
    expect(isClosedCategory('withdrawn')).toBe(true);
    expect(isClosedCategory('in_force')).toBe(false);
    expect(isClosedCategory('in_progress')).toBe(false);
    expect(isClosedCategory('not_started')).toBe(false);
    expect(isClosedCategory('unknown')).toBe(false);
  });
});
