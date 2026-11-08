// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03 — выбор нескольких проектов в шапке:
// поиск, «все мои», «только этот»; на широком экране — поповер, на телефоне —
// лист (kit Sheet снизу). Состояния честные: загрузка, ошибка, нет прав, пусто,
// неполная выдача и «роли не проверены» — каждое своим видом.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { useState } from 'react';
import { axeViolations } from '../test/axe';
import { KitShell, ScopePicker, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig, ScopeOption, ScopePickerProps } from '../index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const OPTS: ScopeOption[] = [
  { id: 'unlimitedlore', title: 'Unlimited LORE', mine: true },
  { id: 'aida-root', title: 'AIDA monorepo' },
  { id: 'mobilepoc', title: 'miniLORE', mine: true },
  { id: 'tyr', title: 'TYR' },
];

function Harness(props: Partial<ScopePickerProps> & { initial?: string[]; spy?: (v: string[]) => void }) {
  const { initial = [], spy, ...rest } = props;
  const [value, setValue] = useState<string[]>(initial);
  return (
    <ScopePicker
      label="Проекты"
      options={OPTS}
      state="ok"
      mine="known"
      narrow={false}
      {...rest}
      value={value}
      onChange={v => { setValue(v); spy?.(v); }}
    />
  );
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /Проекты/ }));
  return screen.getByRole('dialog', { name: 'Проекты' });
}

describe('S4-03 · кнопка в шапке', () => {
  it('пустой выбор подписан «все проекты», один — названием, несколько — числом', () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole('button', { name: /Проекты/ }).textContent).toMatch(/Все проекты/);
    unmount();
    const r2 = render(<Harness initial={['tyr']} />);
    expect(screen.getByRole('button', { name: /Проекты/ }).textContent).toMatch(/TYR/);
    r2.unmount();
    render(<Harness initial={['tyr', 'aida-root']} />);
    expect(screen.getByRole('button', { name: /Проекты/ }).textContent).toMatch(/2/);
  });

  it('кнопка объявляет диалог и его состояние', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: /Проекты/ });
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('S4-03 · выбор', () => {
  it('галочки выбирают несколько проектов', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const dlg = open();
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /TYR/ }));
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /AIDA monorepo/ }));
    expect(spy).toHaveBeenLastCalledWith(['tyr', 'aida-root']);
    expect(within(dlg).getByRole('checkbox', { name: /TYR/ })).toHaveProperty('checked', true);
  });

  it('«только этот» оставляет один проект', () => {
    const spy = vi.fn();
    render(<Harness initial={['tyr', 'aida-root']} spy={spy} />);
    const dlg = open();
    fireEvent.click(within(dlg).getByRole('button', { name: /Только miniLORE/ }));
    expect(spy).toHaveBeenLastCalledWith(['mobilepoc']);
  });

  it('«все мои» выбирает проекты с ролью', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const dlg = open();
    fireEvent.click(within(dlg).getByRole('button', { name: /Все мои/ }));
    expect(spy).toHaveBeenLastCalledWith(['unlimitedlore', 'mobilepoc']);
  });

  it('«все проекты» снимает фильтр', () => {
    const spy = vi.fn();
    render(<Harness initial={['tyr']} spy={spy} />);
    const dlg = open();
    fireEvent.click(within(dlg).getByRole('button', { name: /Все проекты/ }));
    expect(spy).toHaveBeenLastCalledWith([]);
  });

  it('поиск сужает список; ничего не нашлось — сказано словами', () => {
    render(<Harness />);
    const dlg = open();
    const search = within(dlg).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'lore' } });
    expect(within(dlg).getAllByRole('checkbox').length).toBe(2);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(within(dlg).queryAllByRole('checkbox').length).toBe(0);
    expect(dlg.textContent).toMatch(/Ничего не найдено/);
  });

  it('выбранный, которого нет в списке, виден с пометкой и снимается', () => {
    const spy = vi.fn();
    render(<Harness initial={['ghost']} spy={spy} />);
    const dlg = open();
    const box = within(dlg).getByRole('checkbox', { name: /ghost/ });
    expect(box.closest('li')?.textContent).toMatch(/нет в списке/);
    fireEvent.click(box);
    expect(spy).toHaveBeenLastCalledWith([]);
  });

  it('Esc закрывает и возвращает фокус на кнопку', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: /Проекты/ });
    btn.focus();
    const dlg = open();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe('S4-03 · честные состояния', () => {
  it('роли не проверены — «все мои» недоступно и сказано почему', () => {
    render(<Harness mine="unknown" mineHint="нет входа" />);
    const dlg = open();
    const mine = within(dlg).getByRole('button', { name: /Все мои/ });
    expect(mine.getAttribute('aria-disabled')).toBe('true');
    expect(dlg.textContent).toMatch(/Не смогли проверить ваши проекты/);
    expect(dlg.textContent).toMatch(/нет входа/);
  });

  it('ролей нет ни в одном проекте — «все мои» недоступно с другой причиной', () => {
    render(<Harness options={OPTS.map(o => ({ ...o, mine: false }))} />);
    const dlg = open();
    expect(within(dlg).getByRole('button', { name: /Все мои/ }).getAttribute('aria-disabled')).toBe('true');
    expect(dlg.textContent).toMatch(/нет роли ни в одном проекте/);
  });

  it('ошибка загрузки — ошибка с «Повторить», а не пустой список', () => {
    const retry = vi.fn();
    render(<Harness options={[]} state="error" error={{ status: 502, message: 'bad gateway' }} onRetry={retry} />);
    const dlg = open();
    expect(within(dlg).getByRole('alert').textContent).toMatch(/502/);
    fireEvent.click(within(dlg).getByRole('button', { name: /Повторить/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('нет прав — свой вид, не «пусто»', () => {
    render(<Harness options={[]} state="forbidden" />);
    const dlg = open();
    expect(dlg.querySelector('[data-state="forbidden"]')).not.toBeNull();
    expect(dlg.querySelector('[data-state="empty"]')).toBeNull();
  });

  it('проверенный ноль — «проектов нет»', () => {
    render(<Harness options={[]} state="empty" />);
    const dlg = open();
    expect(dlg.querySelector('[data-state="empty"]')).not.toBeNull();
  });

  it('загрузка — скелет', () => {
    render(<Harness options={[]} state="loading" />);
    const dlg = open();
    expect(dlg.querySelector('.sk-skel')).not.toBeNull();
  });

  it('неполная выдача — плашка над списком', () => {
    render(<Harness state="partial" completeness={{ kind: 'capped', shown: 4, limit: 4 }} />);
    const dlg = open();
    expect(dlg.querySelector('[data-state="partial"]')).not.toBeNull();
    expect(within(dlg).getAllByRole('checkbox').length).toBe(4);
  });
});

describe('S4-03 · телефон', () => {
  it('на узком экране — лист снизу (kit Sheet), модальный', () => {
    render(<Harness narrow />);
    const dlg = open();
    expect(dlg.className).toMatch(/sk-sheet--bottom/);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /TYR/ }));
    expect(within(dlg).getByRole('checkbox', { name: /TYR/ })).toHaveProperty('checked', true);
  });

  it('на широком — поповер у кнопки, не модальный', () => {
    render(<Harness />);
    const dlg = open();
    expect(dlg.className).toMatch(/sk-scope__pop/);
    expect(dlg.getAttribute('aria-modal')).toBeNull();
  });
});

describe('S4-03 · место в шапке оболочки', () => {
  it('KitShell рисует выбор в шапке (слот topEnd), рядом с модулями', () => {
    const config = {
      modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled' }],
      menu: { groups: [] },
      kinds: {},
      statuses: { items: [] },
    } as unknown as KitConfig;
    render(
      <KitShell config={config} narrow={false} storage={createSafeStorage()} topEnd={<Harness />}>
        <p>тело</p>
      </KitShell>,
    );
    const top = screen.getByRole('banner');
    expect(within(top).getByRole('button', { name: /Проекты/ })).toBeTruthy();
  });
});

describe('S4-03 · a11y и язык', () => {
  it('axe без нарушений в открытом виде', async () => {
    const { container } = render(<Harness initial={['tyr']} />);
    open();
    expect(await axeViolations(container.ownerDocument.body)).toEqual([]);
  });

  it('английский', () => {
    render(<Harness lang="en" label="Projects" />);
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }));
    const dlg = screen.getByRole('dialog', { name: 'Projects' });
    expect(within(dlg).getByRole('button', { name: /All mine/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Projects/ }).textContent).toMatch(/All projects/);
  });
});
