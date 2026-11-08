// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-07 — палитра Ctrl+K и поиск «/» в kit.
// Горячие клавиши — по e.code (раскладка не важна, S4-00f/K-06): в русской
// раскладке e.key для K — «л», для «/» — «.».
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createSafeStorage } from '../resilience/safeStorage';
import type { KitCtx, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { axeViolations } from '../test/axe';
import { CommandPalette, useKitPalette } from './Palette';
import { createRecentList, type RecentList } from './paletteModel';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';

function makeCtx(run: (id: string) => void = () => {}, meta = {}): KitCtx {
  return {
    data: fixtureData(meta),
    config: fixtureConfig(run),
    href: id => `#rec=${id}`,
    esc: s => s,
    md: s => s,
  };
}

function Harness({ ctx, recent, onOpenRecord }: { ctx: KitCtx; recent: RecentList; onOpenRecord: (r: KitRecord) => void }) {
  const p = useKitPalette();
  const [opened, setOpened] = useState<string>('');
  return (
    <div>
      <button type="button" onClick={p.openPalette}>opener</button>
      <input aria-label="чужое поле" />
      <span data-testid="opened">{opened}</span>
      <CommandPalette
        open={p.open}
        mode={p.mode}
        onClose={p.close}
        ctx={ctx}
        recent={recent}
        onOpenRecord={r => { setOpened(r.id); onOpenRecord(r); }}
      />
    </div>
  );
}

function setup(opts: { recent?: string[]; meta?: object; run?: (id: string) => void } = {}) {
  const storage = createSafeStorage(() => null);
  const recent = createRecentList(storage);
  for (const e of [...(opts.recent ?? [])].reverse()) {
    const [type, id] = e.split(':');
    recent.push({ type: type as 'record' | 'command', id });
  }
  const onOpenRecord = vi.fn();
  const ctx = makeCtx(opts.run, opts.meta);
  render(<Harness ctx={ctx} recent={recent} onOpenRecord={onOpenRecord} />);
  return { recent, onOpenRecord };
}

const key = (init: Partial<KeyboardEventInit> & { code: string; key: string }) =>
  act(() => { fireEvent.keyDown(window, init); });

describe('K-07 · горячие клавиши по e.code', () => {
  it('Ctrl+K открывает палитру в русской раскладке (e.key = «л»)', () => {
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    key({ code: 'KeyK', key: 'л', ctrlKey: true });
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('data-mode')).toBe('all');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('⌘K (metaKey) тоже открывает', () => {
    setup();
    key({ code: 'KeyK', key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('«/» в русской раскладке (e.key = «.») открывает поиск по записям', () => {
    setup();
    key({ code: 'Slash', key: '.' });
    expect(screen.getByRole('dialog').getAttribute('data-mode')).toBe('records');
  });

  it('«/» в поле ввода — это символ, а не поиск', () => {
    setup();
    const input = screen.getByLabelText('чужое поле');
    input.focus();
    act(() => { fireEvent.keyDown(input, { code: 'Slash', key: '/' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('K без модификатора палитру не открывает', () => {
    setup();
    key({ code: 'KeyK', key: 'k' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('K-07 · без запроса — недавние', () => {
  it('пустой запрос показывает группу «Недавние» в порядке свежести', () => {
    setup({ recent: ['record:T-3', 'command:new-task'] });
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    const group = screen.getByRole('group', { name: 'Недавние' });
    const opts = Array.from(group.querySelectorAll('[role="option"]')).map(o => o.getAttribute('data-id'));
    expect(opts).toEqual(['record:T-3', 'command:new-task']);
  });

  it('недавних нет — честная подсказка, а не пустой список', () => {
    setup();
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    expect(screen.getByRole('status').textContent).toMatch(/Недавних пока нет/);
  });
});

describe('K-07 · записи и команды', () => {
  it('ввод ищет записи и команды; стрелки и Enter открывают запись и пишут её в недавние', () => {
    const { recent, onOpenRecord } = setup();
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'adr' } });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('data-id')).toBe('record:ADR-1');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
    fireEvent.keyDown(box, { key: 'ArrowUp', code: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'ADR-1' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(recent.list()[0]).toBe('record:ADR-1');
  });

  it('команда запускается с ctx и попадает в недавние', () => {
    const run = vi.fn();
    const { recent } = setup({ run });
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'тему' } });
    fireEvent.click(screen.getByRole('option', { name: /Сменить тему/ }));
    expect(run).toHaveBeenCalledWith('toggle-theme');
    expect(recent.list()[0]).toBe('command:toggle-theme');
  });

  it('упавшая команда — палитра остаётся открытой и говорит причину, в недавние не пишется', () => {
    const { recent } = setup({ run: () => { throw new Error('нет прав'); } });
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'создать' } });
    fireEvent.click(screen.getByRole('option', { name: /Создать задачу/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Создать задачу.*нет прав/);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(recent.list()).toEqual([]);
  });

  it('в поиске «/» команд нет', () => {
    setup();
    key({ code: 'Slash', key: '/' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'созд' } });
    expect(screen.queryByRole('group', { name: 'Команды' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Записи' })).toBeTruthy();
  });

  it('ничего не найдено — честное «ничего», с текстом запроса', () => {
    setup();
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzqqq' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('zzzqqq');
  });

  it('данные обрезаны сервером — палитра говорит, что ищет только по загруженному', () => {
    setup({ meta: { truncated: true, total: 900, returned: 6 } });
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    expect(screen.getByText(/6.*900/)).toBeTruthy();
  });

  it('Esc закрывает и возвращает фокус открывателю', () => {
    setup();
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener);
    const box = screen.getByRole('combobox');
    fireEvent.keyDown(box, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('язык en — подписи из локали kit', () => {
    const storage = createSafeStorage(() => null);
    render(
      <KitLangProvider lang="en">
        <CommandPalette open mode="all" onClose={() => {}} ctx={makeCtx()} recent={createRecentList(storage)} onOpenRecord={() => {}} />
      </KitLangProvider>,
    );
    expect(screen.getByRole('status').textContent).toMatch(/No recent items yet/);
  });

  it('axe: без нарушений с результатами', async () => {
    setup({ recent: ['record:T-1'] });
    key({ code: 'KeyK', key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'а' } });
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });
});
