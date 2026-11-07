// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00c — честные состояния: Skeleton, EmptyState,
// LoadError, Forbidden, Truncated, LoadStateView и хук useLoadState. Каждый
// исход различим и по тексту, и по разметке (data-state), и проходит axe.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import {
  EmptyState, Forbidden, KitLangProvider, LoadError, LoadStateView, Skeleton, Truncated,
  hasGameIcon, registerGameIcons, useLoadState, STATE_ICONS,
} from '../index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

describe('иконки состояний есть в наборе (иначе — заглушка вместо знака)', () => {
  it('все слаги STATE_ICONS зарегистрированы', () => {
    for (const slug of Object.values(STATE_ICONS)) expect(hasGameIcon(slug), slug).toBe(true);
  });
});

describe('Skeleton — загрузка объявляется, а не рисуется молча', () => {
  it('role=status, aria-busy, подпись для чтения, полоски скрыты', async () => {
    const { container } = render(<Skeleton lines={3} />);
    const st = screen.getByRole('status');
    expect(st.getAttribute('aria-busy')).toBe('true');
    expect(st.getAttribute('data-state')).toBe('loading');
    expect(st.textContent).toContain('Загрузка');
    expect(st.querySelectorAll('.sk-skel__line')).toHaveLength(3);
    expect(st.querySelector('.sk-skel__line')?.getAttribute('aria-hidden')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('EmptyState / LoadError / Forbidden — три разных исхода', () => {
  it('пусто — «проверено», без role=alert', async () => {
    const { container } = render(<EmptyState />);
    const el = container.querySelector('[data-state="empty"]')!;
    expect(el.textContent).toMatch(/проверено/i);
    expect(el.getAttribute('role')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('пусто — свой заголовок, подсказка и действие', () => {
    render(<EmptyState title="Задач нет" hint="Слайс вернул 0" action={<button type="button">Сбросить</button>} />);
    expect(screen.getByText('Задач нет')).toBeTruthy();
    expect(screen.getByText('Слайс вернул 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сбросить' })).toBeTruthy();
  });

  it('ошибка — role=alert, деталь ошибки видна, «Повторить» зовёт onRetry', async () => {
    const onRetry = vi.fn();
    const { container } = render(<LoadError error={{ status: 502, message: 'Bad Gateway' }} onRetry={onRetry} />);
    const el = screen.getByRole('alert');
    expect(el.getAttribute('data-state')).toBe('error');
    expect(el.textContent).toMatch(/не смогли загрузить/i);
    expect(el.textContent).toContain('502');
    expect(el.textContent).toContain('Bad Gateway');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('ошибка без onRetry — кнопки нет (не обещаем то, чего нет)', () => {
    render(<LoadError error={new Error('x')} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('нет прав — «это не пусто», причина с бэкенда показывается', async () => {
    const { container } = render(<Forbidden reason="запись вне ваших проектов" />);
    const el = container.querySelector('[data-state="forbidden"]')!;
    expect(el.textContent).toMatch(/нет прав/i);
    expect(el.textContent).toMatch(/не «пусто»/);
    expect(el.textContent).toContain('запись вне ваших проектов');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('язык — из KitLangProvider (en)', () => {
    render(<KitLangProvider lang="en"><EmptyState /><Forbidden /></KitLangProvider>);
    expect(screen.getByText(/Empty \(checked\)/)).toBeTruthy();
    expect(screen.getByText(/No access/)).toBeTruthy();
  });
});

describe('Truncated — читает метаданные полноты S1', () => {
  it('полная выдача — ничего не рисует', () => {
    const { container } = render(<Truncated meta={{ page: { total: 3, has_more: false } }} shown={3} />);
    expect(container.innerHTML).toBe('');
  });

  it('страница — «Показано 1–50 из 180» и «Показать ещё»', async () => {
    const onMore = vi.fn();
    const { container } = render(
      <Truncated meta={{ page: { limit: 50, offset: 0, total: 180, has_more: true } }} shown={50} onMore={onMore} />,
    );
    const el = screen.getByRole('status');
    expect(el.getAttribute('data-state')).toBe('partial');
    expect(el.getAttribute('data-completeness')).toBe('paged');
    expect(el.textContent).toContain('1–50');
    expect(el.textContent).toContain('180');
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('потолок сервера — лимит и подсказка бэкенда', () => {
    render(<Truncated meta={{ truncated: true, limit: 1000, hint: 'сузьте запрос' }} shown={1000} />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('data-completeness')).toBe('capped');
    expect(el.textContent).toContain('1000');
    expect(el.textContent).toContain('сузьте запрос');
  });

  it('неизвестно — «проверить нечем»', () => {
    render(<Truncated meta={{ truncated: 'unknown' }} shown={1000} />);
    expect(screen.getByRole('status').textContent).toMatch(/проверить нечем/);
  });

  it('непроверенные поля при 0 строк — предупреждение', () => {
    render(<Truncated meta={{ page: { total: 0, fields_checked: false } }} shown={0} />);
    expect(screen.getByRole('status').getAttribute('data-completeness')).toBe('unverified');
  });
});

describe('useLoadState — хук над загрузкой', () => {
  it('loading → ok, rows и meta из тела слайса', async () => {
    const { result } = renderHook(() =>
      useLoadState(async () => ({ rows: [{ id: 1 }], page: { total: 1, has_more: false } }), []),
    );
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.rows).toEqual([{ id: 1 }]);
    expect(result.current.completeness).toEqual({ kind: 'complete', shown: 1 });
  });

  it('пустой массив — empty; 403 — forbidden; сбой — error; reload перезапускает', async () => {
    let n = 0;
    const load = vi.fn(async () => {
      n += 1;
      if (n === 1) throw Object.assign(new Error('Bad Gateway'), { status: 502 });
      if (n === 2) throw Object.assign(new Error('Forbidden'), { status: 403 });
      return [];
    });
    const { result } = renderHook(() => useLoadState(load, []));
    await waitFor(() => expect(result.current.state).toBe('error'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toBe('forbidden'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('обрезанная выдача — partial', async () => {
    const { result } = renderHook(() => useLoadState(async () => ({ rows: [1], truncated: true, limit: 1 }), []));
    await waitFor(() => expect(result.current.state).toBe('partial'));
    expect(result.current.completeness.kind).toBe('capped');
  });

  it('устаревший ответ (смена deps) не перетирает свежий; сигнал прошлого запроса отменён', async () => {
    const signals: AbortSignal[] = [];
    let resolveSlow!: (v: unknown) => void;
    const { result, rerender } = renderHook(({ k }) =>
      useLoadState(signal => {
        signals.push(signal);
        if (k === 'a') return new Promise(r => { resolveSlow = r; });
        return Promise.resolve({ rows: ['b'] });
      }, [k]), { initialProps: { k: 'a' } });
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.state).toBe('ok'));
    await act(async () => { resolveSlow({ rows: ['a'] }); });
    expect(result.current.rows).toEqual(['b']);
    expect(signals[0].aborted).toBe(true);
  });
});

describe('LoadStateView — один переключатель вместо ветвлений в каждом экране', () => {
  const base = { data: undefined, rows: undefined, error: undefined, reload: () => {} };

  it('рисует свой компонент на каждое состояние', () => {
    const child = vi.fn(() => <p>данные</p>);
    const { rerender, container } = render(
      <LoadStateView result={{ ...base, state: 'loading', completeness: { kind: 'complete', shown: 0 } }}>{child}</LoadStateView>,
    );
    expect(container.querySelector('[data-state="loading"]')).toBeTruthy();

    rerender(<LoadStateView result={{ ...base, state: 'empty', rows: [], completeness: { kind: 'complete', shown: 0 } }}>{child}</LoadStateView>);
    expect(container.querySelector('[data-state="empty"]')).toBeTruthy();

    rerender(<LoadStateView result={{ ...base, state: 'error', error: { status: 500 }, completeness: { kind: 'complete', shown: 0 } }}>{child}</LoadStateView>);
    expect(container.querySelector('[data-state="error"]')).toBeTruthy();

    rerender(<LoadStateView result={{ ...base, state: 'forbidden', error: { status: 403 }, completeness: { kind: 'complete', shown: 0 } }}>{child}</LoadStateView>);
    expect(container.querySelector('[data-state="forbidden"]')).toBeTruthy();
    expect(child).not.toHaveBeenCalled();

    rerender(<LoadStateView result={{ ...base, state: 'partial', rows: [1], data: { rows: [1] }, completeness: { kind: 'paged', shown: 1, offset: 0, total: 5 } }}>{child}</LoadStateView>);
    expect(container.querySelector('[data-state="partial"]')).toBeTruthy();
    expect(screen.getByText('данные')).toBeTruthy();

    rerender(<LoadStateView result={{ ...base, state: 'ok', rows: [1], data: { rows: [1] }, completeness: { kind: 'complete', shown: 1 } }}>{child}</LoadStateView>);
    expect(container.querySelector('[data-state="partial"]')).toBeNull();
    expect(screen.getByText('данные')).toBeTruthy();
  });

  it('forbidden из outside_scope несёт причину бэкенда', () => {
    render(
      <LoadStateView result={{ ...base, state: 'forbidden', data: { rows: [], outside_scope: { reason: 'вне ваших проектов' } }, rows: [], completeness: { kind: 'complete', shown: 0 } }}>
        {() => null}
      </LoadStateView>,
    );
    expect(screen.getByText(/вне ваших проектов/)).toBeTruthy();
  });
});
