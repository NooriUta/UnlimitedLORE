// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET (владелица 19.11.2026: «пот открытии паспортов не должна
// вся страница перегружаться и сбрасывается левая часть — только паспорт выбранного элемента»;
// 20.11: «очень нужна»).
//
// Корень (воспроизведено этим файлом до правки):
//   1. ListWithRecord ставил список в РАЗНЫЕ места дерева: без записи — `<>{list}</>`, с записью —
//      `<RecordDock backdrop={list}>`; во весь экран док список не рисовал вовсе. Для React это
//      другой узел — список размонтировался и монтировался заново: пропадали выделение, раскрытые
//      группы, прокрутка. То же — когда список на миг «не готов».
//   2. Ссылка на запись этого же раздела (связи паспорта, упоминание, чип) — обычный `<a href>`:
//      браузер грузил ВСЮ страницу заново, список читал данные с нуля.
// Правило одно: выбор записи — только параметр адреса (?open=), узел списка не трогается.
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ListWithRecord, type OpenRecord } from './ListWithRecord';

let mounts = 0;
/** Список-зонд: считает монтирования и держит своё состояние (как выделение у ListView). */
function ProbeList() {
  const [picked, setPicked] = useState(false);
  useEffect(() => { mounts += 1; }, []);
  return (
    <div data-testid="probe">
      <label><input type="checkbox" checked={picked} onChange={e => setPicked(e.target.checked)} />выбрать</label>
      <a href="?sec=adr&open=A-2&q=x">ссылка на A-2</a>
      <a href="?sec=task&open=T-1">задача другого раздела</a>
      <a href="https://example.org/?open=A-3">внешняя</a>
    </div>
  );
}

function Harness({ initial, ready = true, onOpenSpy }: { initial: OpenRecord; ready?: boolean; onOpenSpy?: (o: OpenRecord) => void }) {
  const [open, setOpen] = useState<OpenRecord>(initial);
  return (
    <>
      <button type="button" onClick={() => setOpen({ ...open, id: 'A-1' })}>открыть A-1</button>
      <button type="button" onClick={() => setOpen({ ...open, id: 'A-2' })}>открыть A-2</button>
      <button type="button" onClick={() => setOpen({ ...open, place: 'full' })}>во весь экран</button>
      <button type="button" onClick={() => setOpen({ ...open, place: 'bottom' })}>снизу</button>
      <button type="button" onClick={() => setOpen({ ...open, id: null })}>закрыть</button>
      <ListWithRecord list={<ProbeList />} open={open} ready={ready}
        onOpen={o => { onOpenSpy?.(o); setOpen(o); }}
        record={s => <article data-testid="rec">запись {s.id} <a href="?sec=adr&open=A-3">связь A-3</a></article>} />
    </>
  );
}

describe('K4-PASSPORT-NO-LIST-RESET · открытие паспорта не пересоздаёт список', () => {
  it('открыть, листать, во весь экран и обратно, снизу, закрыть — список монтирован ОДИН раз, состояние на месте', () => {
    mounts = 0;
    render(<Harness initial={{ id: null, place: 'right' }} />);
    const node = screen.getByTestId('probe');
    fireEvent.click(screen.getByLabelText('выбрать'));
    for (const step of ['открыть A-1', 'открыть A-2', 'во весь экран', 'снизу', 'открыть A-1', 'закрыть']) {
      fireEvent.click(screen.getByText(step));
      expect(screen.getByTestId('probe'), step).toBe(node);
      expect((screen.getByLabelText('выбрать') as HTMLInputElement).checked, step).toBe(true);
    }
    expect(mounts).toBe(1);
  });

  it('во весь экран список остаётся в дереве (скрыт), а не выбрасывается', () => {
    render(<Harness initial={{ id: 'A-1', place: 'full' }} />);
    const probe = screen.getByTestId('probe');
    expect(probe.closest('[hidden]')).toBeTruthy();
  });

  it('список на миг «не готов» и снова готов — тот же узел', () => {
    mounts = 0;
    const ui = (ready: boolean) => <ListWithRecord list={<ProbeList />} open={{ id: 'A-1', place: 'right' }} ready={ready}
      onOpen={() => {}} record={() => <p>запись</p>} />;
    const { rerender } = render(ui(true));
    const node = screen.getByTestId('probe');
    rerender(ui(false));
    rerender(ui(true));
    expect(screen.getByTestId('probe')).toBe(node);
    expect(mounts).toBe(1);
  });
});

describe('K4-PASSPORT-NO-LIST-RESET · ссылка на запись этого раздела — без загрузки страницы', () => {
  // jsdom не грузит страницы, но признак тот же, что у браузера: событие клика не отменено — значит
  // браузер пошёл бы по ссылке и перезагрузил документ целиком.
  const winAt = (search: string) => {
    window.history.replaceState(null, '', `/lore${search}`);
  };

  it('ссылка ?sec=<этот раздел>&open=… в паспорте и в списке открывает запись в доке; страница не грузится', () => {
    winAt('?sec=adr&q=x');
    const spy = vi.fn();
    render(<Harness initial={{ id: 'A-1', place: 'bottom' }} onOpenSpy={spy} />);
    const node = screen.getByTestId('probe');
    const inRecord = screen.getByText('связь A-3');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { inRecord.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(spy).toHaveBeenLastCalledWith({ id: 'A-3', place: 'bottom', kind: null });
    const inList = screen.getByText('ссылка на A-2');
    const ev2 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { inList.dispatchEvent(ev2); });
    expect(ev2.defaultPrevented).toBe(true);
    expect(spy).toHaveBeenLastCalledWith({ id: 'A-2', place: 'bottom', kind: null });
    expect(screen.getByTestId('probe')).toBe(node);
    expect(screen.getByTestId('rec').textContent).toContain('A-2');
  });

  it('другой раздел, внешний адрес, Ctrl/Cmd-клик, средняя кнопка — браузер решает сам', () => {
    winAt('?sec=adr');
    const spy = vi.fn();
    render(<Harness initial={{ id: null, place: 'right' }} onOpenSpy={spy} />);
    const fire = (el: Element, init: MouseEventInit) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      // не даём jsdom «ходить» по ссылке — проверяем только, отменил ли её kit
      const stop = (e: Event) => { if (!e.defaultPrevented) { e.preventDefault(); (e as MouseEvent & { _passed?: boolean })._passed = true; } };
      document.addEventListener('click', stop);
      act(() => { el.dispatchEvent(ev); });
      document.removeEventListener('click', stop);
      return (ev as MouseEvent & { _passed?: boolean })._passed === true;
    };
    expect(fire(screen.getByText('задача другого раздела'), { button: 0 })).toBe(true);
    expect(fire(screen.getByText('внешняя'), { button: 0 })).toBe(true);
    expect(fire(screen.getByText('ссылка на A-2'), { button: 0, ctrlKey: true })).toBe(true);
    expect(fire(screen.getByText('ссылка на A-2'), { button: 0, metaKey: true })).toBe(true);
    expect(fire(screen.getByText('ссылка на A-2'), { button: 1 })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
