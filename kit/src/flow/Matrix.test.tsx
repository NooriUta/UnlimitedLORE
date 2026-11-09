// @vitest-environment jsdom
// Матрица «ось × ось» с правкой в ячейке (SPRINT_UXR_S10_SEIDR_KIT_2/K2-MATRIX).
//
// Повод — слова владелицы 09.11.2026: «задачи по элементам новым [во] второй
// спринт разделом новым… по админ».
//
// ГЛАВНОЕ ТРЕБОВАНИЕ задачи — состояние у КАЖДОЙ ячейки. Матрица строится по
// внешним системам, где пустая ячейка значит «значения нет» гораздо реже, чем
// «не смогли спросить» или «нет прав посмотреть». Матрица, которая рисует эти
// три случая одинаково пустым квадратом, вреднее отсутствия матрицы: по ней
// раздают доступы, глядя на дырки.
//
// Второе требование, которое легко потерять: матрица НИЧЕГО НЕ ПРИМЕНЯЕТ. Она
// предлагает изменения, они уходят в дифф (K2-DIFF) и применяются пачкой с
// окном отмены (K2-BATCH-UNDO).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Matrix, type MatrixCellState, type MatrixChange } from './Matrix';

const rows = [
  { key: 'r1', title: 'Первый' },
  { key: 'r2', title: 'Второй' },
];
const cols = [
  { key: 'c1', title: 'Колонка один' },
  { key: 'c2', title: 'Колонка два' },
];
const options = [
  { value: 'o1', title: 'Значение один' },
  { value: 'o2', title: 'Значение два' },
];

/** Четыре исхода ячейки — по одному на каждую пару. */
const cells: Record<string, MatrixCellState> = {
  'r1/c1': { state: 'value', value: 'o1' },
  'r1/c2': { state: 'none' },
  'r2/c1': { state: 'unverified', reason: 'источник не ответил' },
  'r2/c2': { state: 'forbidden', reason: 'нужна роль администратора' },
};
const cell = (r: string, c: string): MatrixCellState => cells[`${r}/${c}`] ?? { state: 'none' };

function view(extra: Partial<React.ComponentProps<typeof Matrix>> = {}) {
  return render(
    <Matrix
      rows={rows}
      cols={cols}
      cell={cell}
      options={options}
      labels={{ rows: 'Строки', cols: 'Колонки' }}
      {...extra}
    />,
  );
}

const at = (r: string, c: string) => screen.getByTestId(`kit-matrix-cell-${r}-${c}`);

describe('K2-MATRIX · четыре исхода ячейки различимы', () => {
  it('положительный контроль: сетка нарисована, все четыре ячейки на месте', () => {
    view();
    expect(screen.getAllByTestId(/^kit-matrix-cell-/)).toHaveLength(4);
  });

  it('значение · нет значения · не смогли проверить · нет прав — четыре разных состояния', () => {
    view();
    expect(at('r1', 'c1').getAttribute('data-state')).toBe('value');
    expect(at('r1', 'c2').getAttribute('data-state')).toBe('none');
    expect(at('r2', 'c1').getAttribute('data-state')).toBe('unverified');
    expect(at('r2', 'c2').getAttribute('data-state')).toBe('forbidden');
  });

  it('значение показано подписью из палитры, а не кодом', () => {
    view();
    expect(at('r1', 'c1').textContent).toContain('Значение один');
  });

  it('«не смогли проверить» и «нет прав» несут ПРИЧИНУ, а не выглядят пустыми', () => {
    view();
    expect(at('r2', 'c1').getAttribute('title')).toContain('источник не ответил');
    expect(at('r2', 'c2').getAttribute('title')).toContain('нужна роль администратора');
    // И то же — словами для читающих вслух, а не только во всплывающей подсказке.
    expect(at('r2', 'c1').getAttribute('aria-label')).toContain('источник не ответил');
  });

  it('у непроверенной ячейки и у запретной правка не предлагается', () => {
    view();
    fireEvent.click(at('r2', 'c1'));
    expect(screen.queryByTestId('kit-matrix-menu')).toBeNull();
    fireEvent.click(at('r2', 'c2'));
    expect(screen.queryByTestId('kit-matrix-menu')).toBeNull();
  });
});

describe('K2-MATRIX · правка в ячейке уходит в дифф, а не применяется', () => {
  it('выбор значения отдаёт предложение наружу', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(at('r1', 'c2'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o2'));
    expect(onPropose).toHaveBeenCalledTimes(1);
    const changes: MatrixChange[] = onPropose.mock.calls[0][0];
    expect(changes).toEqual([{ row: 'r1', col: 'c2', value: 'o2', from: { state: 'none' } }]);
  });

  it('в предложении есть ПРЕЖНЕЕ состояние ячейки: по нему дифф и решает, применимо ли', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o2'));
    expect(onPropose.mock.calls[0][0][0].from).toEqual({ state: 'value', value: 'o1' });
  });

  it('«снять значение» — тоже предложение, со значением null', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-clear'));
    expect(onPropose.mock.calls[0][0][0].value).toBeNull();
  });

  it('у ячейки без значения «снять» не предлагается: снимать нечего', () => {
    view({ onPropose: () => {} });
    fireEvent.click(at('r1', 'c2'));
    expect(screen.queryByTestId('kit-matrix-clear')).toBeNull();
  });

  it('Esc закрывает меню ячейки', () => {
    view({ onPropose: () => {} });
    fireEvent.click(at('r1', 'c2'));
    expect(screen.getByTestId('kit-matrix-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('kit-matrix-menu')).toBeNull();
  });

  it('матрица сама ничего не меняет: без onPropose правка не предлагается вовсе', () => {
    view();
    fireEvent.click(at('r1', 'c2'));
    expect(screen.queryByTestId('kit-matrix-menu')).toBeNull();
  });
});

describe('K2-MATRIX · выделение по строке и по колонке', () => {
  it('«задать всей строке» предлагает изменения по всем её проверенным ячейкам', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(screen.getByTestId('kit-matrix-rowset-r1'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o2'));
    const changes: MatrixChange[] = onPropose.mock.calls[0][0];
    expect(changes.map(c => `${c.row}/${c.col}`)).toEqual(['r1/c1', 'r1/c2']);
  });

  it('непроверенные и запретные ячейки в предложение по строке не попадают', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(screen.getByTestId('kit-matrix-rowset-r2'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    expect(onPropose.mock.calls[0][0]).toEqual([]);
  });

  it('и об этом сказано числом: сколько ячеек пропущено и почему', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(screen.getByTestId('kit-matrix-rowset-r2'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    expect(screen.getByTestId('kit-matrix-skipped').textContent).toMatch(/2/);
  });

  it('«задать всей колонке» работает так же', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(screen.getByTestId('kit-matrix-colset-c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o2'));
    const changes: MatrixChange[] = onPropose.mock.calls[0][0];
    expect(changes.map(c => `${c.row}/${c.col}`)).toEqual(['r1/c1']);
  });

  it('значение, которое уже стоит, в предложение всё равно идёт — «уже есть» покажет дифф', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(screen.getByTestId('kit-matrix-rowset-r1'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    const changes: MatrixChange[] = onPropose.mock.calls[0][0];
    expect(changes.find(c => c.col === 'c1')?.from).toEqual({ state: 'value', value: 'o1' });
  });
});

describe('K2-MATRIX · узкий экран: список вместо сетки', () => {
  it('на телефоне сетки нет, а есть выбор строки и список колонок', () => {
    view({ narrow: true, onPropose: () => {} });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('kit-matrix-rowpick')).toBeTruthy();
    expect(screen.getAllByTestId(/^kit-matrix-cell-/)).toHaveLength(2);
  });

  it('выбор другой строки меняет список', () => {
    view({ narrow: true, onPropose: () => {} });
    fireEvent.click(screen.getByTestId('kit-matrix-pick-r2'));
    expect(screen.getByTestId('kit-matrix-cell-r2-c1')).toBeTruthy();
    expect(screen.queryByTestId('kit-matrix-cell-r1-c1')).toBeNull();
  });

  it('четыре исхода ячейки различимы и в узком виде', () => {
    view({ narrow: true, onPropose: () => {} });
    fireEvent.click(screen.getByTestId('kit-matrix-pick-r2'));
    expect(screen.getByTestId('kit-matrix-cell-r2-c1').getAttribute('data-state')).toBe('unverified');
    expect(screen.getByTestId('kit-matrix-cell-r2-c2').getAttribute('data-state')).toBe('forbidden');
  });
});

describe('K2-MATRIX · пусто и граница K-14', () => {
  it('осей нет — сказано словами, а не пустая рамка', () => {
    render(<Matrix rows={[]} cols={cols} cell={cell} options={options} labels={{ rows: 'Строки', cols: 'Колонки' }} />);
    expect(screen.getByTestId('kit-matrix-empty')).toBeTruthy();
  });

  it('в элементе нет предметных имён: что за оси — знает приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/Matrix.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['проект', 'роль', 'keycloak', 'forgejo', 'агент', 'спринт', 'человек', 'люди']) {
      expect(code.toLowerCase(), `в коде матрицы встречается «${word}»`).not.toContain(word);
    }
  });

  it('имена осей приходят от приложения и видны', () => {
    view();
    expect(screen.getByText('Строки')).toBeTruthy();
    expect(screen.getByText('Колонки')).toBeTruthy();
  });
});
