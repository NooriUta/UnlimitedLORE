// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-09, клиентская половина: фильтр по автору,
// свёртка правок агента, честный счёт страницы.
//
// Серверная часть влита (PR #1083): `GET /lore/history?…&author=&collapse=agent`.
// `author` — конкретный автор (вместе с `author_kind` по И), `collapse=agent` —
// подряд идущие правки одного агента одной строкой (последняя версия серии) с
// `collapsed {count, first_state_uid, first_valid_from}`; одиночная правка
// агента не помечается. `page.total` и `has_more` считаются по СВЁРНУТЫМ
// строкам, а `author`/`collapse` возвращаются эхом.
//
// Что было: ни `author_kind` (с PR #948), ни `author`, ни `collapse` вкладка не
// давала выбрать — параметры уходили только теми значениями, которые зашил
// экран. Параметр, который мы шлём, но не даём выбрать, — это не возможность.
//
// Что закрепляется:
//   • органы управления появляются ТОЛЬКО когда приложение умеет сменить
//     запрос (`onQuery`): обещать фильтр, которого экран не применит, нельзя;
//   • вид автора и конкретный автор уходят ОДНИМ запросом — условие «И»;
//   • авторы для выбора — из загруженных версий, и это сказано словами;
//     выбранный фильтр не съедает остальные варианты;
//   • свёрнутая серия показывает ЧИСЛО правок и остаётся раскрываемой;
//     одиночная правка агента серией не помечается;
//   • «показано N из M» со свёрткой говорит о СТРОКАХ, которые человек видит;
//   • пусто при активном фильтре — «ничего не нашлось по фильтру», а не
//     «истории нет»;
//   • сравнить можно любые две версии, включая правку внутри серии.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { KitLangProvider } from '../i18n';
import type { KitRecord } from '../core/contract';
import { RecordHistory, historyCount, type RecordHistorySource } from './RecordHistory';
import { HISTORY_QUERY_ALL, type KitHistory, type KitHistoryVersion } from './history';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));

const REC: KitRecord = { id: 'S/T-1', kind: 'Task', title: 'Задача', status: 'IN_PROGRESS', fields: {} };

const agent = (id: string) => ({ kind: 'agent' as const, client_id: id, actor_id: null, session_id: null, owner_kc_sub: 'u-1' });
const human = (sub: string, name: string) => ({ kind: 'human' as const, kc_sub: sub, display_name: name });

const ver = (over: Partial<KitHistoryVersion>): KitHistoryVersion => ({
  state_uid: null, valid_from: null, valid_to: null, is_open: false, status: null,
  fields: {}, changed: [], author: { kind: 'unknown' }, ...over,
});

/** Строка серии: ПОСЛЕДНЯЯ правка серии из 5, начавшейся часом раньше. */
const RUN = ver({
  state_uid: 's9', valid_from: '2026-11-08T10:00:00Z', is_open: true, status: 'IN_PROGRESS',
  fields: { note_md: 'после серии' }, changed: ['note_md'], author: agent('claude-code'),
  collapsed: { count: 5, first_state_uid: 's5', first_valid_from: '2026-11-08T09:00:00Z' },
});
/** Одиночная правка агента — серией НЕ помечается. */
const SOLO = ver({
  state_uid: 's4', valid_from: '2026-11-07T10:00:00Z', valid_to: '2026-11-08T09:00:00Z',
  fields: { note_md: 'одна правка' }, changed: ['note_md'], author: agent('lore-mcp'),
});
const BY_HUMAN = ver({
  state_uid: 's1', valid_from: '2026-11-06T10:00:00Z', valid_to: '2026-11-07T10:00:00Z',
  fields: { note_md: 'рукой' }, changed: ['note_md'], author: human('u-1', 'Маша'),
});

const hist = (over: Partial<KitHistory> = {}): KitHistory => ({
  tracking: 'scd2', versions: [RUN, SOLO, BY_HUMAN], anomalies: [],
  page: { limit: 20, offset: 0, total: 3, has_more: false, author: null, collapse: 'agent' },
  warnings: [], ...over,
});

const src = (over: Partial<RecordHistorySource> = {}): RecordHistorySource => ({
  state: 'ok', data: hist(), restorable: ['note_md'], query: { ...HISTORY_QUERY_ALL, collapse: true },
  onQuery: () => {}, ...over,
});

const show = (over: Partial<RecordHistorySource> = {}, lang: 'ru' | 'en' = 'ru') =>
  render(<KitLangProvider lang={lang}><RecordHistory record={REC} source={src(over)} /></KitLangProvider>);

const emptyBox = () => document.querySelector('[data-state="empty"]') as HTMLElement;

const notes = () => screen.getAllByRole('note').map(n => n.textContent).join(' | ');

describe('S9-09 · фильтры истории доходят до человека', () => {
  it('положительный контроль: версии показаны, фильтры на месте', () => {
    show();
    expect(screen.getAllByTestId('kit-history-row')).toHaveLength(3);
    expect(screen.getByLabelText('Кто правил')).toBeTruthy();
    expect(screen.getByLabelText('Автор')).toBeTruthy();
  });

  it('приложение не умеет менять запрос — органов управления нет', () => {
    show({ onQuery: undefined });
    expect(screen.queryByLabelText('Кто правил')).toBeNull();
    expect(screen.queryByLabelText('Автор')).toBeNull();
    expect(screen.queryByLabelText(/Свернуть правки бота/)).toBeNull();
  });

  it('вид автора уходит в запрос', () => {
    const onQuery = vi.fn();
    show({ onQuery });
    fireEvent.change(screen.getByLabelText('Кто правил'), { target: { value: 'agent' } });
    expect(onQuery.mock.calls[0][0]).toMatchObject({ authorKind: 'agent' });
  });

  it('конкретный автор — из авторов выдачи, и уходит ВМЕСТЕ с видом (условие «И»)', () => {
    const onQuery = vi.fn();
    show({ onQuery, query: { ...HISTORY_QUERY_ALL, collapse: true, authorKind: 'agent' } });
    const select = screen.getByLabelText('Автор') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['', 'claude-code', 'lore-mcp', 'u-1']);
    fireEvent.change(select, { target: { value: 'claude-code' } });
    expect(onQuery.mock.calls[0][0]).toMatchObject({ authorKind: 'agent', author: 'claude-code' });
  });

  it('у автора в списке — его число правок; серия весит все свои правки', () => {
    show();
    const select = screen.getByLabelText('Автор') as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent).join(' | ')).toMatch(/claude-code.*5/);
  });

  it('список авторов — только из загруженного, и это сказано словами', () => {
    show();
    expect(notes()).toMatch(/загруженных версий/);
  });

  it('выбранный фильтр не съедает остальные варианты автора', () => {
    // Выдача сузилась до одного автора, но приложение помнит всех (authors).
    show({
      data: hist({ versions: [RUN] }),
      query: { ...HISTORY_QUERY_ALL, collapse: true, author: 'claude-code' },
      authors: [{ kind: 'agent', caller: 'claude-code', count: 5 }, { kind: 'human', caller: 'u-1', count: 1 }],
    });
    const select = screen.getByLabelText('Автор') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['', 'claude-code', 'u-1']);
    expect(select.value).toBe('claude-code');
  });

  it('«Сбросить» снимает все сужения одним запросом, свёртку не трогает', () => {
    const onQuery = vi.fn();
    show({ onQuery, query: { authorKind: 'agent', author: 'claude-code', field: 'status', collapse: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(onQuery).toHaveBeenCalledWith({ authorKind: null, author: null, field: null, collapse: true });
  });

  it('сужений нет — «Сбросить» не предлагается', () => {
    show({ query: { ...HISTORY_QUERY_ALL, collapse: true } });
    expect(screen.queryByRole('button', { name: 'Сбросить фильтры' })).toBeNull();
  });

  it('«что менялось» тоже выбирается, а не зашито экраном', () => {
    const onQuery = vi.fn();
    show({ onQuery });
    fireEvent.change(screen.getByLabelText('Что менялось'), { target: { value: 'status' } });
    expect(onQuery.mock.calls[0][0]).toMatchObject({ field: 'status' });
  });
});

describe('S9-09 · свёртка правок агента', () => {
  it('переключатель уходит в запрос', () => {
    const onQuery = vi.fn();
    // Сейчас не свёрнуто — и это сказал сервер эхом, а не мы.
    show({ onQuery, query: { ...HISTORY_QUERY_ALL, collapse: false },
      data: hist({ page: { limit: 20, offset: 0, total: 3, has_more: false, collapse: null } }) });
    fireEvent.click(screen.getByLabelText(/Свернуть правки бота/));
    expect(onQuery.mock.calls[0][0]).toMatchObject({ collapse: true });
  });

  it('переключатель показывает состояние из ЭХА сервера, а не из нашего желания', () => {
    show({
      query: { ...HISTORY_QUERY_ALL, collapse: true },
      data: hist({ page: { limit: 20, offset: 0, total: 3, has_more: false, collapse: null } }),
    });
    expect((screen.getByLabelText(/Свернуть правки бота/) as HTMLInputElement).checked).toBe(false);
  });

  it('свёрнутая серия показывает число правок и период', () => {
    show();
    const row = screen.getAllByTestId('kit-history-row')[0];
    expect(row.getAttribute('data-run')).toBe('5');
    expect(row.textContent).toMatch(/5/);
    expect(row.textContent).toMatch(/2026-11-08 09:00/);
  });

  it('одиночная правка агента серией не помечается', () => {
    show();
    const row = screen.getAllByTestId('kit-history-row')[1];
    expect(row.getAttribute('data-run')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Развернуть серию/ })).toBeNull();
  });

  it('серию можно развернуть: правки приходят по одной', async () => {
    const inner = [
      ver({ state_uid: 's8', valid_from: '2026-11-08T09:45:00Z', author: agent('claude-code'), changed: ['note_md'], fields: { note_md: 'ш4' } }),
      ver({ state_uid: 's5', valid_from: '2026-11-08T09:00:00Z', author: agent('claude-code'), changed: ['note_md'], fields: { note_md: 'ш1' } }),
    ];
    const onExpand = vi.fn(async () => inner);
    show({ onExpand });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Развернуть серию/ })); });
    expect(onExpand).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-run-row')).toHaveLength(2));
  });

  it('пришло меньше правок, чем в серии, — сказано числом, а не умолчано', async () => {
    const onExpand = vi.fn(async () => [ver({ state_uid: 's8', valid_from: '2026-11-08T09:45:00Z', author: agent('claude-code') })]);
    show({ onExpand });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Развернуть серию/ })); });
    await waitFor(() => expect(screen.getAllByTestId('kit-history-run-row')).toHaveLength(1));
    expect(screen.getByTestId('kit-history-run-partial').textContent).toMatch(/1.*5/);
  });

  it('разворот не удался — причина словами, серия остаётся на месте', async () => {
    const onExpand = vi.fn(async () => { throw new Error('таймаут'); });
    show({ onExpand });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Развернуть серию/ })); });
    await waitFor(() => expect(screen.getByTestId('kit-history-run-failed').textContent).toMatch(/таймаут/));
    expect(screen.getAllByTestId('kit-history-row')).toHaveLength(3);
  });

  it('разворачивать некому — кнопки нет, но сказано, как увидеть правки по одной', () => {
    show({ onExpand: undefined });
    expect(screen.queryByRole('button', { name: /Развернуть серию/ })).toBeNull();
    expect(screen.getAllByTestId('kit-history-row')[0].textContent).toMatch(/выключите свёртку/i);
  });
});

describe('S9-09 · счёт страницы говорит о том, что видно', () => {
  it('со свёрткой «показано N из M» — про строки, а не про сырые версии', () => {
    show({ data: hist({ page: { limit: 2, offset: 0, total: 9, has_more: true, collapse: 'agent' } }), onMore: () => {} });
    expect(notes()).toMatch(/3[\s\S]*9/);
    expect(notes()).toMatch(/свёрн/i);
  });

  it('без свёртки — прежняя надпись про версии', () => {
    show({
      query: { ...HISTORY_QUERY_ALL, collapse: false },
      data: hist({ versions: [SOLO, BY_HUMAN], page: { limit: 2, offset: 0, total: 9, has_more: true, collapse: null } }),
    });
    expect(notes()).toMatch(/верси/i);
    expect(notes()).not.toMatch(/свёрн/i);
  });

  it('ярлык вкладки берёт полное число из page.total, а не число загруженных', () => {
    // historyCount — число у ярлыка вкладки; оно обязано говорить о всей
    // истории, когда сервер её посчитал.
    expect(historyCount(src({ data: hist({ page: { limit: 2, offset: 0, total: 9, has_more: true } }) }))).toBe(9);
  });

  it('сервер числа не дал — ярлык говорит о загруженном, а не выдумывает', () => {
    expect(historyCount(src({ data: hist({ page: null }) }))).toBe(3);
  });
});

describe('S9-09 · честная пустота под фильтром', () => {
  it('фильтр ничего не нашёл — «по фильтру», а не «истории нет»', () => {
    show({
      data: hist({ versions: [], page: { limit: 20, offset: 0, total: 0, has_more: false, author: 'u-9' } }),
      query: { ...HISTORY_QUERY_ALL, author: 'u-9' },
    });
    expect(emptyBox().textContent).toMatch(/фильтр/i);
    // Фильтры остаются на экране: иначе снять их нечем.
    expect(screen.getByLabelText('Автор')).toBeTruthy();
  });

  it('фильтров нет и версий нет — «правок нет» (проверенный ноль)', () => {
    show({
      data: hist({ versions: [], page: { limit: 20, offset: 0, total: 0, has_more: false } }),
      query: { ...HISTORY_QUERY_ALL },
    });
    expect(emptyBox().textContent).toMatch(/Правок нет/);
  });

  it('свёртка пустоты не создаёт: «ничего не нашлось» — только о сужении', () => {
    show({
      data: hist({ versions: [], page: { limit: 20, offset: 0, total: 0, has_more: false, collapse: 'agent' } }),
      query: { ...HISTORY_QUERY_ALL, collapse: true },
    });
    expect(emptyBox().textContent).toMatch(/Правок нет/);
  });
});

describe('S9-09 · сравнить любые две', () => {
  it('в «сравнить с» — все версии, а не только соседняя', () => {
    show();
    const select = screen.getByLabelText('Сравнить с') as HTMLSelectElement;
    // Выбрана текущая (серия) — сравнить можно с любой из остальных двух.
    expect([...select.options].map(o => o.value).filter(Boolean)).toHaveLength(2);
  });

  it('правку внутри развёрнутой серии тоже можно выбрать и сравнить', async () => {
    const inner = [
      ver({ state_uid: 's8', valid_from: '2026-11-08T09:45:00Z', author: agent('claude-code'), fields: { note_md: 'ш4' } }),
      ver({ state_uid: 's5', valid_from: '2026-11-08T09:00:00Z', author: agent('claude-code'), fields: { note_md: 'ш1' } }),
    ];
    show({ onExpand: async () => inner });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Развернуть серию/ })); });
    await waitFor(() => expect(screen.getAllByTestId('kit-history-run-row')).toHaveLength(2));
    fireEvent.click(within(screen.getAllByTestId('kit-history-run-row')[1]).getByRole('button', { name: /Выбрать версию/ }));
    const select = screen.getByLabelText('Сравнить с') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 's8' } });
    expect(screen.getAllByTestId('kit-history-diff-row').map(r => r.getAttribute('data-field'))).toEqual(['note_md']);
  });
});

describe('S9-09 · локаль и доступность', () => {
  it('en: подписи фильтров на английском', () => {
    show({}, 'en');
    expect(screen.getByLabelText('Edited by')).toBeTruthy();
    expect(screen.getByLabelText('Author')).toBeTruthy();
  });

  it('axe: без нарушений', async () => {
    const { container } = show();
    expect(await axeViolations(container)).toEqual([]);
  });
});
