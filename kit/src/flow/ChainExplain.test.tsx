// @vitest-environment jsdom
// «Почему такой вывод» — вердикт и упорядоченная цепочка причин
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-CHAIN-EXPLAIN).
//
// Повод — запрос сессии, собирающей экраны администрирования LORE: на экранах
// доступа человеку показывают ИТОГ («доступ есть» · «нельзя» · «не
// проверено»), а из чего он сложился — не показывают. Итог без цепочки
// нечем ни проверить, ни оспорить: не видно, какой шаг его дал и дошли ли
// проверки до конца.
//
// Главное, из-за чего элемент дорогой: у шага НЕ два исхода. «Подтвердил» и
// «опроверг» — лишь два из пяти; остальные три это разные виды «неизвестно»:
// не смогли проверить · нет прав посмотреть · не спрашивали. Последнее — наш
// выбор, а не отказ источника, и путать его с отказом нельзя. Словарь этих
// трёх берётся ОДИН на весь kit (тот же, что у ячейки матрицы), иначе
// «неизвестно» заговорит двумя голосами и перестанет читаться.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChainExplain, type ChainStep } from './ChainExplain';
import { Matrix } from './Matrix';

const steps = (): ChainStep[] => [
  { id: 's1', title: 'Первый шаг', outcome: { state: 'confirmed', detail: 'подробность' } },
  { id: 's2', title: 'Второй шаг', outcome: { state: 'denied' } },
  { id: 's3', title: 'Третий шаг', outcome: { state: 'unverified', reason: 'источник не ответил' } },
];

const five = (): ChainStep[] => [
  { id: 'a', title: 'Подтвердил', outcome: { state: 'confirmed' } },
  { id: 'b', title: 'Опроверг', outcome: { state: 'denied' } },
  { id: 'c', title: 'Не смогли', outcome: { state: 'unverified', reason: 'источник не ответил' } },
  { id: 'd', title: 'Не дали', outcome: { state: 'forbidden', reason: 'нужен доступ выше' } },
  { id: 'e', title: 'Не спрашивали', outcome: { state: 'unasked', reason: 'источник выключен в настройках' } },
];

describe('K2-CHAIN-EXPLAIN · вердикт и цепочка в порядке решения', () => {
  it('положительный контроль: вердикт и все шаги нарисованы', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s1" />);
    expect(screen.getByTestId('kit-chain-verdict').textContent).toContain('Доступ есть');
    expect(screen.getAllByTestId(/^kit-chain-step-/)).toHaveLength(3);
  });

  it('порядок шагов — тот, в котором их дали, а не алфавитный или по исходу', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s1" />);
    const order = screen.getAllByTestId(/^kit-chain-step-/).map(e => e.getAttribute('data-testid'));
    expect(order).toEqual(['kit-chain-step-s1', 'kit-chain-step-s2', 'kit-chain-step-s3']);
  });

  it('у шага виден его номер в цепочке: «из чего сложилось» читается по порядку', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s1" />);
    const nums = screen.getAllByTestId(/^kit-chain-num-/).map(e => e.textContent);
    expect(nums).toEqual(['1', '2', '3']);
  });

  it('вердикт и подписи шагов приходят от приложения дословно', () => {
    render(<ChainExplain verdict="Смотреть нельзя" steps={steps()} decidedBy="s2" />);
    expect(screen.getByText('Смотреть нельзя')).toBeTruthy();
    expect(screen.getByText('Второй шаг')).toBeTruthy();
  });
});

describe('K2-CHAIN-EXPLAIN · у шага пять исходов, а не два', () => {
  it('пять исходов различимы состоянием шага', () => {
    render(<ChainExplain verdict="Итог" steps={five()} decidedBy="a" />);
    const states = screen.getAllByTestId(/^kit-chain-step-/).map(e => e.getAttribute('data-state'));
    expect(states).toEqual(['confirmed', 'denied', 'unverified', 'forbidden', 'unasked']);
  });

  it('«подтвердил» и «опроверг» названы словами, а не только цветом', () => {
    render(<ChainExplain verdict="Итог" steps={five()} decidedBy="a" />);
    const said = screen.getByTestId('kit-chain-outcome-a').textContent ?? '';
    const denied = screen.getByTestId('kit-chain-outcome-b').textContent ?? '';
    expect(said.trim()).not.toBe('');
    expect(denied.trim()).not.toBe('');
    expect(said).not.toBe(denied);
  });

  it('«не смогли проверить» несёт причину на экране, а не только в данных', () => {
    render(<ChainExplain verdict="Итог" steps={five()} decidedBy="a" />);
    expect(screen.getByText(/источник не ответил/)).toBeTruthy();
  });

  it('«нет прав посмотреть» несёт свою причину и не звучит как «не смогли»', () => {
    render(<ChainExplain verdict="Итог" steps={five()} decidedBy="a" />);
    expect(screen.getByText(/нужен доступ выше/)).toBeTruthy();
    const no = screen.getByTestId('kit-chain-outcome-c').textContent ?? '';
    const forbid = screen.getByTestId('kit-chain-outcome-d').textContent ?? '';
    expect(forbid).not.toBe(no);
  });

  it('«не спрашивали» — отдельный исход: это наш выбор, а не отказ источника', () => {
    render(<ChainExplain verdict="Итог" steps={five()} decidedBy="a" />);
    const unasked = screen.getByTestId('kit-chain-outcome-e').textContent ?? '';
    const unver = screen.getByTestId('kit-chain-outcome-c').textContent ?? '';
    const forbid = screen.getByTestId('kit-chain-outcome-d').textContent ?? '';
    expect(new Set([unasked, unver, forbid]).size, 'три «неизвестно» звучат по-разному').toBe(3);
  });

  it('словарь «неизвестно» — ТОТ ЖЕ, что у ячейки матрицы, а не второй', () => {
    // Слова берём с экрана обоих элементов и сверяем дословно: разойдись они —
    // на экранах доступа появилось бы два разных «неизвестно».
    const chain = render(
      <ChainExplain
        verdict="Итог"
        steps={[
          { id: 'u', title: 'Шаг', outcome: { state: 'unverified' } },
          { id: 'f', title: 'Шаг', outcome: { state: 'forbidden' } },
          { id: 'n', title: 'Шаг', outcome: { state: 'unasked' } },
        ]}
        decidedBy="u"
      />,
    );
    const words = {
      unverified: screen.getByTestId('kit-chain-outcome-u').textContent ?? '',
      forbidden: screen.getByTestId('kit-chain-outcome-f').textContent ?? '',
      unasked: screen.getByTestId('kit-chain-outcome-n').textContent ?? '',
    };
    chain.unmount();

    render(
      <Matrix
        narrow={false}
        labels={{ rows: 'Строки', cols: 'Колонки' }}
        rows={[{ key: 'r1', title: 'Первая' }, { key: 'r2', title: 'Вторая' }, { key: 'r3', title: 'Третья' }]}
        cols={[{ key: 'c1', title: 'Колонка' }]}
        options={[{ value: 'o1', title: 'Значение' }]}
        cell={r => (r === 'r1' ? { state: 'unverified' } : r === 'r2' ? { state: 'forbidden' } : { state: 'unasked' })}
      />,
    );
    expect(screen.getByTestId('kit-matrix-cell-r1-c1').getAttribute('title')).toBe(words.unverified);
    expect(screen.getByTestId('kit-matrix-cell-r2-c1').getAttribute('title')).toBe(words.forbidden);
    expect(screen.getByTestId('kit-matrix-cell-r3-c1').getAttribute('title')).toBe(words.unasked);
  });
});

describe('K2-CHAIN-EXPLAIN · решающий шаг назван', () => {
  it('решающий шаг помечен: видно, какой шаг дал итог', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s2" />);
    expect(screen.getByTestId('kit-chain-step-s2').getAttribute('data-decider')).toBe('true');
    expect(screen.getByTestId('kit-chain-step-s1').getAttribute('data-decider')).toBeNull();
    expect(screen.getByTestId('kit-chain-decider-s2')).toBeTruthy();
  });

  it('решающий шаг не назвали — сказано, что не назвали, а не выбран первый', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} />);
    expect(screen.getByTestId('kit-chain-nodecider').textContent?.trim()).not.toBe('');
    expect(screen.queryByTestId('kit-chain-decider-s1')).toBeNull();
  });

  it('решающим назван шаг, которого в цепочке нет — сказано, а не промолчали', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s9" />);
    const said = screen.getByTestId('kit-chain-decider-missing').textContent ?? '';
    expect(said).toContain('s9');
    expect(screen.queryByTestId('kit-chain-nodecider')).toBeNull();
  });
});

describe('K2-CHAIN-EXPLAIN · оборванная цепочка сказана словами', () => {
  it('оборвали на середине — это сказано, а не выглядит законченным', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s1" stopped={{ notRun: 2 }} />);
    const said = screen.getByTestId('kit-chain-stopped').textContent ?? '';
    expect(said).toMatch(/2/);
  });

  it('сколько шагов не считали — не сказали: фраза БЕЗ числа, а не с нулём', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s1" stopped={{}} />);
    const said = screen.getByTestId('kit-chain-stopped').textContent ?? '';
    expect(said.trim()).not.toBe('');
    expect(said, '«не сказали сколько» нельзя печатать нулём').not.toMatch(/\b0\b/);
  });

  it('причина обрыва — от приложения, и она на экране', () => {
    render(
      <ChainExplain
        verdict="Доступ есть"
        steps={steps()}
        decidedBy="s1"
        stopped={{ notRun: 2, reason: 'уже решилось первым шагом' }}
      />,
    );
    expect(screen.getByText(/уже решилось первым шагом/)).toBeTruthy();
  });

  it('цепочку не обрывали — фразы об обрыве нет вовсе', () => {
    render(<ChainExplain verdict="Доступ есть" steps={steps()} decidedBy="s1" />);
    expect(screen.queryByTestId('kit-chain-stopped')).toBeNull();
  });
});

describe('K2-CHAIN-EXPLAIN · объяснения не дали — так и сказано', () => {
  it('цепочки нет вовсе: сказано, что объяснения не дали', () => {
    render(<ChainExplain verdict="Не проверено" steps={[]} />);
    expect(screen.getByTestId('kit-chain-none').textContent?.trim()).not.toBe('');
  });

  it('пустой рамки нет: списка шагов при пустой цепочке не рисуем', () => {
    render(<ChainExplain verdict="Не проверено" steps={[]} />);
    expect(screen.queryByTestId('kit-chain-steps')).toBeNull();
    expect(screen.queryByTestId('kit-chain-nodecider'), 'решающего шага не бывает там, где шагов нет').toBeNull();
  });

  it('вердикт не назвали — сказано именно это, а не пустая строка', () => {
    render(<ChainExplain verdict="   " steps={steps()} decidedBy="s1" />);
    expect(screen.queryByTestId('kit-chain-verdict')).toBeNull();
    expect(screen.getByTestId('kit-chain-noverdict').textContent?.trim()).not.toBe('');
  });

  it('«объяснения не дали» и «вердикт не назвали» — РАЗНЫЕ утверждения', () => {
    render(<ChainExplain verdict="" steps={[]} />);
    const none = screen.getByTestId('kit-chain-none').textContent ?? '';
    const noverdict = screen.getByTestId('kit-chain-noverdict').textContent ?? '';
    expect(none).not.toBe(noverdict);
  });
});

describe('K2-CHAIN-EXPLAIN · граница K-14', () => {
  it('в элементе нет предметных имён: что из чего следует — знает приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/ChainExplain.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['проект', 'роль', 'keycloak', 'forgejo', 'агент', 'спринт', 'человек']) {
      expect(code.toLowerCase(), `в коде элемента встречается «${word}»`).not.toContain(word);
    }
  });

  it('подпись блока — от приложения', () => {
    render(<ChainExplain label="Почему так" verdict="Доступ есть" steps={steps()} decidedBy="s1" />);
    expect(screen.getByText('Почему так')).toBeTruthy();
  });
});
