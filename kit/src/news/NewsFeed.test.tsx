// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-02 (+ S7A-06) — экран новостей v2 на kit: лента,
// разрезы, метрики, матрица, сгорание, честные состояния. Номера пунктов
// SPEC-LORE-UXR-NEWS-PARITY — в названиях тестов («Пn»). Все числа берутся
// из ответа сервера: тест сверяет, что нарисовано ровно присланное.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import { KitLangProvider } from '../i18n';
import { NEWS_FIXTURE, NewsActivity, NewsFeed, type NewsResponse, type NewsSource } from './index';

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

async function mount(source: NewsSource, props: Partial<Parameters<typeof NewsFeed>[0]> = {}) {
  const r = render(
    <KitLangProvider lang="ru">
      <NewsFeed source={source} urlPrefix={null} timeZone="Europe/Moscow" {...props} />
    </KitLangProvider>,
  );
  await screen.findByTestId('news-feed-days');
  return r;
}

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
    fireEvent.click(screen.getByRole('button', { name: /старые сверху/i }));
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
    const a = within(task).getByRole('link');
    expect(a.getAttribute('href')).toBe('/lore?section=sprints&passport=SPRINT_UXR_S7A_NEWS');
    const spec = screen.getByTestId('news-row-spec:SPEC-LORE-UXR-NEWS-ALGORITHMS|version|2026-11-07');
    expect(within(spec).getByRole('link').getAttribute('href')).toMatch(/passport=spec%3A/);
  });

  it('onOpen: Enter и пробел на строке открывают запись (дефект v1 исправлен)', async () => {
    const onOpen = vi.fn();
    await mount(src(), { onOpen });
    // День 06.11 — третий, свёрнут: открываем.
    fireEvent.click(dayBtn('2026-11-06'));
    const link = within(screen.getByTestId('news-row-adr:ADR-LORE-045|changed|2026-11-06')).getByRole('link');
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
    fireEvent.change(screen.getByLabelText('Группировка'), { target: { value: 'type' } });
    await waitFor(() => expect(last(s).get('group_by')).toBe('type'));
  });

  it('фильтр по проекту — параметр запроса; снимается «Сбросить»', async () => {
    const s = src();
    await mount(s);
    fireEvent.change(screen.getByLabelText('Проект'), { target: { value: 'NooriUta/volva' } });
    await waitFor(() => expect(last(s).get('project')).toBe('NooriUta/volva'));
    expect(screen.getByTestId('news-desc').textContent).toMatch(/Проект: volva/);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(last(s).has('project')).toBe(false));
  });

  it('опции фильтра типа несут числа сервера (by_type), а не подсчёт клиента', async () => {
    await mount(src());
    const opt = within(screen.getByLabelText('Тип записи')).getByRole('option', { name: /задача · 6 · 5/ });
    expect(opt).toBeTruthy();
  });

  it('все оси S7A-02 в группировке; автор помечен «ждёт S2-12», пока автор не хранится', async () => {
    await mount(src());
    const sel = screen.getByLabelText('Группировка');
    const values = within(sel).getAllByRole('option').map(o => (o as HTMLOptionElement).value);
    expect(values).toEqual(['project', 'component', 'type', 'kind', 'sprint', 'milestone', 'author', 'day']);
    expect(within(sel).getByRole('option', { name: /автор.*S2-12/i })).toBeTruthy();
  });

  it('период и пояс — переключатели; запрос несёт days и tz', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(screen.getByRole('radio', { name: 'Месяц' }));
    await waitFor(() => expect(last(s).get('days')).toBe('30'));
    fireEvent.click(screen.getByRole('radio', { name: /UTC/ }));
    await waitFor(() => expect(last(s).get('tz')).toBe('UTC'));
  });

  it('клик по группе в разрезе — фильтр этой группы (filter-дескриптор сервера)', async () => {
    const s = src();
    await mount(s);
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
    expect(screen.getByLabelText('Group by')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeTruthy();
  });
});
