// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-02 (+ S7A-06) — экран новостей v2 на kit: лента,
// разрезы, метрики, матрица, сгорание, честные состояния. Номера пунктов
// SPEC-LORE-UXR-NEWS-PARITY — в названиях тестов («Пn»). Все числа берутся
// из ответа сервера: тест сверяет, что нарисовано ровно присланное.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../../test/axe';
import { registerGameIcons } from '@seidr/kit';
import { KitLangProvider } from '@seidr/kit';
import { NEWS_FIXTURE, NewsActivity, NewsFeed, type NewsResponse, type NewsSource } from './index';
import { newsHrefV2 } from '../newsLinks';
import { StatusDictCtx } from '@seidr/kit';
import type { KitConfig } from '@seidr/kit';

beforeAll(() => { registerGameIcons(gameIcons); });

// Мультипроектная строка стоит в нескольких группах дня (П21) — берём первую.
const firstRow = (key: string) => screen.getAllByTestId(`news-row-${key}`)[0];
const last = (s: { calls: URLSearchParams[] }) => s.calls[s.calls.length - 1];

function clone(): NewsResponse { return JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse; }

function src(over: Partial<NewsSource> = {}, data: NewsResponse = clone()): NewsSource & { calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  return {
    kind: 'live',
    calls,
    load: vi.fn(async (p: URLSearchParams) => { calls.push(new URLSearchParams(p)); return data; }),
    setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })),
    ...over,
  };
}

async function mount(
  source: NewsSource,
  props: Partial<Parameters<typeof NewsFeed>[0]> = {},
  // Словарь статусов приложения: в приложении его даёт оболочка, здесь —
  // напрямую (S4-STATUS-AXIS-CONFIG). Не передан — словаря нет, и лента
  // честно рисует запас kit с пометкой.
  dict?: KitConfig['statuses']['items'],
) {
  const r = render(
    <KitLangProvider lang="ru">
      <StatusDictCtx.Provider value={dict}>
        <NewsFeed source={source} urlPrefix={null} timeZone="Europe/Moscow" {...props} />
      </StatusDictCtx.Provider>
    </KitLangProvider>,
  );
  await screen.findByTestId('news-feed-days');
  return r;
}

// S7A-12: фильтры — в панели «Фильтры», метрики — по «все метрики», сверка — по ⚠.
// Каждая функция — ровно одно действие от ленты.
const openFilters = () => fireEvent.click(screen.getByTestId('news-filters-btn'));
const openMetrics = () => fireEvent.click(screen.getByTestId('news-strip-toggle'));
const day = (d: string) => screen.getByTestId(`news-day-${d}`);
const dayBtn = (d: string) => within(day(d)).getByRole('button', { name: new RegExp(d.split('-').reverse().slice(0, 2).join('\\.')) });

describe('S7A-02 · лента: дни, строки, время', () => {
  it('П3: дни новые сверху; открыты первые два, остальные свёрнуты; заголовок — кнопка (Enter/пробел нативно, П29)', async () => {
    await mount(src());
    const order = screen.getAllByTestId(/^news-day-\d/).map(n => n.dataset.day);
    expect(order).toEqual(['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05']);
    expect(dayBtn('2026-11-08').getAttribute('aria-expanded')).toBe('true');
    expect(dayBtn('2026-11-07').getAttribute('aria-expanded')).toBe('true');
    expect(dayBtn('2026-11-06').getAttribute('aria-expanded')).toBe('false');
    expect(dayBtn('2026-11-06').tagName).toBe('BUTTON');
    fireEvent.click(dayBtn('2026-11-06'));
    expect(dayBtn('2026-11-06').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(dayBtn('2026-11-07'));
    expect(dayBtn('2026-11-07').getAttribute('aria-expanded')).toBe('false');
  });

  it('П5: итог дня — из ответа сервера (матрица), «события · элементы»', async () => {
    await mount(src());
    expect(within(day('2026-11-07')).getByTestId('news-day-total').textContent).toBe('6 · 5');
  });

  it('порядок «старые сверху» переворачивает дни (без пересчёта)', async () => {
    await mount(src());
    openFilters();
    fireEvent.click(screen.getByRole('radio', { name: /старые сверху/i }));
    const order = screen.getAllByTestId(/^news-day-\d/).map(n => n.dataset.day);
    expect(order).toEqual(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  });

  it('П1, П2, П11: тег события и иконка типа, время местное и машины рядом (D-2026-UXR-NEWS-V2-RULES п. 3)', async () => {
    await mount(src());
    const row = firstRow('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07');
    expect(row.dataset.type).toBe('task');
    expect(row.querySelector('[data-kind-tag="ready"]')?.textContent).toMatch(/готово к выкатке/);
    expect(row.querySelector('[data-kind-tag="ready"]')?.getAttribute('data-tone')).toBe('wrn');
    expect(within(row).getByTestId('news-time-local').textContent).toBe('17:42');
    expect(within(row).getByTestId('news-time-utc').textContent).toMatch(/14:42 UTC/);
  });

  it('П18: у записи «только дата» время не рисуется и не выдумывается', async () => {
    await mount(src());
    const row = screen.getByTestId('news-row-release:v1.16.0|released|2026-11-07');
    expect(within(row).queryByTestId('news-time-local')).toBeNull();
    expect(within(row).getByTestId('news-time-none').textContent).toMatch(/без времени/);
  });

  it('местный день ≠ день машины: время UTC — с датой', async () => {
    await mount(src());
    fireEvent.click(dayBtn('2026-11-06'));
    const row = screen.getByTestId('news-row-sprint:SPRINT_AIDA_X|created|2026-11-06');
    expect(within(row).getByTestId('news-time-utc').textContent).toMatch(/05\.11 22:30 UTC/);
  });

  it('П17: «будущее» — пометка с подсказкой', async () => {
    await mount(src());
    const row = screen.getByTestId('news-row-release:v1.17.0|released|2026-11-08');
    const fut = within(row).getByText('будущее');
    expect(fut.getAttribute('title')).toMatch(/позже/);
  });

  it('×N свёртки (mult) и статус «откуда → куда»', async () => {
    await mount(src());
    const row = firstRow('task:SPRINT_UXR_S7A_NEWS/S7A-04|closed|2026-11-07');
    expect(within(row).getByTestId('news-mult').textContent).toBe('×2');
    expect(row.textContent).toMatch(/ready_for_deploy → done/);
  });

  it('П21 (исправление): мультипроектное событие стоит в ОБЕИХ группах дня, с меткой ×N', async () => {
    await mount(src());
    const d = day('2026-11-07');
    const ul = within(d).getByTestId('news-bucket-NooriUta/UnlimitedLORE');
    const vo = within(d).getByTestId('news-bucket-NooriUta/volva');
    const key = 'news-row-task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07';
    expect(within(ul).getByTestId(key)).toBeTruthy();
    expect(within(vo).getByTestId(key)).toBeTruthy();
    expect(within(within(ul).getByTestId(key)).getByTestId('news-groups-n').textContent).toBe('×2');
  });

  it('П4: группа внутри дня сворачивается кнопкой', async () => {
    await mount(src());
    const ul = within(day('2026-11-07')).getByTestId('news-bucket-NooriUta/UnlimitedLORE');
    const btn = within(ul).getByRole('button', { name: /UnlimitedLORE/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(within(ul).queryByTestId('news-row-spec:SPEC-LORE-UXR-NEWS-ALGORITHMS|version|2026-11-07')).toBeNull();
  });
});

describe('S7A-02 · клик по строке (П12, П24, П29)', () => {
  it('задача и спека — ссылки на запись; ссылку строит hrefOf', async () => {
    await mount(src());
    const task = firstRow('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07');
    // Основная ссылка строки — первая; вторая — код записи справа (09.11), ведёт туда же.
    const [a, code] = within(task).getAllByRole('link');
    expect(code.getAttribute('href')).toBe(a.getAttribute('href'));
    const ev = NEWS_FIXTURE.events.find(e => e.key === 'task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07')!;
    expect(a.getAttribute('href')).toBe(newsHrefV2(ev));
    const spec = screen.getByTestId('news-row-spec:SPEC-LORE-UXR-NEWS-ALGORITHMS|version|2026-11-07');
    expect(within(spec).getAllByRole('link')[0].getAttribute('href')).toMatch(/SPEC-LORE-UXR-NEWS-ALGORITHMS/);
  });

  it('onOpen: Enter и пробел на строке открывают запись (дефект v1 исправлен)', async () => {
    const onOpen = vi.fn();
    await mount(src(), { onOpen });
    // День 06.11 — третий, свёрнут: открываем.
    fireEvent.click(dayBtn('2026-11-06'));
    const link = within(screen.getByTestId('news-row-adr:ADR-LORE-045|changed|2026-11-06')).getAllByRole('link')[0];
    fireEvent.keyDown(link, { key: ' ' });
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen.mock.calls[0][0].el).toBe('ADR-LORE-045');
  });
});

describe('S7A-02 · строка «фильтр / группировка / порядок»', () => {
  it('смена группировки — новый запрос с group_by; заголовки групп дня — по новой оси', async () => {
    const s = src();
    await mount(s);
    openFilters();
    fireEvent.click(screen.getByTestId('news-group-opt-type'));
    await waitFor(() => expect(last(s).get('group_by')).toBe('type'));
  });

  it('фильтр по проекту — параметр запроса; снимается «Сбросить»', async () => {
    const s = src();
    await mount(s);
    openFilters();
    fireEvent.click(within(screen.getByTestId('news-filter-project')).getByRole('button', { name: /volva/ }));
    await waitFor(() => expect(last(s).get('project')).toBe('NooriUta/volva'));
    expect(screen.getByTestId('news-desc').textContent).toMatch(/Проект: volva/);
    fireEvent.click(within(screen.getByTestId('news-desc')).getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(last(s).has('project')).toBe(false));
  });

  it('чипы типов в полосе несут числа сервера (by_type), а не подсчёт клиента', async () => {
    await mount(src());
    const chip = screen.getByTestId('news-type-chip-task');
    expect(chip.textContent).toMatch(/задачаs*6/);
    expect(chip.getAttribute('title')).toMatch(/6 · 5/);
  });

  it('чип типа — фильтр type; повторное нажатие снимает', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(screen.getByTestId('news-type-chip-task'));
    await waitFor(() => expect(last(s).get('type')).toBe('task'));
    fireEvent.click(screen.getByTestId('news-type-chip-task'));
    await waitFor(() => expect(last(s).has('type')).toBe(false));
  });

  it('панель «Фильтры» закрывается Esc; число на кнопке — сколько настроек изменено', async () => {
    await mount(src());
    openFilters();
    fireEvent.click(screen.getByTestId('news-group-opt-type'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('news-sheet')).toBeNull();
    expect(screen.getByTestId('news-filters-btn').textContent).toMatch(/1/);
  });

  it('все оси S7A-02 в группировке; автор помечен «ждёт S2-12», пока автор не хранится', async () => {
    await mount(src());
    openFilters();
    const values = screen.getAllByTestId(/^news-group-opt-/).map(o => o.dataset.testid!.replace('news-group-opt-', ''));
    // S9-11: + «по записи» — свёртка событий одной записи.
    expect(values).toEqual(['project', 'component', 'type', 'kind', 'sprint', 'milestone', 'author', 'who', 'day', 'record']);
    expect(screen.getByTestId('news-group-opt-author').textContent).toMatch(/автор.*S2-12/i);
  });

  it('период и пояс — переключатели; запрос несёт days и tz', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(screen.getByRole('radio', { name: 'Месяц' }));
    await waitFor(() => expect(last(s).get('days')).toBe('30'));
    openFilters();
    fireEvent.click(screen.getByRole('radio', { name: /UTC/ }));
    await waitFor(() => expect(last(s).get('tz')).toBe('UTC'));
  });

  it('клик по группе в разрезе — фильтр этой группы (filter-дескриптор сервера)', async () => {
    const s = src();
    await mount(s);
    openMetrics();
    fireEvent.click(within(screen.getByTestId('news-groups')).getByRole('button', { name: /^AIDA/ }));
    await waitFor(() => expect(last(s).get('project')).toBe('NooriUta/AIDA'));
  });
});

describe('S7A-02 · разрезы и метрики: только числа сервера', () => {
  it('группы: Σ групп ≠ итог ∪ — метка Σ≠∪, M и ×N', async () => {
    await mount(src());
    const g = screen.getByTestId('news-groups');
    expect(within(g).getByTestId('news-groups-sum').textContent).toMatch(/15 · 13/);
    expect(within(g).getByTestId('news-groups-total').textContent).toMatch(/12 · 11/);
    expect(within(g).getByTestId('news-sigma-ne-union')).toBeTruthy();
    expect(within(g).getByTestId('news-groups-m').textContent).toMatch(/2/);
    expect(within(g).getByTestId('news-group-NooriUta/volva').textContent).toMatch(/×2/);
  });

  it('если Σ = ∪, метки нет', async () => {
    const d = clone();
    d.groups.sum = { ...d.groups.total };
    await mount(src({}, d));
    expect(within(screen.getByTestId('news-groups')).queryByTestId('news-sigma-ne-union')).toBeNull();
  });

  it('сгорание: новое и старое правило, поправка выкатки — отдельным параметром, «ждёт выкатки» жёлтым', async () => {
    await mount(src());
    const m = screen.getByTestId('news-metrics');
    expect(within(m).getByTestId('news-kpi-burn').textContent).toMatch(/\+3/);
    expect(within(m).getByTestId('news-kpi-burn-dict').textContent).toMatch(/\+4/);
    expect(within(m).getByTestId('news-kpi-ship-correction').textContent).toMatch(/−1/);
    const y = within(m).getByTestId('news-kpi-waiting');
    expect(y.dataset.tone).toBe('wrn');
    expect(y.textContent).toMatch(/2 → 3/);
    expect(within(m).getByTestId('news-kpi-ship-unknown').dataset.tone).toBe('wrn');
    expect(within(m).getByTestId('news-kpi-react').textContent).toMatch(/1 · 1/);
    expect(within(m).getByTestId('news-kpi-react').textContent).toMatch(/25 %/);
  });

  it('дельта к прошлому периоду — из ответа; процент только когда сервер его дал', async () => {
    await mount(src());
    const m = screen.getByTestId('news-metrics');
    expect(within(m).getByTestId('news-kpi-events').textContent).toMatch(/\+3/);
    expect(within(m).getByTestId('news-kpi-events').textContent).toMatch(/33,3 %/);
    expect(within(m).getByTestId('news-kpi-waiting').textContent).not.toMatch(/%/);
  });

  it('неизмеримое — «не измерить» с причиной, а не ноль (агенты до S2-12)', async () => {
    await mount(src());
    const a = screen.getByTestId('news-kpi-agents');
    expect(a.dataset.state).toBe('unmeasurable');
    expect(a.textContent).toMatch(/S2-12/);
    expect(a.textContent).not.toMatch(/\b0\b/);
  });

  it('сгорание по группам: своё / общее; Σ своих + ∪ общих = итог — числа сервера', async () => {
    await mount(src());
    const b = screen.getByTestId('news-burn');
    expect(within(b).getByTestId('news-burn-row-NooriUta/UnlimitedLORE').textContent).toMatch(/\+2.*\+1.*\+1/);
    expect(within(b).getByTestId('news-burn-sigma').textContent).toMatch(/\+2.*\+1.*\+3/);
  });

  it('сгорание по дням — таблица сервера', async () => {
    await mount(src());
    openMetrics();
    const b = screen.getByTestId('news-burn-days');
    expect(within(b).getAllByRole('row')).toHaveLength(4);
  });

  it('если история задач недоступна — причина вместо сгорания', async () => {
    const d = clone();
    d.metrics.tasks = { available: false, reason: 'история задач недоступна — см. meta.errors' };
    await mount(src({}, d));
    expect(screen.getByTestId('news-burn').textContent).toMatch(/история задач недоступна/);
  });

  it('матрица «дни × проекты»: клетки «события · элементы», Σ≠∪ в строке дня, итог столбца', async () => {
    await mount(src());
    openMetrics();
    const mx = screen.getByTestId('news-matrix');
    expect(within(mx).getByRole('columnheader', { name: 'UnlimitedLORE' })).toBeTruthy();
    const row = within(mx).getByTestId('news-matrix-row-2026-11-07');
    expect(row.textContent).toMatch(/6 · 5/);
    expect(within(row).getByTestId('news-sigma-ne-union')).toBeTruthy();
    expect(within(within(mx).getByTestId('news-matrix-row-2026-11-06')).queryByTestId('news-sigma-ne-union')).toBeNull();
    expect(within(mx).getByTestId('news-matrix-cols').textContent).toMatch(/8 · 7/);
  });

  it('число столбцов матрицы — параметр запроса matrix', async () => {
    const s = src();
    await mount(s);
    openMetrics();
    fireEvent.click(within(screen.getByTestId('news-matrix')).getByRole('radio', { name: '10' }));
    await waitFor(() => expect(last(s).get('matrix')).toBe('10'));
  });

  it('знания: очередь ADR — диапазоном, пока нет истории статуса', async () => {
    await mount(src());
    const k = screen.getByTestId('news-knowledge');
    expect(k.textContent).toMatch(/4…6/);
    expect(k.textContent).toMatch(/S2-10/);
  });
});

describe('S7A-02 · «прочитано» (П9, черта на сервере S7A-04)', () => {
  it('«С прошлого раза» — событиями из ответа; кнопка сдвигает черту к самой свежей строке', async () => {
    const s = src();
    await mount(s);
    expect(screen.getByTestId('news-since').textContent).toMatch(/1/);
    expect(firstRow('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07').dataset.unread).toBe('true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Прочитано' })); });
    expect(s.setReadMark).toHaveBeenCalledWith('2026-11-07T14:42:00Z');
    await waitFor(() => expect(s.calls.length).toBe(2));
  });

  it('черта недоступна (схема после S2) — честно, кнопка выключена', async () => {
    const d = clone();
    d.meta.read_mark = { state: 'unavailable', at: null, error: 'нет типа' };
    delete d.metrics.since_mark;
    await mount(src({}, d));
    expect(screen.getByRole('button', { name: 'Прочитано' })).toHaveProperty('disabled', true);
    expect(screen.getByTestId('news-mark-unavailable').textContent).toMatch(/недоступн/);
  });
});

describe('S7A-02 · честные состояния (П13, П16, S7A-07)', () => {
  it('ошибка загрузки — причина и «Повторить» перезапрашивает', async () => {
    let n = 0;
    const s = src({ load: vi.fn(async () => { n++; if (n === 1) throw Object.assign(new Error('LORE_UPSTREAM'), { status: 502 }); return clone(); }) });
    render(<KitLangProvider lang="ru"><NewsFeed source={s} urlPrefix={null} timeZone="UTC" /></KitLangProvider>);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/502/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await screen.findByTestId('news-feed-days');
  });

  it('403 SCOPE_EMPTY — «нет прав», а не «ничего не произошло»', async () => {
    const s = src({ load: vi.fn(async () => { throw Object.assign(new Error('SCOPE_EMPTY'), { status: 403 }); }) });
    render(<KitLangProvider lang="ru"><NewsFeed source={s} urlPrefix={null} timeZone="UTC" /></KitLangProvider>);
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).not.toBeNull());
  });

  it('П26: ответ без events — ошибка контракта, а не пустая лента', async () => {
    const s = src({ load: vi.fn(async () => ({ groups: {}, metrics: {}, meta: {} }) as unknown as NewsResponse) });
    render(<KitLangProvider lang="ru"><NewsFeed source={s} urlPrefix={null} timeZone="UTC" /></KitLangProvider>);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/events/);
  });

  it('meta.state=empty — пустое состояние (проверенный ноль), а не ошибка', async () => {
    const d = clone();
    d.events = []; d.meta.state = 'empty'; d.groups.list = [];
    const s = src({}, d);
    render(<KitLangProvider lang="ru"><NewsFeed source={s} urlPrefix={null} timeZone="UTC" /></KitLangProvider>);
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('partial: недоступный источник назван, лента не выдаётся за полную', async () => {
    const d = clone();
    d.meta.state = 'partial';
    d.meta.errors = [{ source: 'task_history', error: 'timeout', critical: true }];
    await mount(src({}, d));
    const b = screen.getByTestId('news-partial');
    expect(b.textContent).toMatch(/task_history/);
    expect(b.textContent).toMatch(/timeout/);
  });

  it('валидация: провал — красным; «не смогли проверить» (ok=null) — жёлтым, отдельно', async () => {
    const d = clone();
    d.meta.validation.ok = false;
    d.meta.validation.checks[0].ok = false;
    await mount(src({}, d));
    expect(screen.queryByTestId('news-validation')).toBeNull();
    const btn = screen.getByTestId('news-valid-btn');
    expect(btn.dataset.tone).toBe('dng');
    fireEvent.click(btn);
    const v = screen.getByTestId('news-validation');
    expect(v.querySelector('[data-check-state="fail"]')?.textContent).toMatch(/N_ev/);
    expect(v.querySelector('[data-check-state="unknown"]')?.textContent).toMatch(/выкатка/);
  });

  it('обрезано — сказано явно', async () => {
    const d = clone();
    d.meta.truncated = true;
    await mount(src({}, d));
    expect(screen.getByTestId('news-truncated')).toBeTruthy();
  });

  it('фикстура (эндпоинт ещё не на стенде) — помечена, не выдаёт себя за живые данные', async () => {
    await mount(src({ kind: 'fixture' }));
    expect(screen.getByTestId('news-fixture-badge')).toBeTruthy();
  });
});

describe('S7A-06 · «Активность» в паспорте — та же лента kit с фиксированным разрезом', () => {
  it('разрез спринта уходит в запрос и не снимается пользователем', async () => {
    const s = src();
    render(<KitLangProvider lang="ru"><NewsActivity source={s} scope={{ sprint: 'SPRINT_X' }} timeZone="UTC" /></KitLangProvider>);
    await screen.findByTestId('news-feed-days');
    expect(s.calls[0].get('sprint')).toBe('SPRINT_X');
    expect(screen.queryByLabelText('Спринт')).toBeNull();
    expect(screen.getByTestId('news-scope').textContent).toMatch(/SPRINT_X/);
  });

  it('разрез релиза — по элементу релиза (оси «релиз» в контракте нет)', async () => {
    const s = src();
    render(<KitLangProvider lang="ru"><NewsActivity source={s} scope={{ release: 'v1.16.0' }} timeZone="UTC" /></KitLangProvider>);
    await screen.findByTestId('news-feed-days');
    expect(s.calls[0].get('els')).toBe('release:v1.16.0');
  });
});

describe('S7A-02 · доступность', () => {
  it('axe без нарушений на полном экране', async () => {
    const { container } = await mount(src());
    expect(await axeViolations(container)).toEqual([]);
  });

  it('en: подписи на английском', async () => {
    render(<KitLangProvider lang="en"><NewsFeed source={src()} urlPrefix={null} timeZone="UTC" /></KitLangProvider>);
    await screen.findByTestId('news-feed-days');
    fireEvent.click(screen.getByTestId('news-filters-btn'));
    expect(screen.getByRole('radiogroup', { name: 'Group by' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeTruthy();
  });
});

// S4-23: «Новости» стали первым разделом v2 — лента внутри раздела (title=null) не должна
// давать второй ориентир с тем же именем, что h1 раздела (axe landmark-unique).
describe('лента внутри раздела (title=null)', () => {
  it('корень — не именованный region, а блок', async () => {
    const { container } = await mount(src(), { title: null });
    expect(container.querySelector('section.sk-news')).toBeNull();
    expect(container.querySelector('div.sk-news')).not.toBeNull();
  });
});

describe('S7A-12 v2 · мини-график, быстрые фильтры, день — полоса баланса (выбор владелицы 09.11)', () => {
  it('мини-график: столбик на каждый день периода из tasks.days; день без данных — «нет данных», а не ноль', async () => {
    await mount(src());
    const spark = screen.getByTestId('news-spark');
    expect(within(spark).getAllByRole('button').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('news-spark-2026-11-07').dataset.tone).toBe('suc');
    expect(screen.getByTestId('news-spark-2026-11-05').dataset.state).toBe('zero');
    const none = screen.getByTestId('news-spark-2026-11-08');
    expect(none.dataset.state).toBe('none');
    expect(none.getAttribute('aria-label')).toMatch(/нет данных/);
  });

  it('мини-график: нажатие на столбик раскрывает свёрнутый день', async () => {
    await mount(src());
    expect(dayBtn('2026-11-05').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId('news-spark-2026-11-05'));
    await waitFor(() => expect(dayBtn('2026-11-05').getAttribute('aria-expanded')).toBe('true'));
  });

  it('мини-графика нет, если сгорание не посчитано (не рисуем пустые нули)', async () => {
    const data = clone();
    (data.metrics as { tasks: unknown }).tasks = { available: false, reason: 'нет источника' };
    await mount(src({}, data));
    expect(screen.queryByTestId('news-spark')).toBeNull();
  });

  it('быстрые фильтры наверху: Проект/Компонент/Кто — одно нажатие открывает варианты, выбор уходит на сервер', async () => {
    const s = src();
    await mount(s);
    for (const a of ['project', 'component', 'who']) expect(screen.getByTestId(`news-facet-${a}`)).toBeTruthy();
    const btn = screen.getByTestId('news-facet-project');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const pop = screen.getByTestId('news-facet-pop-project');
    fireEvent.click(within(pop).getAllByRole('button')[0]);
    await waitFor(() => expect(last(s).has('project')).toBe(true));
    expect(screen.queryByTestId('news-facet-pop-project')).toBeNull();
    expect(screen.getByTestId('news-facet-project').dataset.on).toBe('true');
  });

  it('«Кто» — вид (люди/агенты) и конкретное имя со счётом сервера by_who; выбор имени уходит параметром who', async () => {
    const data = clone();
    data.metrics.counts.by_who = { volva: { events: 4, elements: 3 }, '(unknown)': { events: 1, elements: 1 } };
    const s = src({}, data);
    await mount(s);
    fireEvent.click(screen.getByTestId('news-facet-who'));
    expect(within(screen.getByTestId('news-facet-opts-author')).getAllByRole('button').length).toBe(3);
    const names = screen.getByTestId('news-facet-opts-who');
    expect(names.textContent).toContain('автор неизвестен');
    const volva = within(names).getByRole('button', { name: /volva/ });
    expect(volva.textContent).toContain('4 · 3');
    fireEvent.click(volva);
    await waitFor(() => expect(last(s).get('who')).toBe('volva'));
    expect(screen.getByTestId('news-facet-who').textContent).toContain('volva');
  });

  it('«Кто» без by_who (старый сервер) — имена из строк ленты, без чисел; Esc закрывает', async () => {
    await mount(src());
    fireEvent.click(screen.getByTestId('news-facet-who'));
    const names = screen.getByTestId('news-facet-opts-who');
    // В фикстуре who не заполнен ни у одной строки — честно «автор неизвестен», без выдуманного числа.
    const unknown = within(names).getByRole('button', { name: /автор неизвестен/ });
    expect(unknown.querySelector('.sk-news__n')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('news-facet-pop-who')).toBeNull();
  });

  it('фиксированный разрез паспорта не даёт снять себя быстрым фильтром', async () => {
    await mount(src(), { scope: { project: 'UnlimitedLORE' } });
    expect(screen.queryByTestId('news-facet-project')).toBeNull();
    expect(screen.getByTestId('news-facet-component')).toBeTruthy();
  });

  it('счёт на чипе типа подписан «за период» — это не размер корпуса', async () => {
    await mount(src());
    expect(screen.getByTestId('news-type-chip-task').getAttribute('title')).toMatch(/за период/);
  });

  it('день — полоса «закрыто против заведено» с подписью для читалки', async () => {
    await mount(src());
    const d = day('2026-11-07');
    const bar = d.querySelector('.sk-news__balbar')!;
    expect(bar.getAttribute('role')).toBe('img');
    expect(bar.getAttribute('aria-label')).toMatch(/закрыто · \d+ заведено задач/);
    expect(within(d).getByTestId('news-cube-burn').textContent).toContain('+2');
  });
});

describe('S7A-12 · строка ленты: код — переход, без повтора, статусы значками (владелица 09.11)', () => {
  // «в правой стороне новостей нет переходов у кодов; для спек код повторяется,
  // может излишне, хотя копировать приятно; переход статусов невыделенным
  // шрифтом написан — может значками сделать?»
  it('код записи справа — ссылка на запись, рядом «скопировать»', async () => {
    await mount(src());
    const row = firstRow('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07');
    const code = within(row).getByTestId('news-code');
    expect(code.tagName).toBe('A');
    expect(code.getAttribute('href')).toBeTruthy();
    expect(code.textContent).toBe('SPRINT_UXR_S7A_NEWS/S7A-02');
    expect(within(row).getByTestId('news-copy').getAttribute('aria-label')).toMatch(/SPRINT_UXR_S7A_NEWS\/S7A-02/);
  });

  it('если заголовок и есть код — код второй раз не пишется, копирование остаётся', async () => {
    const data = clone();
    const ev = data.events.find(e => e.type === 'spec')!;
    ev.title = ev.el;
    await mount(src({}, data));
    const row = firstRow(ev.key);
    expect(within(row).queryByTestId('news-code')).toBeNull();
    expect(within(row).getByTestId('news-copy')).toBeTruthy();
  });

  it('переход статусов — значками со своим цветом, код статуса в подсказке', async () => {
    await mount(src());
    const row = firstRow('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07');
    const st = within(row).getByTestId('news-status');
    const marks = st.querySelectorAll('[data-status]');
    expect([...marks].map(m => m.getAttribute('data-status'))).toEqual(['in_progress', 'ready_for_deploy']);
    expect(marks[1].getAttribute('title')).toContain('ready_for_deploy');
    expect((marks[1] as HTMLElement).style.getPropertyValue('--st-c')).toMatch(/var\(--/);
  });

  // Прод v1.17.7 (владелица 09.11: «статусы задач там имеют не те иконки, которые в
  // задачах и спринтах»): сервер отдаёт from/to сырым status_raw («✅ DONE»), а
  // таблица kit ждёт код — статус выходил «неизвестным» (иконка help) с эмодзи рядом.
  it('сырой статус сервера («✅ DONE», «🚀 READY FOR DEPLOY») читается в код, а не в «неизвестно»', async () => {
    const data = clone();
    const ev = data.events.find(e => e.key === 'task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07')!;
    ev.from = '✅ DONE';
    ev.to = '🚀 READY FOR DEPLOY';
    await mount(src({}, data));
    const marks = within(firstRow(ev.key)).getByTestId('news-status').querySelectorAll('[data-status]');
    expect([...marks].map(m => m.getAttribute('data-status'))).toEqual(['done', 'ready_for_deploy']);
    expect([...marks].map(m => m.getAttribute('data-category'))).not.toContain('unknown');
    // Подпись — код без эмодзи; сырой текст сервера — в подсказке.
    expect(marks[0].textContent).toBe('done');
    expect(marks[0].getAttribute('title')).toContain('✅ DONE');
  });

  it('приложение подставляет свой читатель статуса — тот же, что у задач и спринтов', async () => {
    const data = clone();
    const ev = data.events.find(e => e.key === 'task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07')!;
    ev.to = '✅ MERGED — влито';
    await mount(src({}, data), { statusOf: raw => (raw?.startsWith('✅') ? 'done' : 'unknown') });
    const marks = within(firstRow(ev.key)).getByTestId('news-status').querySelectorAll('[data-status]');
    expect(marks[1].getAttribute('data-status')).toBe('done');
  });
});

// Владелица 09.11: «почему новости не на всю ширину… плотно прилегали к левому краю».
describe('ширина ленты', () => {
  it('у .sk-news нет своего max-width — лента занимает всю область содержимого', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/../kit/src/styles/seidr.css`, 'utf8');
    const rules = [...css.matchAll(/(^|\n)\.sk-news\s*\{([^}]*)\}/g)].map(m => m[2]);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter(r => /max-width/.test(r))).toEqual([]);
  });
});

describe('S4-STATUS-AXIS-CONFIG · иконка статуса в ленте — ИЗ СЛОВАРЯ приложения', () => {
  // Находка прода v1.17.7 (релизная сессия): иконки статусов в новостях не
  // совпадали с задачами и спринтами. Причина не во вкусах, а в источнике:
  // лента брала внутреннюю таблицу kit, а списки и чип — словарь модели.
  // Слова владелицы 09.11: «статусную модель и иконки к ним по контракту несут
  // они, а ты просто обрабатываешь согласно контракту».
  const DICT = [
    { code: 'ready_for_deploy', title: 'К выкатке', category: 'active' as const, icon: 'castle', color: 'var(--inf)' },
  ];
  const mark = (root: ParentNode) => root.querySelector('[data-status="ready_for_deploy"]') as HTMLElement;

  it('есть словарь — иконка и цвет оттуда, помечено source=dict', async () => {
    const { container } = await mount(src(), {}, DICT);
    const m = mark(container);
    expect(m, 'статус «ready_for_deploy» в ленте').toBeTruthy();
    expect(m.getAttribute('data-look')).toBe('dict');
    expect(m.getAttribute('style')).toContain('var(--inf)');
  });

  it('словаря нет (витрина вне оболочки) — запас kit, и это ПОМЕЧЕНО', async () => {
    const { container } = await mount(src());
    const m = mark(container);
    expect(m.getAttribute('data-look')).toBe('fallback');
    expect(m.getAttribute('data-look-why')).toMatch(/словар/i);
    // Подсказка остаётся сырым статусом сервера, а не рассказом про kit.
    expect(m.getAttribute('title')).toContain('ready_for_deploy');
  });
});
