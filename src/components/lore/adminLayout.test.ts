import { describe, expect, it } from 'vitest';
import { adminMain, adminShell, adminSide } from './adminLayout';

// Регресс 04.11.2026 (владелец: «админка… have no scroll in mobile version»).
// На узком экране shell переключался с grid на display:block и сохранял
// overflow:hidden; у main стоял overflowY:auto, но высота ничем не была
// ограничена — main рос по контенту, shell его обрезал, прокручивать было нечего.
// Правило: контейнер, режущий overflow, обязан отдавать прокручиваемой области
// ограниченную высоту — колонка flex + у области flex:1 и minHeight:0.
describe('админка: прокрутка на узком экране', () => {
  for (const narrow of [true, false]) {
    const label = narrow ? 'узкий' : 'широкий';

    it(`${label}: shell режет overflow только когда сам раскладывает детей (flex/grid)`, () => {
      const s = adminShell(narrow);
      expect(s.overflow).toBe('hidden');
      expect(['flex', 'grid']).toContain(s.display);
      expect(s.minHeight).toBe(0);
    });

    it(`${label}: main — ограниченная по высоте прокручиваемая область`, () => {
      const m = adminMain;
      expect(m.overflowY).toBe('auto');
      expect(m.minHeight).toBe(0);
      if (adminShell(narrow).display === 'flex') expect(m.flex).toBe(1);
    });
  }

  it('узкий: shell — колонка, навигация не сжимается и не переносится, а листается вбок', () => {
    expect(adminShell(true).flexDirection).toBe('column');
    const nav = adminSide(true);
    expect(nav.flexShrink).toBe(0);
    expect(nav.flexWrap).toBe('nowrap');
    expect(nav.overflowX).toBe('auto');
  });

  it('широкий: прежняя сетка 212px | 1fr не тронута', () => {
    const s = adminShell(false);
    expect(s.display).toBe('grid');
    expect(s.gridTemplateColumns).toBe('212px 1fr');
  });
});
