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
import { fireEvent, render, screen } from '@testing-library/react';
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

// SPRINT_UXR_POLISH_UAT_1113/PU-10 (K2-VIEW-TARGET, допущение А3 «первым — спринт»): у спринта со сроком
// строка несёт вердикт словами, а «Цель к сроку» раскрывает график со сгоранием, планом,
// прогнозом и вертикалью срока. Строка цифр (S4-36) остаётся как есть.
describe('PU-10 · «Цель к сроку» в паспорте спринта', () => {
  // A закрыта 03.11, B открыта: за окно скорость 1 задача / 2 дня → B к ~05.11.
  const body = { task_created_dates: { rows: created }, task_done_dates: { rows: done } };
  it('срок далеко — вердикт «Успеваем» прямо в строке', async () => {
    render(<SprintBurnLine sprintId={SPRINT} deadline="2026-12-31" today="2026-11-03" load={loader(body)} />);
    const v = await screen.findByTestId('sprint-burn-verdict');
    expect(v.textContent).toMatch(/Успеваем/);
    expect(v.getAttribute('data-tone')).toBe('ok');
  });
  it('срок прошёл — вердикт «Не успеваем на N дн.»', async () => {
    render(<SprintBurnLine sprintId={SPRINT} deadline="2026-11-02" today="2026-11-03" load={loader(body)} />);
    const v = await screen.findByTestId('sprint-burn-verdict');
    expect(v.textContent).toMatch(/Не успеваем на \d+ дн\./);
  });
  it('«Цель к сроку» раскрывает график с вертикалью срока и прогнозом', async () => {
    const { container } = render(<SprintBurnLine sprintId={SPRINT} deadline="2026-12-31" today="2026-11-03" load={loader(body)} />);
    const btn = await screen.findByRole('button', { name: /Цель к сроку/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(container.querySelector('[data-series="deadline"]')).toBeTruthy();
    expect(container.querySelector('[data-series="forecast"]')).toBeTruthy();
    // Заголовок графика не повторяет строку: «осталось N из M» уже сказано цифрами выше.
    expect(container.querySelector('.sk-burn__head')).toBeNull();
  });
  it('срока нет — вердикта нет и об этом сказано словами, а не молчанием', async () => {
    render(<SprintBurnLine sprintId={SPRINT} deadline={null} today="2026-11-03" load={loader(body)} />);
    await screen.findByTestId('sprint-burn');
    expect(screen.queryByTestId('sprint-burn-verdict')).toBeNull();
    expect(screen.getByTestId('sprint-burn-no-deadline').textContent).toMatch(/срок/i);
  });
});
