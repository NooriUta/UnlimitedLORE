// @vitest-environment jsdom
// Peek со ссылки в тексте (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, P1а/P2а):
// мышь — карточка после задержки ~0,4 с, щелчок — та же карточка, закреплённая (PU-09); палец — тап открывает
// нижний лист с карточкой, перехода нет. Наведение после тапа (браузер шлёт mouseover вслед за
// касанием) карточку НЕ открывает. Выключатель — карточек по наведению нет, ссылка как ссылка.
// Содержимое карточки — от приложения (render), kit отвечает за время, место и лист.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MartProse } from './MartProse';
import type { MartRefPeek } from './MartProse';

const peek = (over: Partial<MartRefPeek> = {}): MartRefPeek => ({
  render: r => <div data-peek-content>карточка {r.id}</div>,
  title: r => `Запись ${r.id}`,
  ...over,
});
const text = 'см. [[adr:ADR-1]] дальше';
const href = () => '/p/ADR-1';
const link = (c: HTMLElement) => c.querySelector('a.sk-wref') as HTMLAnchorElement;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('MartProse refPeek — мышь', () => {
  it('карточка после задержки, не сразу', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('карточка ADR-1')).toBeNull();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('карточка ADR-1')).toBeTruthy();
  });
  it('мышь ушла раньше задержки — карточки нет', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.mouseOut(link(container));
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByText('карточка ADR-1')).toBeNull();
  });
  // PU-09 (SPRINT_UXR_POLISH_UAT_1113/PU-09, MD-READ-PEEK): щелчок по ссылке в тексте открывает
  // карточку только для чтения, текущая запись остаётся на месте; переход — из карточки
  // («Открыть паспорт») или щелчком с модификатором (новая вкладка — как у любой ссылки).
  it('щелчок мышью — карточка у ссылки, перехода нет (PU-09)', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { link(container).dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByText('карточка ADR-1')).toBeTruthy();
  });
  it('карточка по щелчку не закрывается, когда мышь уходит со ссылки', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    act(() => { link(container).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    fireEvent.mouseOut(link(container));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('карточка ADR-1')).toBeTruthy();
  });
  it('щелчок с Ctrl/Cmd — обычная ссылка (новая вкладка), не перехвачен', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...mod });
      link(container).dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });
  it('выключатель наведения не отключает карточку по щелчку — это явное действие', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek({ enabled: false })} />);
    act(() => { link(container).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(screen.getByText('карточка ADR-1')).toBeTruthy();
  });
  it("click: 'navigate' — приложение оставляет переход по щелчку", () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek({ click: 'navigate' })} />);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link(container).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('выключатель: enabled=false — наведение карточку не открывает', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek({ enabled: false })} />);
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('карточка ADR-1')).toBeNull();
  });
});

describe('MartProse refPeek — палец', () => {
  it('тап — нижний лист с карточкой, переход не происходит', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    fireEvent.touchStart(link(container));
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { link(container).dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    const sheet = screen.getByRole('dialog', { name: 'Запись ADR-1' });
    expect(sheet.textContent).toContain('карточка ADR-1');
  });
  it('mouseover вслед за касанием не открывает карточку наведения', () => {
    const { container } = render(<MartProse text={text} refHref={href} refPeek={peek()} />);
    fireEvent.touchStart(link(container));
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(document.querySelector('.sk-peek-hover')).toBeNull();
  });
  it('рамка без адреса тоже открывает лист по тапу', () => {
    const { container } = render(<MartProse text="см. [[X-9]]" refHref={() => null} refPeek={peek()} />);
    const span = container.querySelector('span.sk-wref') as HTMLElement;
    fireEvent.touchStart(span);
    act(() => { fireEvent.click(span); });
    expect(screen.getByRole('dialog', { name: 'Запись X-9' })).toBeTruthy();
  });
});

describe('MartProse без refPeek', () => {
  it('ни наведение, ни тап ничего не открывают', () => {
    const { container } = render(<MartProse text={text} refHref={href} />);
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.touchStart(link(container));
    fireEvent.click(link(container));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.sk-peek-hover')).toBeNull();
  });
});

describe('MartProse refPeek — ссылки внутри карточки', () => {
  it('наведение на ссылку внутри открытой карточки не подменяет карточку', () => {
    const inner = peek({ render: r => <div>карточка {r.id} <span className="sk-wref" data-ref="ADR-2">ADR-2</span></div> });
    const { container } = render(<MartProse text={text} refHref={href} refPeek={inner} />);
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(450); });
    const innerRef = document.querySelector('.sk-peek-hover [data-ref="ADR-2"]') as HTMLElement;
    fireEvent.mouseOver(innerRef);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/карточка ADR-1/)).toBeTruthy();
  });
});

describe('MdInlineEdit пробрасывает refPeek в чтение', () => {
  it('наведение на ссылку в теле поля с правкой — карточка', async () => {
    const { MdInlineEdit } = await import('./MdInlineEdit');
    const { container } = render(<MdInlineEdit value={text} label="Описание" onSave={() => {}} refHref={href} refPeek={peek()} />);
    fireEvent.mouseOver(link(container));
    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.getByText('карточка ADR-1')).toBeTruthy();
  });
});
