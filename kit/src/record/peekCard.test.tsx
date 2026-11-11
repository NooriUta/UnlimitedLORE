// @vitest-environment jsdom
// Карточка Peek (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, прототип одобрен 11.11):
// карточка ленты (общая шапка + один раздел тела) плюс 2–3 свойства, счётчики и действия.
// Только чтение. Честно: нет статуса — нет пилюли; нет текста — «текста нет»; не задано — словами;
// не смогли ≠ записи нет ≠ нет прав. Kit не знает предметных имён: всё приходит от приложения.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PeekCard } from './PeekCard';
import type { PeekCardData } from './PeekCard';

const adr: PeekCardData = {
  kind: 'ADR', id: 'ADR-1', title: 'Ссылка на объект',
  status: <span data-st>ACCEPTED</span>,
  props: [{ label: 'компоненты', value: 'OMILORE · FORSETI' }, { label: 'срок', value: null }],
  section: { title: 'Контекст', paras: ['Первый', 'Второй', 'Третий', 'Четвёртый'] },
  counters: [{ label: 'решений', n: 6 }, { label: 'задач', n: 2 }],
  href: '/?sec=adrs&open=ADR-1',
};

describe('PeekCard — данные есть', () => {
  it('шапка общая с лентой: вид, ID, название, статус в строке шапки', () => {
    const { container } = render(<PeekCard peek={{ state: 'ok', data: adr }} />);
    expect(container.querySelector('.sk-feed__kind')?.textContent).toBe('ADR');
    expect(container.querySelector('.sk-feed__title')?.textContent).toBe('Ссылка на объект');
    expect(container.querySelector('.sk-card__status [data-st]')).toBeTruthy();
  });
  it('свойства; незаданное — «не задано», а не пусто', () => {
    render(<PeekCard peek={{ state: 'ok', data: adr }} />);
    expect(screen.getByText('OMILORE · FORSETI')).toBeTruthy();
    expect(screen.getByText('не задано')).toBeTruthy();
  });
  it('один раздел тела, не больше трёх абзацев', () => {
    const { container } = render(<PeekCard peek={{ state: 'ok', data: adr }} />);
    expect(container.querySelector('.sk-rec-fields__sechead')?.textContent).toBe('Контекст');
    expect(container.textContent).toContain('Третий');
    expect(container.textContent).not.toContain('Четвёртый');
  });
  it('нет текста — «текста нет» словами', () => {
    render(<PeekCard peek={{ state: 'ok', data: { ...adr, section: null } }} />);
    expect(screen.getByText(/Текста нет/)).toBeTruthy();
  });
  it('нет статуса — нет пилюли', () => {
    const { container } = render(<PeekCard peek={{ state: 'ok', data: { ...adr, status: undefined } }} />);
    expect(container.querySelector('.sk-card__status')).toBeNull();
  });
  it('счётчики числами', () => {
    const { container } = render(<PeekCard peek={{ state: 'ok', data: adr }} />);
    expect(container.querySelector('.sk-peek-card__cnt')?.textContent).toMatch(/решений\s*6.*задач\s*2/);
  });
  it('«Открыть паспорт» и «В новой вкладке» — ссылки на паспорт; адреса нет — кнопок нет', () => {
    const { rerender } = render(<PeekCard peek={{ state: 'ok', data: adr }} />);
    expect(screen.getByRole('link', { name: 'Открыть паспорт' }).getAttribute('href')).toBe(adr.href);
    const tab = screen.getByRole('link', { name: 'В новой вкладке' });
    expect(tab.getAttribute('target')).toBe('_blank');
    expect(tab.getAttribute('rel')).toContain('noopener');
    rerender(<PeekCard peek={{ state: 'ok', data: { ...adr, href: null } }} />);
    expect(screen.queryByText('Открыть паспорт')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Копировать ссылку' })).toBeNull();
  });
  it('«Копировать ссылку»: удалось — сказано; не удалось — сказано, а не молча', async () => {
    const write = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<PeekCard peek={{ state: 'ok', data: adr }} absoluteHref={h => `https://lore${h}`} />);
    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));
    expect(write).toHaveBeenCalledWith('https://lore/?sec=adrs&open=ADR-1');
    expect(await screen.findByRole('status')).toBeTruthy();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Копировать ссылку' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Не удалось скопировать/);
  });
});

describe('PeekCard — честные состояния', () => {
  it('грузится', () => {
    render(<PeekCard peek={{ state: 'loading' }} id="ADR-1" />);
    expect(screen.getByText(/Загружаю/)).toBeTruthy();
  });
  it('не смогли — с причиной и «Повторить», это не «записи нет»', () => {
    const onRetry = vi.fn();
    render(<PeekCard peek={{ state: 'error', reason: '503' }} id="ADR-1" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('503');
    expect(screen.queryByText(/Такой записи нет/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('записи нет — названо, ссылка битая', () => {
    render(<PeekCard peek={{ state: 'missing' }} id="ADR-999" />);
    expect(screen.getByText(/Такой записи нет/).textContent).toContain('ADR-999');
  });
  it('нет прав — названо иначе, чем сбой', () => {
    render(<PeekCard peek={{ state: 'forbidden', reason: 'проект вне вашей области' }} id="S/1" />);
    expect(screen.getByText(/Нет прав/).textContent).toContain('проект вне вашей области');
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });
});
