// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P1: «Содержимое палитры: "Недавних пока
// нет" — ни команд, ни разделов».
//
// Разбор: палитра kit умеет команды (KitConfig.palette.commands), но v2 не дал
// ей ни одной — в палитру передавался конфиг без раздела palette. То есть
// пусто было честно, просто показывать было нечего.
//
// Первое, что палитра обязана уметь в LORE, — то же, что умеет меню: перейти в
// раздел. Разделы уже описаны в v2Config, поэтому команды не придумываются, а
// берутся из того же места, что и меню: один источник — одна правда.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons, useKitShell, type UrlWindow } from '@seidr/kit';
import { v2Config } from '../shell/v2Config';
import { SectionPalette } from './SectionPalette';

beforeAll(() => { registerGameIcons(gameIcons); });

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => {
        const s = String(url);
        w.location.search = s.includes('?') ? s.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
      },
      replaceState: (_s, _t, url) => w.history.pushState(null, '', url),
    },
  };
  return w;
}

const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

function mount(search = '') {
  const win = fakeWin(search);
  const storage = mem();
  render(
    <KitShell config={v2Config('ru')} win={win} storage={storage} narrow={false}
      topEnd={<SectionPalette storage={storage} />}>
      <p>экран</p>
    </KitShell>,
  );
  return win;
}

const openPalette = () => act(() => {
  fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
});

describe('палитра знает разделы', () => {
  it('положительный контроль: палитра открывается по Ctrl+K', () => {
    mount();
    openPalette();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('в палитре есть переходы по разделам, а не только «недавних нет»', () => {
    mount();
    openPalette();
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/Спринты/)).toBeTruthy();
    expect(within(dlg).getByText(/ADR/)).toBeTruthy();
  });

  it('команда уводит в раздел — тот же переход, что из меню', () => {
    const win = mount();
    openPalette();
    const dlg = screen.getByRole('dialog');
    act(() => { fireEvent.click(within(dlg).getByText(/Спринты/)); });
    expect(win.location.search).toMatch(/sec=sprint/);
  });

  it('поиск по названию раздела находит команду', () => {
    mount();
    openPalette();
    const input = screen.getByRole('combobox');
    act(() => { fireEvent.change(input, { target: { value: 'adr' } }); });
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/ADR/)).toBeTruthy();
  });
});

// Вторая половина находки аудита про «Недавнее»: палитра вела СВОЙ список и
// наполнялся он только тем, что открыли через саму палитру. Открытое из списка
// в неё не попадало — два списка недавнего, две правды о том, где человек был.
describe('«Недавнее» палитры — список оболочки', () => {
  function Opener() {
    const api = useKitShell();
    return (
      <button type="button" onClick={() => api.openRecord('SPRINT_A', { title: 'Спринт А', href: '/?open=SPRINT_A' })}>
        открыть запись
      </button>
    );
  }

  const mountWithOpener = () => {
    const win = fakeWin();
    const storage = mem();
    render(
      <KitShell config={v2Config('ru')} win={win} storage={storage} narrow={false}
        topEnd={<SectionPalette storage={storage} />}>
        <Opener />
      </KitShell>,
    );
    return win;
  };

  it('до открытия — честное «недавних пока нет»', () => {
    mountWithOpener();
    openPalette();
    expect(screen.getByRole('status').textContent).toMatch(/Недавних пока нет/);
  });

  it('открытая в приложении запись видна в палитре', () => {
    mountWithOpener();
    act(() => { screen.getByRole('button', { name: 'открыть запись' }).click(); });
    openPalette();
    const dlg = screen.getByRole('dialog');
    // Код виден и заголовком, и пилюлей кода — палитра о записи знает только его.
    expect(within(dlg).getAllByText('SPRINT_A').length).toBeGreaterThan(0);
  });
});
