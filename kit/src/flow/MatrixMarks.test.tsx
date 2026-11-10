// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT_2/K2-MATRIX — выбор НЕСКОЛЬКИХ ячеек матрицы.
//
// Повод — запрос сессии администрирования LORE 10.11.2026: правят набор
// ячеек, который не совпадает ни со строкой, ни с колонкой («этим трём — так,
// а четвёртой — нет»). «Задать всей строке» тут задело бы лишнее, а по одной
// ячейке — это столько предложений, сколько ячеек, и пачка (K2-BATCH-UNDO)
// теряет смысл: отменять пришлось бы по одной.
//
// Правила у набора ТЕ ЖЕ, что у строки и колонки, и именно они здесь
// проверяются:
//   · матрица НИЧЕГО не применяет — уходит предложение с ПРЕЖНИМ состоянием
//     каждой ячейки (`from`), по нему дифф решает «добавится / снимется / уже
//     есть / нельзя, пока не проверено»;
//   · непроверенные, запретные и неспрошенные в предложение не попадают и
//     названы ЧИСЛОМ — предложить изменение там, где текущее состояние
//     неизвестно, значит раздать доступы наугад;
//   · нет onPropose — выбора нет вовсе: кнопка, которая ничего не делает,
//     хуже её отсутствия.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { axeViolations } from '../test/axe';
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

/** Все пять исходов ячейки в одной сетке: выбор обязан считаться по каждому. */
const cells: Record<string, MatrixCellState> = {
  'r1/c1': { state: 'value', value: 'o1' },
  'r1/c2': { state: 'none' },
  'r2/c1': { state: 'unverified', reason: 'источник не ответил' },
  'r2/c2': { state: 'forbidden', reason: 'нужна роль администратора' },
};
const cell = (r: string, c: string): MatrixCellState => cells[`${r}/${c}`] ?? { state: 'unasked' };

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
const mode = () => screen.getByTestId('kit-matrix-markmode');
const count = () => screen.getByTestId('kit-matrix-marked');

describe('K2-MATRIX · выбор нескольких ячеек — есть только там, где есть предложение', () => {
  it('без onPropose выбор не предлагается ВОВСЕ: ни кнопки режима, ни отметок', () => {
    view();
    expect(screen.queryByTestId('kit-matrix-markmode')).toBeNull();
    fireEvent.click(at('r1', 'c1'), { ctrlKey: true });
    expect(screen.queryByTestId('kit-matrix-marked')).toBeNull();
    expect(at('r1', 'c1').getAttribute('data-marked')).toBeNull();
  });

  it('положительный контроль: с onPropose кнопка режима есть', () => {
    view({ onPropose: () => {} });
    expect(mode()).toBeTruthy();
  });

  it('режим — настоящая button с aria-pressed: доступность СЛЕДУЕТ из разметки', () => {
    view({ onPropose: () => {} });
    expect(mode().tagName).toBe('BUTTON');
    expect(mode().getAttribute('type')).toBe('button');
    expect(mode().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mode());
    expect(mode().getAttribute('aria-pressed')).toBe('true');
    // Ячейки — тоже кнопки: до них доходят табом, а не только мышью.
    expect(at('r1', 'c1').tagName).toBe('BUTTON');
    expect(at('r2', 'c1').tagName).toBe('BUTTON');
  });
});

describe('K2-MATRIX · выбор виден и снимается', () => {
  it('отметка видна у ячейки и числом «выбрано N»; повторный клик снимает', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(at('r1', 'c2'));
    expect(at('r1', 'c1').getAttribute('data-marked')).toBe('true');
    expect(at('r1', 'c1').getAttribute('aria-pressed')).toBe('true');
    expect(at('r2', 'c1').getAttribute('aria-pressed')).toBe('false');
    expect(count().textContent).toMatch(/2/);
    fireEvent.click(at('r1', 'c2'));
    expect(count().textContent).toMatch(/1/);
    expect(at('r1', 'c2').getAttribute('data-marked')).toBeNull();
  });

  it('в режиме выбора клик по ячейке НЕ открывает меню одной ячейки', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    expect(screen.queryByTestId('kit-matrix-menu')).toBeNull();
  });

  it('Ctrl-клик отмечает и без режима: у мыши своя дорожка, у клавиатуры — своя', () => {
    view({ onPropose: () => {} });
    fireEvent.click(at('r1', 'c1'), { ctrlKey: true });
    expect(count().textContent).toMatch(/1/);
    expect(screen.queryByTestId('kit-matrix-menu')).toBeNull();
  });

  it('Esc снимает выбор: и отметки у ячеек, и счётчик, и режим', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    expect(count()).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('kit-matrix-marked')).toBeNull();
    expect(at('r1', 'c1').getAttribute('data-marked')).toBeNull();
    expect(mode().getAttribute('aria-pressed')).toBe('false');
  });

  it('«снять выбор» — кнопкой: на телефоне клавиши Esc нет', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-unmark'));
    expect(screen.queryByTestId('kit-matrix-marked')).toBeNull();
  });

  it('выход из режима снимает отметки: невидимый выбор не доживает до следующего захода', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(mode());
    expect(screen.queryByTestId('kit-matrix-marked')).toBeNull();
    expect(at('r1', 'c1').getAttribute('data-marked')).toBeNull();
  });
});

describe('K2-MATRIX · предложение по набору: ничего не применяется, прежнее состояние с собой', () => {
  it('в предложении — все отмеченные с ПРЕЖНИМ состоянием каждой', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(at('r1', 'c2'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o2'));
    const changes: MatrixChange[] = onPropose.mock.calls[0][0];
    expect(changes.map(c => `${c.row}/${c.col}`)).toEqual(['r1/c1', 'r1/c2']);
    expect(changes.every(c => c.value === 'o2')).toBe(true);
    expect(changes.find(c => c.col === 'c1')?.from).toEqual({ state: 'value', value: 'o1' });
    expect(changes.find(c => c.col === 'c2')?.from).toEqual({ state: 'none' });
  });

  it('непроверенная и запретная отмеченные в предложение НЕ идут', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(mode());
    fireEvent.click(at('r2', 'c1'));
    fireEvent.click(at('r2', 'c2'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    expect(onPropose.mock.calls[0][0]).toEqual([]);
  });

  it('неспрошенная — тоже: «не спрашивали» это не «значения нет»', () => {
    const onPropose = vi.fn();
    render(
      <Matrix
        rows={[{ key: 'r1', title: 'Первый' }]}
        cols={cols}
        cell={(_r, c) => (c === 'c1' ? { state: 'unasked' } : { state: 'none' })}
        options={options}
        labels={{ rows: 'Строки', cols: 'Колонки' }}
        onPropose={onPropose}
      />,
    );
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    expect(onPropose.mock.calls[0][0]).toEqual([]);
    expect(screen.getByTestId('kit-matrix-skipped').textContent ?? '').toMatch(/1/);
  });

  it('и сказано ЧИСЛОМ, сколько отмеченных пропущено', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(at('r2', 'c1'));
    fireEvent.click(at('r2', 'c2'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    expect(onPropose.mock.calls[0][0]).toHaveLength(1);
    expect(screen.getByTestId('kit-matrix-skipped').textContent).toMatch(/2/);
  });

  it('после предложения выбор снят: вторая пачка не уйдёт по тем же ячейкам вслепую', () => {
    const onPropose = vi.fn();
    view({ onPropose });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o1'));
    expect(screen.queryByTestId('kit-matrix-marked')).toBeNull();
    expect(at('r1', 'c1').getAttribute('data-marked')).toBeNull();
  });

  it('«снять значение» предлагается, когда среди отмеченных есть заполненная', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    expect(screen.getByTestId('kit-matrix-clear')).toBeTruthy();
  });

  it('а когда отмечены только пустые — не предлагается: снимать нечего', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c2'));
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    expect(screen.queryByTestId('kit-matrix-clear')).toBeNull();
  });

  it('пока ничего не отмечено, кнопки «задать выбранным» нет: она бы не делала ничего', () => {
    view({ onPropose: () => {} });
    fireEvent.click(mode());
    expect(screen.queryByTestId('kit-matrix-markset')).toBeNull();
  });
});

describe('K2-MATRIX · выбор на узком экране и доступность', () => {
  it('на узком экране выбор работает: иначе он есть только у мыши на большом', () => {
    const onPropose = vi.fn();
    view({ narrow: true, onPropose });
    fireEvent.click(mode());
    fireEvent.click(screen.getByTestId('kit-matrix-cell-r1-c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-cell-r1-c2'));
    expect(count().textContent).toMatch(/2/);
    fireEvent.click(screen.getByTestId('kit-matrix-markset'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-o2'));
    expect(onPropose.mock.calls[0][0]).toHaveLength(2);
  });

  it('узкий вид: отметки живут и после смены строки — набор не привязан к одной строке', () => {
    const onPropose = vi.fn();
    view({ narrow: true, onPropose });
    fireEvent.click(mode());
    fireEvent.click(screen.getByTestId('kit-matrix-cell-r1-c1'));
    fireEvent.click(screen.getByTestId('kit-matrix-pick-r2'));
    expect(count().textContent).toMatch(/1/);
    fireEvent.click(screen.getByTestId('kit-matrix-cell-r2-c1'));
    expect(count().textContent).toMatch(/2/);
  });

  it('axe: матрица с выбранными ячейками — без нарушений', async () => {
    const { container } = view({ onPropose: () => {} });
    fireEvent.click(mode());
    fireEvent.click(at('r1', 'c1'));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('у классов выбора есть правила в seidr.css: вид — из единого слоя', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    expect(css).toMatch(/--fs-base/); // положительный контроль чтения файла
    for (const cls of ['sk-matrix__bar', 'sk-matrix__count', 'sk-matrix__mode']) {
      expect(css, cls).toContain(`.${cls}`);
    }
    expect(css).toMatch(/\.sk-matrix__cell\.is-marked/);
  });

  it('граница K-14 держится: предметных имён в матрице по-прежнему нет', () => {
    const src = readFileSync(join(process.cwd(), 'src/flow/Matrix.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['проект', 'роль', 'keycloak', 'forgejo', 'агент', 'спринт', 'человек', 'люди']) {
      expect(code.toLowerCase(), `в коде матрицы встречается «${word}»`).not.toContain(word);
    }
  });
});
