// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-04 · каркас записи kit: шапка, строка вердикта,
// вкладки, «Связи», локальный граф, «Журнал»; тело — MD через ctx.md.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { RecordView, useRecordTab } from './index';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));

const A: KitRecord = {
  id: 'Q-1', kind: 'Quiz', title: 'Квиз про руны', status: 'fix',
  fields: { question: 'Что значит ᚠ?', topic: 'T-1', score: 3 },
  body_md: '# Заголовок тела\n\nтекст **жирный**', updated_at: '2026-11-07T10:00:00Z',
};
const T: KitRecord = { id: 'T-1', kind: 'Topic', title: 'Руны', status: 'ok', fields: {} };

function cfg(over: Partial<KitConfig> = {}): KitConfig {
  return {
    modules: [{ id: 'method', title: 'Методология', icon: 'scroll-quill' }],
    menu: { groups: [] },
    kinds: {
      Quiz: {
        title: 'Квизы', icon: 'scroll-quill',
        fields: [
          { key: 'question', title: 'Вопрос', type: 'text' },
          { key: 'topic', title: 'Тема', type: 'ref' },
          { key: 'score', title: 'Баллы', type: 'number' },
        ],
        tabs: [{ key: 'play', title: 'Пройти', render: r => `играть: ${r.id}` }],
      },
      Topic: { title: 'Темы', icon: 'book-cover' },
    },
    edges: {
      QUIZ_OF: { label: 'квиз темы', color: '--wrn' },
      PREREQ: { label: 'требует', color: '--acc' },
    },
    graph: { depth: 2, limit: 60, colorBy: 'type' },
    statuses: {
      items: [
        { code: 'fix', title: 'нужна правка', category: 'active', icon: 'quill', color: '--dng' },
        { code: 'ok', title: 'согласовано', category: 'done', icon: 'check-mark', color: '--suc' },
      ],
    },
    verdict: () => ({ score: 3, max: 5, failed: ['нет подсказок'], hints: ['добавьте пример'] }),
    ...over,
  };
}

function dat(over: Partial<KitData> = {}): KitData {
  return {
    records: [A, T],
    edges: [
      { from: 'Q-1', to: 'T-1', type: 'QUIZ_OF' },
      { from: 'Q-1', to: 'GHOST', type: 'PREREQ' },
      { from: 'R-9', to: 'Q-1', type: 'PREREQ' },
    ],
    journal: [
      { at: '2026-11-06T09:00:00Z', who: 'Агент-методолог', is_agent: true, record_id: 'Q-1', field: 'status', from: '', to: 'fix' },
      { at: '2026-11-07T09:00:00Z', who: 'Маша', record_id: 'Q-1', field: 'question', from: 'старое', to: 'новое', approved_by: 'Оля' },
      { at: '2026-11-07T11:00:00Z', who: 'Маша', record_id: 'T-1', field: 'title', from: 'a', to: 'b' },
    ],
    meta: { generated_at: '2026-11-07T12:00:00Z' },
    ...over,
  };
}

function ctxOf(config = cfg(), data = dat()): KitCtx {
  return {
    data, config,
    href: id => `#rec=${encodeURIComponent(id)}`,
    esc: s => s,
    md: s => <div data-testid="md">{s}</div>,
  };
}

function view(tab = 'overview', ctx = ctxOf(), record = A) {
  const onTab = vi.fn();
  const r = render(<RecordView record={record} ctx={ctx} tab={tab} onTab={onTab} />);
  return { ...r, onTab };
}

describe('K-04 · шапка записи', () => {
  it('тип, ID, заголовок, статус словами из config.statuses', () => {
    view();
    const head = screen.getByTestId('kit-rec-head');
    expect(within(head).getByRole('heading', { level: 1 }).textContent).toBe('Квиз про руны');
    expect(head.textContent).toContain('Q-1');
    expect(head.textContent).toContain('Квизы');
    expect(head.textContent).toContain('нужна правка');
  });

  it('неизвестный статус виден кодом, а не пропадает', () => {
    view('overview', ctxOf(), { ...A, status: 'weird' });
    expect(screen.getByTestId('kit-rec-head').textContent).toContain('weird');
  });
});

describe('K-04 · строка вердикта', () => {
  it('score/max, проваленные проверки и подсказки', () => {
    view();
    const v = screen.getByTestId('kit-verdict');
    expect(v.textContent).toContain('3/5');
    expect(v.textContent).toContain('нет подсказок');
    expect(v.textContent).toContain('добавьте пример');
    expect(v.getAttribute('data-tone')).toBe('wrn');
  });

  it('вердикт не настроен — строки нет', () => {
    view('overview', ctxOf(cfg({ verdict: undefined })));
    expect(screen.queryByTestId('kit-verdict')).toBeNull();
  });

  it('вердикт бросил — errBlock только вердикта, шапка жива', () => {
    const c = cfg({ verdict: () => { throw new Error('бум-вердикт'); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    view('overview', ctxOf(c));
    expect(screen.getByTestId('kit-rec-head')).toBeTruthy();
    const err = document.querySelector('[data-block="verdict"]');
    expect(err?.textContent).toContain('бум-вердикт');
  });
});

describe('K-04 · вкладки', () => {
  it('Обзор, вкладки вида, Связи, Граф, Журнал — по порядку', () => {
    view();
    const tabs = screen.getAllByRole('tab').map(t => t.textContent);
    expect(tabs[0]).toMatch(/^Обзор/);
    expect(tabs[1]).toMatch(/^Пройти/);
    expect(tabs.slice(2).map(t => t?.replace(/\d+$/, ''))).toEqual(['Связи', 'Граф', 'Журнал']);
  });

  it('счётчики: связей 3, записей журнала по этой записи 2', () => {
    view();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[2].textContent).toBe('Связи3');
    expect(tabs[4].textContent).toBe('Журнал2');
  });

  it('клик по вкладке — onTab (состояние живёт у экрана/в URL)', () => {
    const { onTab } = view();
    fireEvent.click(screen.getByRole('tab', { name: /Журнал/ }));
    expect(onTab).toHaveBeenCalledWith('journal');
  });

  it('неизвестная вкладка из URL — показывается обзор', () => {
    view('nonsense');
    expect(screen.getByRole('tab', { name: /Обзор/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('вкладка вида: строка из render — через ctx.md', () => {
    view('play');
    expect(screen.getByTestId('md').textContent).toBe('играть: Q-1');
  });

  it('вкладка вида бросила — errBlock только панели', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = cfg();
    c.kinds.Quiz.tabs = [{ key: 'play', title: 'Пройти', render: () => { throw new Error('бум-вкладка'); } }];
    view('play', ctxOf(c));
    expect(document.querySelector('[data-block="tab:play"]')?.textContent).toContain('бум-вкладка');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });
});

describe('K-04 · обзор', () => {
  it('тело — Markdown через ctx.md, поля вида — списком', () => {
    view();
    expect(screen.getByTestId('md').textContent).toContain('# Заголовок тела');
    const fields = screen.getByTestId('kit-fields');
    expect(fields.textContent).toContain('Вопрос');
    expect(fields.textContent).toContain('Что значит ᚠ?');
    const ref = within(fields).getByRole('link', { name: /Руны/ });
    expect(ref.getAttribute('href')).toBe('#rec=T-1');
  });

  it('overview вида заменяет тело; бросил — errBlock, поля живы', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = cfg();
    c.kinds.Quiz.overview = () => { throw new Error('бум-обзор'); };
    view('overview', ctxOf(c));
    expect(document.querySelector('[data-block="overview"]')?.textContent).toContain('бум-обзор');
    expect(screen.getByTestId('kit-fields')).toBeTruthy();
  });

  it('тела нет — честная пустота, не пропуск', () => {
    view('overview', ctxOf(), { ...A, body_md: undefined });
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
  });
});

describe('K-04 · Связи', () => {
  it('группы по типу ребра с подписью из config.edges, направление, ссылки', () => {
    view('links');
    const groups = screen.getAllByTestId('kit-link-group');
    expect(groups.map(g => g.getAttribute('data-type'))).toEqual(['PREREQ', 'QUIZ_OF']);
    expect(groups[1].textContent).toContain('квиз темы');
    const toTopic = within(groups[1]).getByRole('link', { name: /Руны/ });
    expect(toTopic.getAttribute('href')).toBe('#rec=T-1');
  });

  it('цель вне выборки — помечена, а не выброшена', () => {
    view('links');
    const ghost = screen.getByText('GHOST').closest('li');
    expect(ghost?.getAttribute('data-missing')).toBe('true');
  });

  it('связей нет — проверенный ноль', () => {
    view('links', ctxOf(cfg(), dat({ edges: [] })));
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
  });

  it('блок рёбер упал на сервере (meta.errors) — ошибка, а не «пусто»', () => {
    view('links', ctxOf(cfg(), dat({ edges: [], meta: { generated_at: 'x', errors: [{ block: 'edges', reason: 'timeout' }] } })));
    expect(document.querySelector('[data-state="error"]')?.textContent).toContain('timeout');
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
  });
});

describe('K-04 · локальный граф', () => {
  it('ego в центре, узлы — ссылками, секторы подписаны типом ребра', () => {
    view('graph');
    const svg = screen.getByRole('group', { name: /Q-1/ });
    expect(svg.querySelector('[data-node="Q-1"][data-center="true"]')).toBeTruthy();
    const links = within(screen.getByTestId('kit-graph')).getAllByRole('link');
    expect(links.map(l => l.getAttribute('href')).sort()).toEqual(['#rec=GHOST', '#rec=R-9', '#rec=T-1']);
    const legend = screen.getByTestId('kit-graph-legend');
    expect(legend.textContent).toContain('требует');
    expect(legend.textContent).toContain('квиз темы');
  });

  it('обрезан лимитом — сказано, сколько показано из скольких', () => {
    view('graph', ctxOf(cfg({ graph: { depth: 1, limit: 1 } })));
    expect(screen.getByTestId('kit-graph').textContent).toMatch(/1.*3/);
  });

  it('без рёбер — проверенный ноль', () => {
    view('graph', ctxOf(cfg(), dat({ edges: [] })));
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
  });
});

describe('K-04 · Журнал', () => {
  it('только эта запись, новые сверху, агент помечен, кто согласовал', () => {
    view('journal');
    const rows = screen.getAllByTestId('kit-journal-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('question');
    expect(rows[0].textContent).toContain('старое');
    expect(rows[0].textContent).toContain('новое');
    expect(rows[0].textContent).toContain('Оля');
    expect(rows[1].getAttribute('data-agent')).toBe('true');
  });

  it('пусто — проверенный ноль', () => {
    view('journal', ctxOf(cfg(), dat({ journal: [] })));
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
  });
});

describe('K-04 · доступность', () => {
  for (const tab of ['overview', 'links', 'graph', 'journal']) {
    it(`axe без нарушений: ${tab}`, async () => {
      const { container } = view(tab);
      expect(await axeViolations(container)).toEqual([]);
    });
  }
});

describe('K-04 · вкладка в URL', () => {
  function Probe({ win }: { win: Parameters<typeof useRecordTab>[1] }) {
    const [tab, setTab] = useRecordTab('overview', win);
    return <button type="button" onClick={() => setTab('graph')}>{tab}</button>;
  }

  it('читает ?tab= и пишет обратно', () => {
    const pushState = vi.fn();
    const win = { location: { pathname: '/r', search: '?tab=links', hash: '' }, history: { pushState, replaceState: vi.fn() } };
    render(<Probe win={win} />);
    const b = screen.getByRole('button');
    expect(b.textContent).toBe('links');
    fireEvent.click(b);
    expect(b.textContent).toBe('graph');
    expect(pushState).toHaveBeenCalledWith(null, '', '/r?tab=graph');
  });

  it('pushState бросил (песочница) — фолбэк в #', () => {
    const win = {
      location: { pathname: '/r', search: '', hash: '' },
      history: { pushState: () => { throw new Error('sandbox'); }, replaceState: vi.fn() },
    };
    render(<Probe win={win} />);
    fireEvent.click(screen.getByRole('button'));
    expect(win.location.hash).toBe('#tab=graph');
  });
});
