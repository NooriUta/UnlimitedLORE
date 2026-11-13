// @vitest-environment jsdom
// MP2-08/MP2-09/MP2-10 (SPRINT_UXR_MOBILE_POLISH, владелица 13.11.2026):
//   • технические сообщения («Состояние данных», оговорки модели) убраны из
//     компоновки паспорта — и мобильной, и desktop — и собраны под значок
//     warnings с попапом; несколько источников агрегируются в один список;
//   • строка над паспортом есть в ЛЮБОМ состоянии (загрузка, сбой, чтение).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const SPRINT = { sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 IN PROGRESS', planned_end_date: '2026-11-12', valid_from: '2026-11-08T00:00:00Z', context_md: 'текст' };

function fake() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const name = new URL(String(input), 'http://x').pathname.split('/').pop();
    if (name === 'sprints') return json({ rows: [SPRINT] });
    if (name === 'tasks_of_sprint') return json({ rows: [] });
    return json({ rows: [] });
  });
}

/** Фасад записи по контракту lore.record/1 (образец — ListPassport.facade.test.tsx) без строк состояния. */
const CLEAN_FACADE = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'S_A', title: 'Альфа', status: 'active', version: '2026-11-08T00:00:00Z' },
  values: { title: 'Альфа', context_md: 'текст' },
  parts: [],
  links: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'calendar',
    fields: [
      { key: 'title', label: 'Название', label_key: 'f.t', kind: 'text', group: 'head', required: true, editable: false },
      { key: 'context_md', label: 'Контекст', label_key: 'f.c', kind: 'md', group: 'body', required: false, editable: false },
    ],
    layout: {},
    relations: [],
  },
  meta: { facade: 'server', sources: {} },
};

const failing = () => vi.fn(async () => { throw new Error('сеть недоступна'); });

describe('MP2-08 · технические сообщения паспорта — под значком warnings', () => {
  it('оговорок модели и блока состояния нет в компоновке: ни полосы, ни чипа «тех.»', async () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    expect(document.querySelector('.pp-model-note'), 'полоса оговорок убрана').toBeNull();
    expect(document.querySelector('.sk-ds'), 'блок состояния данных убран из потока').toBeNull();
    expect(document.querySelector('.sk-tech__btn'), 'чипов «тех.» в компоновке нет').toBeNull();
  });

  it('значок warnings один и собирает оговорки модели; попап перечисляет их', async () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    const trigs = await waitFor(() => {
      const t = screen.getAllByTestId('kit-rec-warnings');
      expect(t.length).toBe(1);
      return t;
    });
    fireEvent.click(trigs[0].querySelector('button')!);
    const pop = document.querySelector('.sk-warn__pop')!;
    expect(pop).toBeTruthy();
    expect(pop.textContent).toMatch(/оговорк|модел/i);
  });

  it('сообщений нет — значка нет', async () => {
    // Модель ответила и тип решён: оговорок нет; состояние данных чистое.
    //
    // Проверка «значка нет» — отрицательная, поэтому делается ПОСЛЕ того, как
    // пришли все загрузки паспорта (фасад записи и история), а не сразу по
    // заголовку: иначе она проходит по таймингу. Так develop 2648f661 краснел
    // через раз (SPRINT_UXR_S11_TEST_OPT/S11-PASSPORT-WARNINGS-STUB): заглушка
    // отвечала на /lore/record/… `{rows: []}`, фасад падал, паспорт честно
    // собирался на клиенте со строкой `lore.record: error`, и «Часть сведений
    // не загрузилась» появлялась уже ПОСЛЕ проверки. «Чисто» — значит фасад
    // ответил по контракту lore.record/1, без data_state.
    let recordServed!: () => void;
    let historyServed!: () => void;
    const recordDone = new Promise<void>(r => { recordServed = r; });
    const historyDone = new Promise<void>(r => { historyServed = r; });
    const clean = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://x').pathname;
      const name = path.split('/').pop();
      if (path.startsWith('/lore/record/')) { recordServed(); return json(CLEAN_FACADE); }
      // форма LoreHistoryResource: {type, id, rows, attribution} — версий нет, это не сбой
      if (path === '/lore/history') {
        historyServed();
        return json({ type: 'sprint', id: 'S_A', rows: [], attribution: { ok: true } });
      }
      if (path === '/lore/me/drafts') return json({ drafts: [] });
      if (name === 'sprints') return json({ rows: [SPRINT] });
      if (name === 'model') {
        return json({
          format: 'model/0',
          version: 'v1',
          surfaces: { passport: { sprint: { decided: true, sections: [] } } },
          statuses: { sprint: { entries: [{ code: 'active', title: 'В работе', color: 'var(--st-active)', icon: 'run', category: 'active', order: 1 }] } },
        });
      }
      return json({ rows: [] });
    });
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={clean as unknown as typeof fetch} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    await Promise.all([recordDone, historyDone]);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(screen.queryByTestId('kit-rec-warnings')).toBeNull();
  });
});

describe('MP2-09/10 · строка над паспортом в любом состоянии', () => {
  it('загрузка: бар уже есть (крошки и смена места), а не появляется после данных', () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" backLabel="Спринты" fetchImpl={fake() as unknown as typeof fetch} />);
    const bar = screen.getByTestId('kit-rec-bar');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('Спринты');
    expect(bar.querySelector('.sk-place__btn'), 'смена места доступна и при загрузке').toBeTruthy();
  });

  it('сбой: бар остаётся, ошибка названа ниже него', async () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" backLabel="Спринты" fetchImpl={failing() as unknown as typeof fetch} />);
    await waitFor(() => expect(document.querySelector('.sk-state--error, [class*=load-error], [role=alert]')).toBeTruthy());
    expect(screen.getByTestId('kit-rec-bar')).toBeTruthy();
  });

  it('чтение: тот же бар, что при загрузке — одна строка над записью', async () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" backLabel="Спринты" fetchImpl={fake() as unknown as typeof fetch} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    const bars = screen.getAllByTestId('kit-rec-bar');
    expect(bars, 'бар ровно один').toHaveLength(1);
    expect(bars[0].querySelector('.sk-place__btn')).toBeTruthy();
  });
});
