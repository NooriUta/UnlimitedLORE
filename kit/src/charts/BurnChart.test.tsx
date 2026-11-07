// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-03 — Burnup/burndown спринта: свёрнут под
// таблицей задач. Свёрнутый заголовок — одна кнопка (aria-expanded) с итогом;
// честные состояния видны и в свёрнутом виде; режим burnup/burndown — переключатель.
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axeViolations } from '../test/axe';
import { BurnChart, KitLangProvider, burnSeries, type BurnMode } from '../index';

const C = (task_uid: string, valid_from: string) => ({ task_uid, valid_from });
const POINTS = burnSeries(
  [C('S/A', '2026-11-01'), C('S/B', '2026-11-01'), C('S/C', '2026-11-02')],
  [C('S/A', '2026-11-03')],
  'S',
);
const TOGGLE = /burnup \/ burndown/i;

function Harness({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  const [mode, setMode] = useState<BurnMode>('burndown');
  return <BurnChart state="ok" points={POINTS} expanded={open} onExpandedChange={setOpen} mode={mode} onModeChange={setMode} />;
}

describe('BurnChart — свёрнут по умолчанию', () => {
  it('свёрнут: только кнопка-заголовок с итогом, графика нет', () => {
    render(<BurnChart state="ok" points={POINTS} />);
    const btn = screen.getByRole('button', { name: TOGGLE });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toMatch(/остаток 2 из 3/);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('клик раскрывает: график (role=img с итогом в имени) и переключатель режима', async () => {
    const { container } = render(<Harness />);
    const btn = screen.getByRole('button', { name: TOGGLE });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(btn.getAttribute('aria-controls')!)).not.toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/2.*3/);
    expect(screen.getByRole('button', { name: 'Burndown' }).getAttribute('aria-pressed')).toBe('true');
    // Как в остальных тестах kit — контейнер компонента: правило region
    // (всё в landmark) относится к странице целиком, а не к блоку.
    expect(await axeViolations(container)).toEqual([]);
  });

  it('режим burnup: линии «закрыто» и «объём», без остатка и идеальной линии', () => {
    render(<Harness initial />);
    expect(document.querySelector('[data-series="remaining"]')).not.toBeNull();
    expect(document.querySelector('[data-series="ideal"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Burnup' }));
    expect(screen.getByRole('button', { name: 'Burnup' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-series="done"]')).not.toBeNull();
    expect(document.querySelector('[data-series="scope"]')).not.toBeNull();
    expect(document.querySelector('[data-series="remaining"]')).toBeNull();
    expect(document.querySelector('[data-series="ideal"]')).toBeNull();
  });

  it('неуправляемый режим: defaultExpanded и внутренний переключатель', () => {
    const onMode = vi.fn();
    render(<BurnChart state="ok" points={POINTS} defaultExpanded onModeChange={onMode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Burnup' }));
    expect(onMode).toHaveBeenCalledWith('burnup');
    expect(screen.getByRole('button', { name: 'Burnup' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('BurnChart — честные состояния', () => {
  it('ошибка видна уже в свёрнутом заголовке; раскрытие — LoadError с «Повторить»', () => {
    const retry = vi.fn();
    render(<BurnChart state="error" error={new Error('HTTP 500')} onRetry={retry} />);
    const btn = screen.getByRole('button', { name: TOGGLE });
    expect(btn.textContent).toMatch(/не загрузил/);
    fireEvent.click(btn);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(retry).toHaveBeenCalled();
  });

  it('нет прав ≠ пусто', () => {
    render(<BurnChart state="forbidden" defaultExpanded />);
    expect(screen.getByRole('button', { name: TOGGLE }).textContent).toMatch(/нет прав/i);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('проверенный ноль: «задач нет», без графика', () => {
    render(<BurnChart state="empty" points={[]} defaultExpanded />);
    expect(screen.getByRole('button', { name: TOGGLE }).textContent).toMatch(/задач нет/);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('одна точка — «мало точек», а не пустой график', () => {
    render(<BurnChart state="ok" points={POINTS.slice(0, 1)} defaultExpanded />);
    expect(screen.getByText(/мало точек/)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('partial: график есть, но с плашкой неполной истории', () => {
    render(<BurnChart state="partial" points={POINTS} completeness={{ kind: 'capped', shown: 500, limit: 500 }} defaultExpanded />);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByText(/обрезана/)).toBeTruthy();
  });

  it('загрузка — скелет, итог в заголовке не выдумывается', () => {
    render(<BurnChart state="loading" defaultExpanded />);
    expect(screen.getByRole('button', { name: TOGGLE }).textContent).toMatch(/загрузка/i);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('en: подписи из локали kit', () => {
    render(<KitLangProvider lang="en"><BurnChart state="ok" points={POINTS} /></KitLangProvider>);
    expect(screen.getByRole('button', { name: TOGGLE }).textContent).toMatch(/2 of 3 left/);
  });
});
