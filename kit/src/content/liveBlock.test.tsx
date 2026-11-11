// @vitest-environment jsdom
// Живые блоки в Markdown (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04). Прототип и
// ответы владелицы 11.11.2026 («по всем вопросам принимаю твои рекомендации»):
// превью при открытии; режимы «код / превью / рядом» (на телефоне «рядом» нет);
// режим нигде не хранится; пересчёт при открытии, по «обновить» и при возврате
// на вкладку, если данным больше 15 мин; время — от бэкенда, иначе часы
// браузера; сбой ≠ пусто; нет прав ≠ пусто; «показаны N из M».
// Граница K-14: какие языки живые и как их исполнять — приложение (проп blocks).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MartProse, toSegments } from './MartProse';
import { LiveBlockError } from './LiveBlock';
import type { LiveBlockRun } from './LiveBlock';

const SRC = 'Текст до.\n\n```lore-query\ntasks_of_sprint | where sprint_id = $this.id\n```\n\nТекст после.';

const table = (rows: Record<string, string>[], total?: number): LiveBlockRun =>
  vi.fn(async () => ({ kind: 'table' as const, columns: [{ key: 'id', title: 'Задача' }], rows, total, generatedAt: '2026-11-11T14:02:00Z' }));

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

afterEach(() => { vi.useRealTimers(); });

describe('разбор', () => {
  it('lore-query — живой блок только если язык назван приложением; иначе обычный код', () => {
    expect(toSegments(SRC, undefined, ['lore-query']).map(s => s.kind)).toEqual(['html', 'live', 'html']);
    expect(toSegments(SRC).map(s => s.kind)).toEqual(['html']);
  });
});

describe('блок в тексте', () => {
  it('превью при открытии: таблица результата, строка свежести, «показаны N из M»', async () => {
    const run = table([{ id: 'S6-01' }, { id: 'S6-02' }], 8);
    render(<MartProse text={SRC} blocks={{ 'lore-query': run }} />);
    await settle();
    const block = screen.getByRole('region', { name: /lore-query/ });
    expect(within(block).getByRole('button', { name: 'превью' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(block).getByRole('cell', { name: 'S6-02' })).toBeTruthy();
    expect(within(block).getByText(/данные на/)).toBeTruthy();
    expect(within(block).getByText('показаны 2 из 8')).toBeTruthy();
    expect(run).toHaveBeenCalledWith('tasks_of_sprint | where sprint_id = $this.id', expect.anything());
    // Текст вокруг блока остался текстом.
    expect(screen.getByText('Текст после.')).toBeTruthy();
  });

  it('«код» показывает исходник, «рядом» — исходник и результат; на телефоне «рядом» нет', async () => {
    const run = table([{ id: 'S6-01' }]);
    const { unmount } = render(<MartProse text={SRC} blocks={{ 'lore-query': run }} />);
    await settle();
    const block = screen.getByRole('region', { name: /lore-query/ });
    fireEvent.click(within(block).getByRole('button', { name: 'код' }));
    expect(block.querySelector('pre')?.textContent).toContain('tasks_of_sprint');
    expect(within(block).queryByRole('table')).toBeNull();
    fireEvent.click(within(block).getByRole('button', { name: 'рядом' }));
    expect(block.querySelector('pre')).toBeTruthy();
    expect(within(block).getByRole('table')).toBeTruthy();
    unmount();
    render(<MartProse text={SRC} blocks={{ 'lore-query': run }} narrow />);
    await settle();
    expect(screen.queryByRole('button', { name: 'рядом' })).toBeNull();
  });

  it('сбой ≠ пусто: тревога с кодом отказа и «Повторить», повтор зовёт исполнителя заново', async () => {
    const run = vi.fn(async () => { throw new LiveBlockError('UNSUPPORTED_STAGE', 'стадия «group by» не поддерживается'); });
    render(<MartProse text={SRC} blocks={{ 'lore-query': run }} />);
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('UNSUPPORTED_STAGE');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('нет прав ≠ пусто; пустой ответ — проверенный ноль', async () => {
    const denied = vi.fn(async () => { throw new LiveBlockError('FORBIDDEN', 'вне ваших проектов', 403); });
    const { unmount } = render(<MartProse text={SRC} blocks={{ 'lore-query': denied }} />);
    await settle();
    expect(document.querySelector('[data-state="forbidden"]')).toBeTruthy();
    unmount();
    render(<MartProse text={SRC} blocks={{ 'lore-query': table([]) }} />);
    await settle();
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
  });

  it('пересчёт: «обновить» и возврат на вкладку, если данным больше 15 мин', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T14:02:00Z'));
    const run = table([{ id: 'S6-01' }]);
    render(<MartProse text={SRC} blocks={{ 'lore-query': run }} />);
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'обновить' }));
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    // 5 минут — свежо, вкладка вернулась — не пересчитываем.
    vi.setSystemTime(new Date('2026-11-11T14:07:00Z'));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    // 20 минут — устарело: пересчёт.
    vi.setSystemTime(new Date('2026-11-11T14:22:00Z'));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
