// @vitest-environment jsdom
// Виды «Библиотека» и «Календарь» в разделах LORE
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-LIBRARY, SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-CALENDAR).
//
// В v1.17.15 kit выпустил оба вида, но в приложении их не подключил ни один
// раздел. Задача владелицы 11.11.2026: «доделать библиотеку, подключить новые
// виды к компонентам». Правила:
//   • «Библиотека» — у разделов-документов (компоненты, ADR, спеки, решения,
//     технологии); группы слева по полю, которое называет раздел, справа —
//     паспорт записи; устаревшее решает приложение;
//   • «Календарь» — только там, где у записи ЕСТЬ дата (не «время правки»):
//     спринты — план начала и факт закрытия, релизы — дата выпуска. Раздел без
//     даты календаря не получает: пустой календарь хуже его отсутствия;
//   • состояние вида — в адресе: ?lib=1&libo=<id>, у календаря ?lcd=<поле>.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { validateKitConfig } from '@seidr/kit/core';
import { LIST_SCREENS, type ListScreenId } from './screens';
import { libraryGroups, calendarField } from './library';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const ids = Object.keys(LIST_SCREENS) as ListScreenId[];

/** Строка «всё сразу»: все ключи и все столбцы дат, какие отдают срезы. */
const SINK: Record<string, unknown> = {
  sprint_id: 'X', adr_id: 'X', task_uid: 'X', decision_id: 'X', spec_id: 'X', question_id: 'X',
  milestone_id: 'X', release_uid: 'X', release_id: 'X', component_id: 'X', tech_id: 'X', uc_id: 'X',
  planned_start_date: '2026-11-02', planned_end_date: '2026-11-20', done_date: '2026-11-19',
  release_date: '2026-11-11', date_display: 'прогноз Q4 2026',
};

describe('K2-VIEW-CALENDAR · календарь — только у разделов с датой', () => {
  const WITH_CALENDAR: ListScreenId[] = ['sprints', 'releases'];

  it.each(ids)('%s: календарь есть ⇔ у раздела названа дата, и маппер её даёт', id => {
    const def = LIST_SCREENS[id];
    const cfg = def.config('ru');
    const has = cfg.list?.views.includes('calendar') ?? false;
    expect(has, `${id}: календарь`).toBe(WITH_CALENDAR.includes(id));
    if (!has) {
      expect(cfg.list?.calendar, `${id}: даты нет — поле выдумано`).toBeUndefined();
      return;
    }
    const dates = (def as { calendarDates?: readonly { field: string }[] }).calendarDates ?? [];
    expect(dates.length, `${id}: дата календаря не названа`).toBeGreaterThan(0);
    expect(cfg.list?.calendar?.date).toBe(dates[0].field);
    const rec = def.map(SINK);
    for (const d of dates) expect(rec.fields[d.field], `${id}.${d.field}: маппер не даёт дату`).toMatch(/^\d{4}-\d{2}-\d{2}/);
    const r = validateKitConfig(cfg);
    expect(r.errors.filter(e => e.path.startsWith('list.calendar') || e.code.startsWith('calendar'))).toEqual([]);
  });

  it('спринты: два поля даты — план начала и факт закрытия; выбор из адреса, чужое значение — умолчание', () => {
    const dates = LIST_SCREENS.sprints.calendarDates.map(d => d.field);
    expect(dates).toEqual(['planned_start', 'done_date']);
    expect(calendarField(LIST_SCREENS.sprints.calendarDates, 'done_date')).toBe('done_date');
    expect(calendarField(LIST_SCREENS.sprints.calendarDates, null)).toBe('planned_start');
    expect(calendarField(LIST_SCREENS.sprints.calendarDates, 'updated_at')).toBe('planned_start');
  });

  it('релизы: дата — дата выпуска (release_date), а не время правки записи', () => {
    expect(LIST_SCREENS.releases.config('ru').list?.calendar?.date).toBe('released');
    expect(LIST_SCREENS.releases.map({ release_uid: 'P#v1', release_date: '2026-11-11', changed_at: '2026-11-12T00:00:00Z' }).fields.released).toBe('2026-11-11');
  });
});

describe('K2-VIEW-LIBRARY · библиотека у разделов-документов', () => {
  const WITH_LIBRARY: ListScreenId[] = ['components', 'adrs', 'specs', 'decisions', 'tech'];

  it.each(ids)('%s: библиотека подключена ⇔ раздел-документ', id => {
    const lib = (LIST_SCREENS[id] as { library?: { groupBy: string } }).library;
    expect(!!lib, `${id}: библиотека`).toBe(WITH_LIBRARY.includes(id));
    // MP2-12: библиотека — ВИД в меню видов, а не соседняя кнопка.
    expect(LIST_SCREENS[id].config('ru').list?.views.includes('library'), `${id}: вид library`).toBe(WITH_LIBRARY.includes(id));
    if (lib) {
      // Разрез — поле, объявленное у вида записи: иначе группы подписаны ключом.
      const kind = Object.values(LIST_SCREENS[id].config('ru').kinds)[0];
      expect((kind.fields ?? []).map(f => f.key), `${id}: поле разреза ${lib.groupBy}`).toContain(lib.groupBy);
    }
  });

  it('компоненты: группы по области, «без области» — последней; устарел — область deprecated', () => {
    const def = LIST_SCREENS.components;
    const rows = [
      { component_id: 'LORE', full_name: 'LORE', area: 'platform' },
      { component_id: 'QG', full_name: 'Quality gates', area: 'platform' },
      { component_id: 'KIT', full_name: 'Seidr kit', area: 'frontend' },
      { component_id: 'SVC', full_name: 'Старые сервисы', area: 'deprecated' },
      { component_id: 'AIDA', full_name: 'AIDA', area: null },
    ];
    const recs = rows.map(r => def.map(r));
    const groups = libraryGroups(recs, def.library, def.config('ru'), 'Без области');
    expect(groups.map(g => g.title)).toEqual(['platform', 'deprecated', 'frontend', 'Без области']);
    expect(groups[0].docs.map(d => d.id)).toEqual(['LORE', 'QG']);
    expect(groups[0].docs[0].code).toBe('LORE');
    expect(groups.flatMap(g => g.docs).filter(d => d.stale).map(d => d.id)).toEqual(['SVC']);
  });

  it('ADR: устарел — статус закрытой категории (заменён, отклонён), состояние — словом статуса', () => {
    const def = LIST_SCREENS.adrs;
    const recs = [
      def.map({ adr_id: 'ADR-1', name: 'Один', status: 'accepted', component: 'LORE' }),
      def.map({ adr_id: 'ADR-2', name: 'Два', status: 'superseded', component: 'LORE' }),
    ];
    const [g] = libraryGroups(recs, def.library, def.config('ru'), 'Без компонента');
    expect(g.title).toBe('LORE');
    expect(g.docs.map(d => [d.id, d.stale, d.state])).toEqual([['ADR-1', false, 'Действует'], ['ADR-2', true, 'Заменён']]);
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function win(search: string) {
  const calls: string[] = [];
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url: string) => { calls.push(url); w.location.search = new URL(url, 'http://x').search; },
      replaceState: (_: unknown, __: string, url: string) => { calls.push(url); w.location.search = new URL(url, 'http://x').search; },
    },
  };
  return { w: w as unknown as UrlWindow, calls };
}

const COMPONENTS = {
  rows: [
    { component_id: 'LORE', full_name: 'LORE', area: 'platform' },
    { component_id: 'KIT', full_name: 'Seidr kit', area: 'frontend' },
  ],
  truncated: false,
};

function net(rows: unknown) {
  const paths: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    paths.push(url.pathname);
    if (url.pathname.endsWith('/_new')) return json({ perms: { can_create: false } });
    if (url.pathname.startsWith('/lore/record/')) return json({ error: 'NOT_FOUND' }, 404);
    if (url.pathname.startsWith('/lore/slice/') && !url.pathname.endsWith('/facets')) return json(rows);
    return json({ rows: [] });
  });
  return { fn: fn as unknown as typeof fetch, paths };
}

describe('K2-VIEW-LIBRARY · «Библиотека» открывается в разделе «Компоненты»', () => {
  it('MP2-12: «Библиотека» — вид в меню видов; выбор пишет lib=1 и lv=library, отдельной кнопки нет', async () => {
    const { fn } = net(COMPONENTS);
    const { w, calls } = win('');
    const { container } = render(<ListScreen screen="components" fetchImpl={fn} urlState={w} />);
    // Список дорисован (шапка движка списка, а не шапка загрузки) — тогда меню видов.
    const views = await screen.findByRole('radiogroup', { name: /Вид/ });
    expect(container.querySelector('[data-testid="list-library"]')).toBeNull();
    fireEvent.click(within(views).getByRole('radio', { name: 'Библиотека' }));
    await waitFor(() => expect(container.querySelector('.sk-lib')).not.toBeNull());
    expect(calls.some(u => /[?&]lib=1/.test(u))).toBe(true);
    expect(calls.some(u => /[?&]lv=library/.test(u))).toBe(true);
    // Обратно — тем же меню видов: «Список» возвращает движок списка и снимает lib.
    fireEvent.click(within(views).getByRole('radio', { name: 'Список' }));
    await waitFor(() => expect(container.querySelector('.sk-lib')).toBeNull());
    expect(w.location.search).not.toMatch(/lib=1/);
  });

  // K2-LIBRARY-DUP-PASSPORT, решение владелицы 14.11: «в библиотеке оставь только левую часть меню,
  // не дублируй второй раз компонент паспорта, а паспорт открывается обычно как для таблицы».
  // Панели чтения нет; выбор в дереве — ?open= (тот же механизм, что щелчок по строке списка);
  // на экране не больше одного паспорта.
  it('K2: вход в «Библиотеку» — только дерево, паспорт сам не открывается', async () => {
    const { fn, paths } = net(COMPONENTS);
    const { w } = win('?lib=1');
    const { container } = render(<ListScreen screen="components" fetchImpl={fn} urlState={w} />);
    await waitFor(() => expect(container.querySelector('.sk-lib')).not.toBeNull());
    expect(screen.getByRole('region', { name: 'platform' })).toBeTruthy();
    expect(container.querySelector('.sk-lib__reader')).toBeNull();
    expect(paths.some(p => p.startsWith('/lore/record/component/'))).toBe(false);
  });

  it('K2: выбор в дереве открывает обычный паспорт через ?open=, второго паспорта нет', async () => {
    const { fn, paths } = net(COMPONENTS);
    const { w, calls } = win('?lib=1');
    const { container } = render(<ListScreen screen="components" fetchImpl={fn} urlState={w} />);
    const frontend = await screen.findByRole('region', { name: 'frontend' });
    fireEvent.click(within(frontend).getByRole('button', { name: /KIT/ }));
    await waitFor(() => expect(calls.some(u => /[?&]open=KIT/.test(u))).toBe(true));
    expect(calls.some(u => /[?&]libo=/.test(u))).toBe(false);
    // Паспорт — ленивый модуль: под нагрузкой полного прогона он грузится дольше секунды.
    await waitFor(() => expect(paths).toContain('/lore/record/component/KIT'), { timeout: 5000 });
    expect(container.querySelector('.sk-lib__reader')).toBeNull();
    // Выбранный — отмечен в дереве.
    const current = container.querySelector('.sk-lib__doc[aria-current="true"]') as HTMLElement;
    expect(current.getAttribute('data-doc-id')).toBe('KIT');
  });

  it('K2: старая ссылка ?lib=1&libo=KIT — открывает тот же паспорт через ?open=', async () => {
    const { fn, paths } = net(COMPONENTS);
    const { w } = win('?lib=1&libo=KIT');
    render(<ListScreen screen="components" fetchImpl={fn} urlState={w} />);
    await waitFor(() => expect(w.location.search).toMatch(/[?&]open=KIT/));
    expect(w.location.search).not.toMatch(/libo=/);
    // Паспорт — ленивый модуль: под нагрузкой полного прогона он грузится дольше секунды.
    await waitFor(() => expect(paths).toContain('/lore/record/component/KIT'), { timeout: 5000 });
  });
});

const SPRINTS = {
  rows: [{
    sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '✅ DONE', git_projects: [], components: [],
    release_ids: [], milestone_ids: [], planned_start_date: '2026-11-02', done_date: '2026-11-19',
    changed_at: '2026-11-10T09:00:00.000Z',
  }],
  truncated: false,
};

describe('K2-VIEW-CALENDAR · календарь спринтов: дата названа и выбирается', () => {
  // Вид открывается переключателем: `?lv=calendar` kit пока не читает из адреса
  // (readListState знает board/tree/cards/feed/timeline) — это долг kit, в отчёте.
  it('вид «Календарь»: в шапке — выбор даты «план · факт», выбор пишет ?lcd=', async () => {
    const { fn } = net(SPRINTS);
    const { w, calls } = win('');
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fn} urlState={w} />);
    const views = await screen.findByRole('radiogroup', { name: /Вид/ });
    fireEvent.click(within(views).getByRole('radio', { name: 'Календарь' }));
    await waitFor(() => expect(container.querySelector('.sk-list[data-view="calendar"]')).not.toBeNull());
    const group = screen.getByRole('group', { name: 'Дата календаря' });
    const plan = within(group).getByRole('button', { name: 'План: начало' });
    expect(plan.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Факт: закрыт' }));
    await waitFor(() => expect(calls.some(u => /[?&]lcd=done_date/.test(u))).toBe(true));
    expect(within(group).getByRole('button', { name: 'Факт: закрыт' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('у списка (не календаря) выбора даты нет', async () => {
    const { fn } = net(SPRINTS);
    const { w } = win('');
    render(<ListScreen screen="sprints" fetchImpl={fn} urlState={w} />);
    await screen.findByRole('radiogroup', { name: /Вид/ });
    expect(screen.queryByRole('group', { name: 'Дата календаря' })).toBeNull();
  });
});
