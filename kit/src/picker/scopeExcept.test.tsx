// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-04, второй шаг (владелица 14.11.2026: «доделай»): режим
// «все, кроме…». Отмеченные в этом режиме — исключённые; в адресе — нотация `!a,!b`
// (`!` один — режим включён, исключённых ещё нет). Экраны получают уже раскрытый
// список: исключение раскрывается по полному списку проектов в одном месте.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { useState } from 'react';
import { ScopePicker, registerGameIcons, parseScopeSelection, formatScopeSelection, resolveScopeSelection } from '../index';
import type { ScopeOption, ScopeSelection } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('нотация «все, кроме…» в адресе', () => {
  it('обычный выбор — как раньше', () => {
    expect(parseScopeSelection('a,b')).toEqual({ except: false, ids: ['a', 'b'] });
    expect(parseScopeSelection(null)).toEqual({ except: false, ids: [] });
    expect(formatScopeSelection({ except: false, ids: ['a', 'b'] })).toBe('a,b');
    expect(formatScopeSelection({ except: false, ids: [] })).toBeNull();
  });
  it('исключение — !a,!b; режим без исключённых — «!»', () => {
    expect(parseScopeSelection('!a,!b')).toEqual({ except: true, ids: ['a', 'b'] });
    expect(parseScopeSelection('!')).toEqual({ except: true, ids: [] });
    expect(formatScopeSelection({ except: true, ids: ['a', 'b'] })).toBe('!a,!b');
    expect(formatScopeSelection({ except: true, ids: [] })).toBe('!');
  });
  it('полный круг: записать → прочитать — то же', () => {
    for (const s of [{ except: true, ids: ['x/y', 'z'] }, { except: false, ids: ['x/y'] }, { except: true, ids: [] }] as ScopeSelection[])
      expect(parseScopeSelection(formatScopeSelection(s))).toEqual(s);
  });
  it('раскрытие: кроме — все минус исключённые; обычный — выбранные', () => {
    expect(resolveScopeSelection({ except: true, ids: ['b'] }, ['a', 'b', 'c'])).toEqual(['a', 'c']);
    expect(resolveScopeSelection({ except: true, ids: [] }, ['a', 'b'])).toEqual([]);
    expect(resolveScopeSelection({ except: false, ids: ['b'] }, ['a', 'b'])).toEqual(['b']);
  });
});

const OPTS: ScopeOption[] = [
  { id: 'A/one', title: 'One', mine: true },
  { id: 'A/two', title: 'Two' },
  { id: 'B/three', title: 'Three', mine: true },
];

function Harness() {
  const [sel, setSel] = useState<ScopeSelection>({ except: false, ids: [] });
  return (
    <>
      <ScopePicker label="Проекты" options={OPTS} state="ok" mine="known" mineCount={2}
        value={sel.ids} except={sel.except} exceptable
        onChange={(ids, o) => setSel({ except: o?.except ?? false, ids })} />
      <output data-testid="sel">{formatScopeSelection(sel) ?? ''}</output>
    </>
  );
}
const open = () => {
  fireEvent.click(screen.getByRole('button', { name: /Проекты/ }));
  return screen.getByRole('dialog', { name: 'Проекты' });
};

describe('ScopePicker: режим «все, кроме…»', () => {
  it('переключатель включает режим; отмеченные — исключённые; кнопка шапки «Все, кроме N»', () => {
    render(<Harness />);
    const d = open();
    fireEvent.click(within(d).getByRole('switch', { name: /Все, кроме выбранных/ }));
    expect(screen.getByTestId('sel').textContent).toBe('!');
    fireEvent.click(within(d).getByRole('checkbox', { name: /Two/ }));
    expect(screen.getByTestId('sel').textContent).toBe('!A/two');
    expect(screen.getByRole('button', { name: /Проекты: Все, кроме 1/ })).toBeTruthy();
    expect(within(d).getByText(/Исключено: 1/)).toBeTruthy();
  });

  it('«Все мои» и «Все проекты» выходят из режима исключения', () => {
    render(<Harness />);
    const d = open();
    fireEvent.click(within(d).getByRole('switch', { name: /Все, кроме выбранных/ }));
    fireEvent.click(within(d).getByRole('checkbox', { name: /Two/ }));
    fireEvent.click(within(d).getByRole('button', { name: /Все мои/ }));
    expect(screen.getByTestId('sel').textContent).toBe('A/one,B/three');
  });

  it('без exceptable переключателя нет — прежние потребители не меняются', () => {
    render(<ScopePicker label="Проекты" options={OPTS} state="ok" value={[]} onChange={() => {}} />);
    const d = open();
    expect(within(d).queryByRole('switch', { name: /Все, кроме выбранных/ })).toBeNull();
  });
});
