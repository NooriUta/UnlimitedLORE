// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-09 · связка целиком: вкладка «История» kit +
// useHistoryTab. Проверяем то, что должно дойти ДО ЧЕЛОВЕКА: он выбирает
// автора и вид автора, включает свёртку, видит число правок в серии,
// разворачивает её и читает честное «показано N из M строк».
//
// Отдельный смысл этого теста: органы управления и параметры сервера сходятся
// здесь, а не в голове. Параметр, который мы шлём, но не даём выбрать, — это
// не возможность; кнопка, за которой не уходит запрос, — тоже.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, RecordView, registerGameIcons, type KitCtx, type KitRecord } from '@seidr/kit';
import { useHistoryTab } from './useHistoryTab';

beforeAll(() => registerGameIcons(gameIcons));

const REC: KitRecord = { id: 'ADR-1', kind: 'adr', title: 'Решение', status: 'ACCEPTED', fields: {} };
const ctx: KitCtx = {
  data: { records: [REC], edges: [], journal: [], meta: { generated_at: '2026-11-10T12:00:00Z' } },
  config: { modules: [], menu: { groups: [] }, kinds: { adr: { title: 'Решения', icon: 'scroll-quill' } }, statuses: { items: [] } },
  href: id => `?passport=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div>,
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const base = (over: Record<string, unknown> = {}) => ({
  entity_type: 'adr', hist_type: 'KnowADRHist', ref_id: 'ADR-1',
  state_uid: 'st-1', valid_from: '2026-11-01T10:00:00Z', valid_to: null,
  status_raw: 'ACCEPTED', content_hash: 'h1', source_commit: null,
  changed_by: 'u-1', changed_by_kind: 'human',
  author: { kind: 'human', caller: 'u-1', source: 'hist' },
  ...over,
});
const agentRow = (over: Record<string, unknown> = {}) =>
  base({ author: { kind: 'agent', caller: 'claude-code', source: 'hist' }, ...over });

/** Сервер-заглушка: отвечает по тому, что спросили, и помнит адреса. */
function stand() {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('collapse=agent')) {
      return json({
        type: 'adr', id: 'ADR-1', attribution: { ok: true, source: 'hist' },
        rows: [
          agentRow({ state_uid: 'st-9', valid_from: '2026-11-08T10:00:00Z',
            collapsed: { count: 4, first_state_uid: 'st-6', first_valid_from: '2026-11-08T09:00:00Z' } }),
          base({ state_uid: 'st-1', valid_from: '2026-11-01T10:00:00Z', valid_to: '2026-11-08T09:00:00Z' }),
        ],
        page: { total: 5, offset: 0, limit: 20, returned: 2, has_more: true, order: 'desc', collapse: 'agent' },
      });
    }
    const rows = [
      agentRow({ state_uid: 'st-9', valid_from: '2026-11-08T10:00:00Z' }),
      agentRow({ state_uid: 'st-8', valid_from: '2026-11-08T09:40:00Z', valid_to: '2026-11-08T10:00:00Z' }),
      agentRow({ state_uid: 'st-6', valid_from: '2026-11-08T09:00:00Z', valid_to: '2026-11-08T09:40:00Z' }),
      base({ state_uid: 'st-1', valid_from: '2026-11-01T10:00:00Z', valid_to: '2026-11-08T09:00:00Z' }),
    ];
    const kept = url.includes('author=claude-code') ? rows.filter(r => r.state_uid !== 'st-1') : rows;
    return json({
      type: 'adr', id: 'ADR-1', rows: kept, attribution: { ok: true, source: 'hist' },
      page: { total: kept.length, offset: 0, limit: 20, returned: kept.length, has_more: false, order: 'desc' },
    });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

function Passport({ fetchImpl }: { fetchImpl: typeof fetch }) {
  const history = useHistoryTab('adr', REC.id, { fetchImpl });
  return <RecordView record={REC} ctx={ctx} tab="history" onTab={() => {}} history={history} />;
}

const show = (fetchImpl: typeof fetch) =>
  render(<KitLangProvider lang="ru"><Passport fetchImpl={fetchImpl} /></KitLangProvider>);

describe('S9-09 · фильтры истории на экране', () => {
  it('положительный контроль: вкладка показывает версии и фильтры', async () => {
    const srv = stand();
    show(srv.fetchImpl);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(4));
    expect(screen.getByLabelText('Кто правил')).toBeTruthy();
    expect(screen.getByLabelText('Автор')).toBeTruthy();
    expect(screen.getByLabelText(/Свернуть правки агента/)).toBeTruthy();
  });

  it('человек выбирает автора — запрос уходит, выдача сужается', async () => {
    const srv = stand();
    show(srv.fetchImpl);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(4), { timeout: 8000 });
    // Список авторов наполняется ИЗ ОТВЕТА, отдельным эффектом после того,
    // как строки уже нарисованы. Поэтому ждать появления строк мало: пока
    // варианта нет, <select> молча проглотит присвоенное значение, запрос
    // не уйдёт, и проверка упрётся в «не сузилось» вместо настоящей причины.
    const pick = () => screen.getByLabelText('Автор') as HTMLSelectElement;
    await waitFor(() => {
      const has = Array.from(pick().options).some(o => o.value === 'claude-code');
      expect(has, 'в списке авторов нет claude-code — выбирать нечего').toBe(true);
    }, { timeout: 8000 });
    await act(async () => {
      fireEvent.change(pick(), { target: { value: 'claude-code' } });
    });
    // Сначала ФАКТ запроса, потом выдача. Так проверка говорит, что именно
    // сломалось: параметр не ушёл или ответ не доехал до строк.
    await waitFor(() => {
      expect(srv.urls.join(' '), 'параметр author не ушёл на сервер').toContain('author=claude-code');
    }, { timeout: 8000 });
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(3), { timeout: 8000 });
    expect(srv.urls[srv.urls.length - 1]).toContain('author=claude-code');
  }, 15000);

  it('человек включает свёртку — серия приходит одной строкой с числом правок', async () => {
    const srv = stand();
    show(srv.fetchImpl);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(4));
    fireEvent.click(screen.getByLabelText(/Свернуть правки агента/));
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(2));
    const run = screen.getAllByTestId('kit-history-row')[0];
    expect(run.getAttribute('data-run')).toBe('4');
    expect(run.textContent).toMatch(/4/);
    // «Показано N из M» говорит о СТРОКАХ, которые человек видит.
    expect(screen.getAllByRole('note').map(n => n.textContent).join(' | ')).toMatch(/2 из 5 строк/);
  });

  it('свёрнутую серию можно развернуть — правки приходят по одной', async () => {
    const srv = stand();
    show(srv.fetchImpl);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(4));
    fireEvent.click(screen.getByLabelText(/Свернуть правки агента/));
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(2));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Развернуть серию' })); });
    await waitFor(() => expect(screen.getAllByTestId('kit-history-run-row').length).toBeGreaterThan(1));
    // Правок в серии 4, а этого агента в окне — 3: недобор назван числом.
    expect(screen.getByTestId('kit-history-run-partial').textContent).toMatch(/3 из 4/);
  });

  it('ярлык вкладки говорит число из page.total, а не число загруженных строк', async () => {
    const srv = stand();
    show(srv.fetchImpl);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(4));
    fireEvent.click(screen.getByLabelText(/Свернуть правки агента/));
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(2));
    expect(within(screen.getByRole('tab', { name: /История/ })).getByText('5')).toBeTruthy();
  });
});
