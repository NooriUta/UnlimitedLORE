// @vitest-environment jsdom
// Выбор проектов в шапке ДОХОДИТ до списков (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
//
// Слова владелицы 09.11.2026: «и верхний фильтр по проектам не влияет на
// элементы внизу».
//
// ПРИЧИНА, а не симптом: `useProjectScope()` (web-next/src/scope/ProjectScope.tsx)
// не вызывал НИ ОДИН экран — греп по исходникам показывает только его
// объявление. Выбор доезжал до адреса (`?proj=a,b`) и дальше никуда: списки
// по-прежнему просили срез без сужения. То есть управление было, а действия у
// него не было — тот же класс «написано и не подключено», только снаружи он
// выглядит как «фильтр не работает».
//
// Серверная половина (сессия d8097ab4, PR #1053): `?scope_projects=a,b` у
// `/lore/slice/{id}` и `/count`, в ответе отметка
// `scope_projects: {requested, applied, dropped, note}`. Выбор пересекается с
// правами вызывающего; если ни один выбранный проект недоступен — 200 и
// `rows: []`, а не 403.
//
// Здесь закрепляется и ЧЕСТНОСТЬ: «сужено по проектам» и «по выбранным
// проектам ничего нет» — разные утверждения, и ни одно не должно выглядеть как
// «данных нет в системе».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';
import { sliceWarnings } from './records';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const ROW = { sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' };

/** Сеть, запоминающая адреса запросов: по ним и видно, дошёл ли выбор. */
function net(body: unknown = { rows: [ROW] }) {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return json(body);
  }) as unknown as typeof fetch;
  return { impl, urls };
}

/**
 * Выбор проектов в АДРЕСЕ — как после выбора в шапке.
 *
 * Пишем в настоящий адрес окна, а не подсовываем своё: выбор проектов
 * читается из параметра оболочки, и подмена объекта окна проверяла бы не то,
 * что работает на экране.
 */
const url = (search: string) => { window.history.replaceState(null, '', '/' + search); };

describe('S4-03 · выбор проектов доходит до среза', () => {
  it('положительный контроль: без выбора параметра сужения нет', async () => {
    url('');
    const { impl, urls } = net();
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await screen.findByText('Спринт SP', {}, { timeout: 8000 });
    expect(urls.some(u => u.includes('scope_projects'))).toBe(false);
  }, 15000);

  it('выбраны два проекта — они уходят в запрос среза', async () => {
    url('?proj=AIDA%2FminiLORE,NooriUta%2FUnlimitedLORE');
    const { impl, urls } = net();
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await screen.findByText('Спринт SP', {}, { timeout: 8000 });
    await waitFor(() => {
      const u = urls.find(x => x.includes('/slice/sprints'));
      expect(u, 'запрос среза').toBeTruthy();
      expect(decodeURIComponent(u!)).toContain('scope_projects=AIDA/miniLORE,NooriUta/UnlimitedLORE');
    });
  }, 15000);
});

describe('S4-03 · честность сужения: три разных утверждения', () => {
  it('срез не привязан к проектам (applied: false) — сказано словами', () => {
    const notes = sliceWarnings({
      rows: [],
      scope_projects: { requested: ['A'], applied: false, note: 'срез не привязан к проектам' },
    } as never);
    expect(notes.join(' ')).toMatch(/не привязан к проектам|сужение не применено/i);
  });

  it('объяснение в reason, note пуст (B11) — причина дочитана, а не заглушка', () => {
    const notes = sliceWarnings({
      rows: [],
      scope_projects: { requested: ['A'], applied: false, reason: 'срез releases не привязан к проектам — показано всё доступное' },
    } as never);
    expect(notes.join(' ')).toContain('показано всё доступное');
    expect(notes.join(' ')).not.toContain('этот срез не привязан к проектам');
  });

  it('note и reason вместе (B11) — сообщение одно, информативнее note', () => {
    const notes = sliceWarnings({
      rows: [],
      scope_projects: { requested: ['A'], applied: false, note: 'причина из note', reason: 'причина из reason' },
    } as never);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('причина из note');
  });

  it('dropped с серверным note (B11) — отброшенные названы один раз, без дубля', () => {
    const notes = sliceWarnings({
      rows: [ROW],
      scope_projects: { requested: ['A', 'B'], applied: true, dropped: ['B'], note: 'проекты вне ваших прав отброшены: B' },
    } as never);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('B');
  });

  it('часть проектов недоступна (dropped) — названы, а не отброшены молча', () => {
    const notes = sliceWarnings({
      rows: [ROW],
      scope_projects: { requested: ['A', 'B'], applied: true, dropped: ['B'] },
    } as never);
    expect(notes.join(' ')).toContain('B');
  });

  it('сужение применено и всё сошлось — лишних слов нет', () => {
    const notes = sliceWarnings({
      rows: [ROW],
      scope_projects: { requested: ['A'], applied: true, dropped: [] },
    } as never);
    expect(notes).toEqual([]);
  });
});
