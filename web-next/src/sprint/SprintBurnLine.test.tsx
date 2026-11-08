// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36 — burn-down в паспорте спринта строкой,
// как в v1 (эталон — скрин владелицы: «BURN-DOWN ОСТАТОК 6 ЗАКРЫТО 6
// объём 12 · пик 6»). Ряд и сводку считает kit, здесь — только подключение
// к срезам LORE и честные состояния.
//
// Главное, что закрепляем: неполная история не выдаёт себя за полную.
// График по обрезанной выдаче врёт тише, чем ошибка, поэтому «неполно» —
// отдельное видимое состояние, а не мелкий шрифт.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SprintBurnLine } from './SprintBurnLine';

const SPRINT = 'SPRINT_X';

/** Две строки истории: задача создана 01.11, закрыта 03.11. */
const created = [
  { task_uid: `${SPRINT}/A`, valid_from: '2026-11-01T00:00:00Z' },
  { task_uid: `${SPRINT}/B`, valid_from: '2026-11-01T00:00:00Z' },
];
const done = [{ task_uid: `${SPRINT}/A`, valid_from: '2026-11-03T00:00:00Z' }];

function loader(bodies: Record<string, unknown>) {
  return async (slice: string) => {
    const b = bodies[slice];
    if (b instanceof Error) throw b;
    return b;
  };
}

describe('S4-36 · burn-down строкой в паспорте спринта', () => {
  it('показывает сводку как в v1: объём, закрыто, остаток, пик', async () => {
    render(<SprintBurnLine sprintId={SPRINT} load={loader({ task_created_dates: { rows: created }, task_done_dates: { rows: done } })} />);
    const line = await screen.findByTestId('sprint-burn');
    expect(line.textContent).toMatch(/объём\s*2/i);
    expect(line.textContent).toMatch(/закрыто\s*1/i);
    expect(line.textContent).toMatch(/остаток\s*1/i);
    expect(line.textContent).toMatch(/пик\s*2/i);
  });

  it('обрезанная выдача среза — видимая пометка «неполно», а не тихие цифры', async () => {
    render(
      <SprintBurnLine
        sprintId={SPRINT}
        load={loader({ task_created_dates: { rows: created, truncated: true, limit: 1 }, task_done_dates: { rows: done } })}
      />,
    );
    expect(await screen.findByTestId('sprint-burn-partial')).toBeTruthy();
  });

  it('сбой среза — это ошибка, а не «истории нет»', async () => {
    render(<SprintBurnLine sprintId={SPRINT} load={loader({ task_created_dates: new Error('сеть'), task_done_dates: { rows: [] } })} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('sprint-burn')).toBeNull();
  });

  it('проверенный ноль — честное «истории нет», а не нули в строке', async () => {
    render(<SprintBurnLine sprintId={SPRINT} load={loader({ task_created_dates: { rows: [] }, task_done_dates: { rows: [] } })} />);
    expect(await screen.findByTestId('sprint-burn-empty')).toBeTruthy();
    expect(screen.queryByTestId('sprint-burn')).toBeNull();
  });
});
