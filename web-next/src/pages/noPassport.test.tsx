// @vitest-environment jsdom
// Раздел без паспорта отвечает СЛОВАМИ, а не пустотой
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// История этого файла — часть правила. Сначала карта паспортов была ПОЛНОЙ по
// экранам: она обещала паспорт каждому разделу, и щелчок по строке в
// «Технологиях» открывал пустой паспорт — человек читал это как «данные
// потерялись». Тогда карту сделали частичной, а разделам без паспорта дали
// ответ словами, и проверка шла на живых «Технологиях».
//
// 10.11.2026 фасад научился отдавать ещё три типа (component, tech, feature,
// серверный PR #1090), и разделов без паспорта в приложении НЕ ОСТАЛОСЬ. Это
// не повод снимать правило: следующий раздел появится раньше своего паспорта —
// так было уже дважды. Поэтому проверка больше не выбирает «раздел без
// паспорта» среди живых (такого нет), а держит два утверждения:
//
//  1. сегодня паспорт есть у КАЖДОГО раздела — это и есть достигнутое
//     состояние, и именно оно регрессирует молча;
//  2. отказ по-прежнему называет раздел, код записи и путь назад — на случай
//     раздела, который появится без паспорта.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from './ListScreen';
import { LIST_SCREENS } from '../lists/screens';
import { PASSPORT_TYPES } from '../record/passportAdapters';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Выдача среза технологий — форма из живого запроса. */
const TECH_ROWS = {
  rows: [{
    spec_id: 'SPEC-TECH-REACT', tech_name: 'React', version: '19.1.0',
    checked_at: '2026-11-01T00:00:00Z', component_id: 'FORSETI',
  }],
  truncated: false,
};

/** Окно со своей историей: раздел пишет состояние в него, а не в глобальное. */
function fakeWin(search = ''): UrlWindow {
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
      replaceState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
    },
  };
  function apply(url: string) {
    w.location.search = url.includes('?') ? url.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
  }
  return w as unknown as UrlWindow;
}

const net = (body: unknown) => vi.fn(async () => json(body)) as unknown as typeof fetch;

describe('паспорт есть у каждого раздела', () => {
  it('положительный контроль: список технологий нарисовался', async () => {
    render(<ListScreen screen="tech" fetchImpl={net(TECH_ROWS)} urlState={fakeWin()} />);
    expect(await screen.findByText('React', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('щелчок по строке «Технологий» больше не упирается в отказ', async () => {
    render(<ListScreen screen="tech" fetchImpl={net(TECH_ROWS)} urlState={fakeWin()} />);
    const row = await screen.findByText('React', {}, { timeout: 8000 });
    await act(async () => { fireEvent.click(row); });
    // Ждём, пока щелчок отработает, и убеждаемся: отказа нет.
    await waitFor(() => {
      expect(document.querySelector('.list-screen__nopassport'), 'раздел снова отвечает «паспорта нет»').toBeNull();
    }, { timeout: 8000 });
  });

  it('у каждого раздела есть тип паспорта, и этот тип фасад знает', async () => {
    const { PASSPORT_OF } = await import('./ListScreen');
    const sections = Object.keys(LIST_SCREENS);
    expect(sections.length, 'разделы не прочитались — проверка прошла бы мимо').toBeGreaterThan(5);
    const without = sections.filter(s => !(s in PASSPORT_OF));
    expect(without, 'раздел без паспорта: человек получит отказ вместо записи').toEqual([]);
    const unknown = Object.values(PASSPORT_OF).filter(t => !(PASSPORT_TYPES as readonly string[]).includes(t as string));
    expect(unknown, 'раздел ведёт на тип, которого фасад не отдаёт').toEqual([]);
  });
});
