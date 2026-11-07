// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00c — оболочки: Sheet/Drawer (модальное окно
// с ловушкой фокуса и возвратом на кнопку-открыватель), Tabs (WAI-ARIA, стрелки,
// Home/End) и «ушко» Ear (свёрнутая колонка, aria-expanded).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { Drawer, Ear, Sheet, Tabs, registerGameIcons } from '../index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

function SheetHarness({ side }: { side?: 'right' | 'left' | 'bottom' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Открыть</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Фильтр" side={side}>
        <button type="button">Первая</button>
        <button type="button">Вторая</button>
      </Sheet>
    </>
  );
}

describe('Sheet / Drawer — модальное окно', () => {
  it('закрыто — ничего не рисует', () => {
    render(<Sheet open={false} onClose={() => {}} title="X">тело</Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('открыто — role=dialog, aria-modal, имя из заголовка, фокус внутри', async () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    const dlg = screen.getByRole('dialog', { name: 'Фильтр' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.className).toMatch(/\bsk-sheet--right\b/);
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('Esc закрывает и возвращает фокус на кнопку-открыватель', () => {
    render(<SheetHarness />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('крестик «Закрыть» и клик по подложке закрывают', () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    fireEvent.click(document.querySelector('.sk-sheet-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ловушка Tab: с последнего — на первый, Shift+Tab с первого — на последний', () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    const dlg = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Закрыть' });
    const last = screen.getByRole('button', { name: 'Вторая' });
    last.focus();
    fireEvent.keyDown(dlg, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Drawer — тот же Sheet справа; нижний лист — свой класс', () => {
    const { unmount } = render(<Drawer open onClose={() => {}} title="Peek">x</Drawer>);
    expect(screen.getByRole('dialog').className).toMatch(/\bsk-sheet--right\b/);
    unmount();
    render(<Sheet open onClose={() => {}} title="Лист" side="bottom">x</Sheet>);
    expect(screen.getByRole('dialog').className).toMatch(/\bsk-sheet--bottom\b/);
  });
});

function TabsHarness({ onChange }: { onChange?: (id: string) => void }) {
  const [v, setV] = useState('flt');
  return (
    <Tabs
      label="Фильтр и группировка"
      value={v}
      onChange={id => { setV(id); onChange?.(id); }}
      items={[
        { id: 'flt', label: 'Фильтр', icon: 'funnel', count: 2 },
        { id: 'grp', label: 'Группировка' },
        { id: 'off', label: 'Скрыто', disabled: true },
        { id: 'sort', label: 'Порядок' },
      ]}
    >
      <p>панель {v}</p>
    </Tabs>
  );
}

describe('Tabs — WAI-ARIA вкладки', () => {
  it('tablist с именем, выбранная вкладка aria-selected и в Tab-порядке, панель связана', async () => {
    const { container } = render(<TabsHarness />);
    expect(screen.getByRole('tablist', { name: 'Фильтр и группировка' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(tabs[0].textContent).toContain('2');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('клик выбирает; стрелки ходят по кругу, пропуская выключенные; Home/End', () => {
    const onChange = vi.fn();
    render(<TabsHarness onChange={onChange} />);
    const tab = (n: string) => screen.getByRole('tab', { name: new RegExp(n) });
    fireEvent.click(tab('Группировка'));
    expect(onChange).toHaveBeenLastCalledWith('grp');
    expect(screen.getByRole('tabpanel').textContent).toBe('панель grp');
    fireEvent.keyDown(tab('Группировка'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('sort');
    expect(document.activeElement).toBe(tab('Порядок'));
    fireEvent.keyDown(tab('Порядок'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('flt');
    fireEvent.keyDown(tab('Фильтр'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('sort');
    fireEvent.keyDown(tab('Порядок'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('flt');
    fireEvent.keyDown(tab('Фильтр'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('sort');
  });

  it('без children панели нет (вкладки как переключатель вида)', () => {
    render(<Tabs label="Вид" value="a" onChange={() => {}} items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-controls')).toBeNull();
  });
});

describe('Ear — «ушко» свёрнутой колонки', () => {
  it('кнопка с видимой подписью, aria-expanded и aria-controls; клик — onToggle', async () => {
    const onToggle = vi.fn();
    const { container } = render(
      <>
        <Ear label="Свойства · граф" expanded={false} controls="rail" onToggle={onToggle} />
        <aside id="rail" hidden />
      </>,
    );
    const btn = screen.getByRole('button', { name: 'Свойства · граф' });
    expect(btn.className).toMatch(/\bsk-ear\b/);
    expect(btn.className).toMatch(/\bsk-ear--right\b/);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('rail');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('левое ушко — свой класс', () => {
    render(<Ear label="Меню" side="left" />);
    expect(screen.getByRole('button', { name: 'Меню' }).className).toMatch(/\bsk-ear--left\b/);
  });
});
