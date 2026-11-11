// @vitest-environment jsdom
// Подписанные группы в ScopePicker (SPRINT_UXR_S7B_ADMIN/S7B-ACL-3, разбор kit
// принят владелицей 11.11.2026: «перерисуйте, я согласна»). Выбор человека для
// допуска к машине: сначала «участники проектов машины», потом «не в проектах
// машины» — две группы с подписями. Подписи называет приложение (K-14): kit
// делит по `mine`, своих слов о проектах и машинах у него нет.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { useState } from 'react';
import { ScopePicker, registerGameIcons } from '../index';
import type { ScopeOption, ScopePickerProps } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const OPTS: ScopeOption[] = [
  { id: 'irsil', title: 'irsil', mine: true },
  { id: 'zotov', title: 'zotov' },
  { id: 'yadov', title: 'yadov', mine: true },
  { id: 'arra', title: 'arra' },
];

function Harness(props: Partial<ScopePickerProps>) {
  const [value, setValue] = useState<string[]>([]);
  return <ScopePicker label="Кого допустить" options={OPTS} state="ok" mine="known" narrow={false} {...props} value={value} onChange={setValue} />;
}

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: /Кого допустить/ }));
  return screen.getByRole('dialog', { name: 'Кого допустить' });
};
const ids = (list: HTMLElement) => [...list.querySelectorAll('[data-scope-id]')].map(e => e.getAttribute('data-scope-id'));

describe('ScopePicker · подписанные группы', () => {
  it('с подписями — две группы: свои первыми, у каждой свой заголовок и список', () => {
    render(<Harness groups={{ mine: 'Участники проектов машины', other: 'Не в проектах машины' }} />);
    const dlg = open();
    const mine = within(dlg).getByRole('list', { name: 'Участники проектов машины' });
    const other = within(dlg).getByRole('list', { name: 'Не в проектах машины' });
    expect(ids(mine)).toEqual(['irsil', 'yadov']);
    expect(ids(other)).toEqual(['arra', 'zotov']);
  });

  it('поиск сужает обе группы; опустевшая группа не показывает заголовок', () => {
    render(<Harness groups={{ mine: 'Участники проектов машины', other: 'Не в проектах машины' }} />);
    const dlg = open();
    fireEvent.change(within(dlg).getByRole('searchbox'), { target: { value: 'arr' } });
    expect(within(dlg).queryByRole('list', { name: 'Участники проектов машины' })).toBeNull();
    expect(ids(within(dlg).getByRole('list', { name: 'Не в проектах машины' }))).toEqual(['arra']);
  });

  it('без подписей — один список, как раньше; роли не проверены — групп нет (делить не по чему)', () => {
    const { unmount } = render(<Harness />);
    let dlg = open();
    expect(within(dlg).getAllByRole('list')).toHaveLength(1);
    unmount();
    render(<Harness groups={{ mine: 'Участники', other: 'Остальные' }} mine="unknown" />);
    dlg = open();
    expect(within(dlg).queryByRole('list', { name: 'Участники' })).toBeNull();
  });
});
