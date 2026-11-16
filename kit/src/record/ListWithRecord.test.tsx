// @vitest-environment jsdom
// SPRINT_UXR_S14_KIT5/K5-LIST-WITH-RECORD: «список + запись» одним компонентом kit — правила, которые
// раньше жили только в web-next ListScreen (D-21, D-24, MP2-11, аудит 08.11).
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ListWithRecord, useRecordOpen, type OpenRecord } from './ListWithRecord';

/** Подменное окно: адрес и журнал переходов, без событий браузера. */
function fakeWin(search = '') {
  const calls: { url: string; replace: boolean }[] = [];
  const win = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: string, url: string) => { calls.push({ url, replace: false }); setUrl(url); },
      replaceState: (_s: unknown, _t: string, url: string) => { calls.push({ url, replace: true }); setUrl(url); },
    },
  };
  function setUrl(url: string) { const q = url.indexOf('?'); win.location.search = q >= 0 ? url.slice(q).split('#')[0] : ''; }
  return { win: win as never, calls, loc: win.location };
}

describe('useRecordOpen — запись в адресе', () => {
  it('читает open/place/okind; места нет — умолчание приложения', () => {
    const { win } = fakeWin('?open=T-1&okind=task');
    const { result } = renderHook(() => useRecordOpen({ win, defaultPlace: () => 'bottom' }));
    expect(result.current.open).toEqual({ id: 'T-1', place: 'bottom', kind: 'task' });
  });

  it('открыть — шаг истории; «справа» в адрес не пишется; листание — заменой', () => {
    const { win, calls, loc } = fakeWin('?sec=adr');
    const { result } = renderHook(() => useRecordOpen({ win, defaultPlace: () => 'right' }));
    act(() => result.current.setOpen({ id: 'A-1', place: 'right' }));
    expect(calls[calls.length - 1].replace).toBe(false);
    expect(loc.search).toContain('open=A-1');
    expect(loc.search).not.toContain('place=');
    act(() => result.current.setOpen({ id: 'A-2', place: 'right' }));
    expect(calls[calls.length - 1].replace).toBe(true);
  });

  it('закрыть — уходят место, вид и вкладка записи; фильтры списка остаются', () => {
    const { win, loc } = fakeWin('?sec=adr&q=x&open=A-1&place=bottom&okind=adr&tab=history');
    const { result } = renderHook(() => useRecordOpen({ win, defaultPlace: () => 'right' }));
    act(() => result.current.setOpen({ id: null, place: 'bottom' }));
    expect(loc.search).toContain('q=x');
    for (const k of ['open=', 'place=', 'okind=', 'tab=']) expect(loc.search, k).not.toContain(k);
    expect(result.current.backHref).not.toContain('open=');
  });
});

describe('ListWithRecord — раскладка', () => {
  const list = <ul data-testid="the-list"><li>строка</li></ul>;

  it('записи нет — только список; есть — док с записью, список под ним', () => {
    const { rerender } = render(<ListWithRecord list={list} open={{ id: null, place: 'right' }} onOpen={() => {}} record={() => <p>запись</p>} />);
    expect(screen.getByTestId('the-list')).toBeTruthy();
    expect(screen.queryByText('запись')).toBeNull();
    rerender(<ListWithRecord list={list} open={{ id: 'A-1', place: 'right' }} onOpen={() => {}} record={s => <p>запись {s.id}</p>} />);
    expect(screen.getByText('запись A-1')).toBeTruthy();
    expect(screen.getByTestId('the-list')).toBeTruthy();
  });

  it('список не готов — док не открывается', () => {
    render(<ListWithRecord list={list} open={{ id: 'A-1', place: 'right' }} ready={false} onOpen={() => {}} record={() => <p>запись</p>} />);
    expect(screen.queryByText('запись')).toBeNull();
  });

  it('из «во весь экран» — туда, откуда вошли (MP2-11)', () => {
    let open: OpenRecord = { id: 'A-1', place: 'bottom' };
    const onOpen = (n: OpenRecord) => { open = n; };
    const ui = (o: OpenRecord) => <ListWithRecord list={list} open={o} onOpen={onOpen} controls="dock"
      record={s => <button type="button" onClick={() => s.full?.()}>развернуть</button>} />;
    const { rerender } = render(ui(open));
    fireEvent.click(screen.getByText('развернуть'));
    expect(open.place).toBe('full');
    rerender(ui(open));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(open.place).toBe('bottom');
  });

  it('слот записи: листалка и закрытие идут через onOpen', () => {
    const seen: OpenRecord[] = [];
    render(<ListWithRecord list={list} open={{ id: 'A-1', place: 'right' }} onOpen={n => seen.push(n)}
      record={s => <><button type="button" onClick={() => s.go('A-2')}>дальше</button><button type="button" onClick={s.close}>закрыть</button></>} />);
    fireEvent.click(screen.getByText('дальше'));
    fireEvent.click(screen.getByText('закрыть'));
    expect(seen).toEqual([{ id: 'A-2', place: 'right' }, { id: null, place: 'right' }]);
  });
});

// Пилот 16.11: меню KitShell снимало ?open из адреса (pushUrlState), а хук оставался «открытым» —
// он слушал только popstate/hashchange. Любая запись адреса через kit оповещает хук.
describe('useRecordOpen — запись адреса через kit видна сразу', () => {
  it('pushUrlState снял open — запись закрыта; поставил — открыта', async () => {
    const { pushUrlState } = await import('../resilience/urlState');
    window.history.replaceState(null, '', '/?sec=adr&open=A-1');
    const { result } = renderHook(() => useRecordOpen({ win: window, defaultPlace: () => 'right' }));
    expect(result.current.open.id).toBe('A-1');
    act(() => { pushUrlState({ open: null }); });
    expect(result.current.open.id).toBeNull();
    act(() => { pushUrlState({ open: 'A-2', place: 'bottom' }); });
    expect(result.current.open).toMatchObject({ id: 'A-2', place: 'bottom' });
  });
});
