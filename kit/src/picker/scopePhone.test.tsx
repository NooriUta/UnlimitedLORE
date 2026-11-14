// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-04 — выбор проектов на телефоне (владелица 14.11.2026: «сделай, чтобы
// не раздражали»): нижний лист на всю высоту, «Все мои (N своих)» с числом, «Недавние» сверху,
// группы по владельцу репозитория (часть кода до «/»). Режим «все, кроме…» — отдельным шагом.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { useState } from 'react';
import { ScopePicker, registerGameIcons } from '../index';
import type { ScopeOption, ScopePickerProps } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const OPTS: ScopeOption[] = [
  { id: 'NooriUta/UnlimitedLORE', title: 'Unlimited LORE', mine: true },
  { id: 'AIDA/aida-root', title: 'AIDA monorepo' },
  { id: 'AIDA/miniLORE', title: 'miniLORE', mine: true },
  { id: 'NooriUta/volva', title: 'Völva' },
];

function Harness(props: Partial<ScopePickerProps>) {
  const [value, setValue] = useState<string[]>([]);
  return <ScopePicker label="Проекты" options={OPTS} state="ok" mine="known" mineCount={2} narrow {...props} value={value} onChange={setValue} />;
}
const openSheet = () => {
  fireEvent.click(screen.getByRole('button', { name: /Проекты/ }));
  return screen.getByRole('dialog', { name: 'Проекты' });
};

describe('S9-04 · выбор проектов на телефоне', () => {
  it('лист на всю высоту экрана', () => {
    const i = css.indexOf('.sk-scope__sheet {');
    expect(i, 'правила .sk-scope__sheet нет').toBeGreaterThan(-1);
    expect(css.slice(i, css.indexOf('}', i))).toMatch(/height:\s*100dvh/);
  });

  it('«Все мои» называет число своих', () => {
    render(<Harness />);
    const sheet = openSheet();
    expect(within(sheet).getByRole('button', { name: /Все мои \(2 своих\)/ })).toBeTruthy();
  });

  it('«Недавние» — сверху, отдельной группой', () => {
    render(<Harness recent={['NooriUta/volva']} />);
    const sheet = openSheet();
    const recent = within(sheet).getByRole('list', { name: 'Недавние' });
    expect(within(recent).getByText('Völva')).toBeTruthy();
  });

  it('группы по владельцу репозитория', () => {
    render(<Harness />);
    const sheet = openSheet();
    const aida = within(sheet).getByRole('list', { name: 'AIDA' });
    expect(within(aida).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(sheet).getByRole('list', { name: 'NooriUta' })).toBeTruthy();
  });

  it('на столе групп по владельцу нет (положительный контроль)', () => {
    render(<Harness narrow={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Проекты/ }));
    expect(screen.queryByRole('list', { name: 'AIDA' })).toBeNull();
  });
});
