// @vitest-environment jsdom
// Результат поиска открывает запись, а не «Новости»
// (аудит 09.11, находка P0 D-01 · SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14).
//
// Аудит намерил: выбор записи в палитре ведёт на `/?rec=ID`, и экран рисует
// «Новости». То есть поиск находит, а открыть найденное нельзя — тупик.
//
// Причина по коду: `LorePalette.defaultHref` строит `?rec=<id>`, а такого
// маршрута в v2 нет вовсе, поэтому оболочка показывает раздел по умолчанию.
//
// Как правильно: запись живёт в своём разделе и открывается параметром
// `?open=<id>` (его читает `ListScreen`). Значит палитра обязана увести в
// РАЗДЕЛ типа и попросить открыть запись там.
//
// Две ловушки, которые пришлось обойти (обе проверены по коду kit):
//   1. При смене раздела оболочка СНИМАЕТ параметры прежнего раздела
//      (`sectionScopedPatch`). Поэтому `open` пишется ПОСЛЕ перехода, иначе его
//      сотрёт.
//   2. Два `pushState` подряд дали бы две записи истории, и «назад» пришлось бы
//      жать дважды. Поэтому второй — заменой (`replace`), и «назад» возвращает
//      туда, откуда искали, с одного нажатия.
//
// И честность: разделов в v2 пока пять. Для типа без раздела запись НЕ
// открывается молча и не уводит в «Новости» — причина называется словами.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import { v2Config } from '../shell/v2Config';
import { SectionPalette } from './SectionPalette';

beforeAll(() => { registerGameIcons(gameIcons); });

/** Окно с историей: помним все записи, чтобы отличить push от replace. */
function fakeWin() {
  const pushes: string[] = [];
  const replaces: string[] = [];
  const w: UrlWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: {
      pushState: (_s, _t, url) => { pushes.push(String(url)); apply(String(url)); },
      replaceState: (_s, _t, url) => { replaces.push(String(url)); apply(String(url)); },
    },
  };
  function apply(url: string) {
    const s = url.includes('?') ? url.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
    w.location.search = s;
  }
  return { w, pushes, replaces };
}

const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

/** Поиск по серверу: отдаём одну запись заданного типа. */
const found = (type: string, id: string, title: string) => (async () =>
  new Response(JSON.stringify({ rows: [{ ref_id: id, type, title }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

function mount(fetchImpl: typeof fetch) {
  const { w, pushes, replaces } = fakeWin();
  const storage = mem();
  render(
    <KitShell config={v2Config('ru')} win={w} storage={storage} narrow={false}
      topEnd={<SectionPalette storage={storage} fetchImpl={fetchImpl} />}>
      <p>экран</p>
    </KitShell>,
  );
  return { w, pushes, replaces };
}

const openPalette = () => act(() => {
  fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
});

const search = async (q: string) => {
  const input = screen.getByRole('combobox');
  await act(async () => {
    fireEvent.change(input, { target: { value: q } });
    await new Promise(r => setTimeout(r, 350));
  });
};

describe('D-01 · результат поиска открывает запись в её разделе', () => {
  it('положительный контроль: найденная запись видна в палитре', async () => {
    mount(found('sprint', 'SPRINT_A', 'Спринт А'));
    openPalette();
    await search('спринт');
    expect(screen.getByRole('dialog').textContent).toContain('SPRINT_A');
  });

  it('спринт: уводит в раздел спринтов и открывает запись, а не «Новости»', async () => {
    const { w } = mount(found('sprint', 'SPRINT_A', 'Спринт А'));
    openPalette();
    await search('спринт');
    await act(async () => { fireEvent.click(screen.getByText('SPRINT_A')); });
    const p = new URLSearchParams(w.location.search);
    expect(p.get('sec')).toBe('sprint');
    expect(p.get('open')).toBe('SPRINT_A');
    expect(w.location.search).not.toContain('rec=');
  });

  it('задача: уводит в раздел задач — он появился вместе с разделами v2', async () => {
    const { w } = mount(found('task', 'SPRINT_A/A-1', 'Задача'));
    openPalette();
    await search('задача');
    await act(async () => { fireEvent.click(screen.getByText('SPRINT_A/A-1')); });
    const p = new URLSearchParams(w.location.search);
    expect(p.get('sec')).toBe('task');
    expect(p.get('open')).toBe('SPRINT_A/A-1');
  });

  it('«открыть» — одна запись истории: «назад» возвращает к поиску с одного нажатия', async () => {
    const { pushes, replaces } = mount(found('adr', 'ADR-1', 'Решение'));
    openPalette();
    await search('решение');
    const before = pushes.length;
    await act(async () => { fireEvent.click(screen.getByText('ADR-1')); });
    // Переход в раздел — одна новая запись; открытие записи — заменой.
    expect(pushes.length - before).toBe(1);
    expect(replaces.length).toBeGreaterThan(0);
  });

  it('тип без раздела: причина названа словами, и никуда не уводит', async () => {
    const { w } = mount(found('spec', 'SPEC-1', 'Спека'));
    openPalette();
    await search('спека');
    await act(async () => { fireEvent.click(screen.getByText('SPEC-1')); });
    expect(w.location.search).not.toContain('open=');
    expect(document.body.textContent).toMatch(/раздел/i);
    expect(document.body.textContent).toContain('spec');
  });
});
