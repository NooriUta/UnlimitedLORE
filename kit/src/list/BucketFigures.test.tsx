// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS · цифры ведра ленты (день, группа, подгруппа) — kit раскладывает
// то, что назвало приложение; пустого не рисует.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { BucketFigures } from './BucketFigures';

beforeAll(() => registerGameIcons(gameIcons));

describe('S7A · BucketFigures', () => {
  it('баланс полосой с долей сделанного, сгорание со знаком, чипы, итог и типы', () => {
    render(<BucketFigures testid="f"
      burn={{ text: '+2', tone: 'suc', title: 'сгорание', id: 'burn' }}
      balance={{ done: 3, added: 1, doneText: '3 закрыто', addedText: '1 заведено', aria: '3 против 1', doneId: 'done', addedId: 'added' }}
      chips={[{ id: 'ready', n: 2, label: 'к выкатке', icon: 'rocket', tone: 'wrn', showLabel: true }]}
      total={{ text: '6 · 5', title: 'события · элементы', id: 'total', innerId: 'total-in' }}
      tail={[{ id: 'delta', n: 5, label: 'Δ' }]}
      types={[{ key: 'task', n: 4, icon: 'checkbox-tree', title: 'Задачи' }]} typesId="types" />);
    expect(screen.getByTestId('burn').textContent).toContain('+2');
    expect((screen.getByRole('img').firstElementChild as HTMLElement).style.width).toBe('75%');
    expect(screen.getByTestId('done').textContent).toBe('3 закрыто');
    expect(screen.getByTestId('ready').getAttribute('data-tone')).toBe('wrn');
    expect(screen.getByTestId('ready').textContent).toContain('к выкатке');
    expect(screen.getByTestId('total-in').textContent).toBe('6 · 5');
    expect(screen.getByTestId('types').textContent).toContain('4');
  });

  it('компактно — помечено для заголовков групп', () => {
    render(<BucketFigures compact testid="f" total={{ text: '1 · 1', title: 't' }} />);
    expect(screen.getByTestId('f').hasAttribute('data-compact')).toBe(true);
  });

  it('ничего не прислано — ничего не рисуется (нет «0», которого никто не считал)', () => {
    const { container } = render(<BucketFigures testid="f" chips={[]} types={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
