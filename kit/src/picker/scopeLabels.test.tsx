// @vitest-environment jsdom
// Подписи ScopePicker от приложения (долг kit из ACL-3, сессия 50109daa 11.11.2026):
// «подписи "Все проекты", "Найти проект", "Проектов: N" зашиты под проекты; для
// выбора людей это путает». Проп `labels` заменяет слова о проектах; без него —
// как раньше (проекты). Граница K-14: «люди», «машины» — слова приложения.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { useState } from 'react';
import { ScopePicker, registerGameIcons } from '../index';
import type { ScopeOption, ScopePickerProps } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const OPTS: ScopeOption[] = [{ id: 'irsil', mine: true }, { id: 'zotov' }, { id: 'arra' }];

function Harness(props: Partial<ScopePickerProps> & { initial?: string[] }) {
  const { initial = [], ...rest } = props;
  const [value, setValue] = useState<string[]>(initial);
  return <ScopePicker label="Кого допустить" options={OPTS} state="ok" mine="known" narrow={false} {...rest} value={value} onChange={setValue} />;
}

const LABELS = { all: 'Все люди', search: 'Найти человека', many: 'Выбрано людей: {n}' };

describe('ScopePicker · подписи от приложения', () => {
  it('с labels — свои слова: кнопка «Все …», поле поиска, итог «… {n}»', () => {
    render(<Harness labels={LABELS} initial={['zotov', 'arra']} />);
    expect(screen.getByRole('button', { name: /Выбрано людей: 2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Кого допустить/ }));
    const dlg = screen.getByRole('dialog', { name: 'Кого допустить' });
    expect(within(dlg).getByRole('searchbox', { name: 'Найти человека' })).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: /Все люди/ })).toBeTruthy();
  });

  it('без labels — как раньше, про проекты', () => {
    render(<Harness initial={['zotov', 'arra']} />);
    expect(screen.getByRole('button', { name: /Проектов: 2/ })).toBeTruthy();
  });
});
