// @vitest-environment jsdom
// Баннер-вердикт, сетка-дашборд, полоски «мин–макс» (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай», пункт 5).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashCell, DashGrid, RangeBars, VerdictBanner, rangeGeometry } from '.';

describe('VerdictBanner', () => {
  it('одна фраза и подробность; тон — классом (вид в CSS), для чтения — role=status', () => {
    const { container } = render(<VerdictBanner tone="warn" headline="Не все узлы на связи" detail="0 из 3 · все источники ответили" />);
    expect(screen.getByRole('status').textContent).toContain('Не все узлы на связи');
    expect(container.firstElementChild!.className).toMatch(/is-warn/);
  });
});

describe('DashGrid / DashCell', () => {
  it('ячейка занимает span колонок и rows строк — асимметричная раскладка', () => {
    const { container } = render(<DashGrid><DashCell span={2} rows={2}>план</DashCell><DashCell>погода</DashCell></DashGrid>);
    const cell = container.querySelector('.sk-dash__cell') as HTMLElement;
    expect(cell.style.gridColumn).toBe('span 2');
    expect(cell.style.gridRow).toBe('span 2');
    expect(screen.getByText('погода')).toBeTruthy();
  });
  it('ячейка с заголовком — подпись капсом над содержимым', () => {
    render(<DashGrid><DashCell title="Неделя">x</DashCell></DashGrid>);
    expect(screen.getByText('Неделя')).toBeTruthy();
  });
});

describe('DashGrid cols — мозаика как в /app', () => {
  it('cols задаёт число колонок (4 — как «Сейчас» в /app)', () => {
    const { container } = render(<DashGrid cols={4}><DashCell>x</DashCell></DashGrid>);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/sk-dash--cols/);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--dash-cols')).toBe('4');
  });
});

describe('RangeBars — полоски «мин–макс»', () => {
  it('общая шкала по всем дням; полоса — от мин до макс дня', () => {
    const g = rangeGeometry([{ min: 0, max: 10 }, { min: 5, max: 20 }]);
    expect(g.lo).toBe(0); expect(g.hi).toBe(20);
    expect(g.bars[1]).toEqual({ left: 25, width: 75 });
  });
  it('нет дней — словами приложения, а не пустая рамка', () => {
    render(<RangeBars days={[]} empty="прогноза нет" />);
    expect(screen.getByText('прогноза нет')).toBeTruthy();
  });
  it('у дня — подпись, мин, макс и место под картинку приложения', () => {
    render(<RangeBars unit="°" days={[{ label: 'пн', min: -1, max: 3, icon: <i data-testid="ic" /> }]} />);
    expect(screen.getByText('пн')).toBeTruthy();
    expect(screen.getByText('-1°')).toBeTruthy();
    expect(screen.getByText('3°')).toBeTruthy();
    expect(screen.getByTestId('ic')).toBeTruthy();
  });
});
