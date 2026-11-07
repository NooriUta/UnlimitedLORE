// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-12 · Peek записи: задачи и текст, кнопка
// «Читать целиком» ведёт в режим чтения (S5-04/S5-05). Состояние peek — в URL.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { PEEK_PARAM, RecordPeek, peekTasks, useRecordPeek } from './index';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));
afterEach(() => window.history.replaceState(null, '', '/'));

const S: KitRecord = {
  id: 'SPR-1', kind: 'sprint', title: 'Спринт рун', status: 'in_progress',
  fields: {}, body_md: '## Цель\n\nсобрать руны', updated_at: '2026-11-07T10:00:00Z',
};
const T1: KitRecord = { id: 'SPR-1/T-1', kind: 'task', title: 'Вырезать ᚠ', status: 'done', fields: {} };
const T2: KitRecord = { id: 'SPR-1/T-2', kind: 'task', title: 'Вырезать ᚢ', status: 'todo', fields: {} };
const T3: KitRecord = { id: 'SPR-1/T-3', kind: 'task', title: 'Вырезать ᚦ', status: 'in_progress', fields: {} };

function cfg(): KitConfig {
  return {
    modules: [], menu: { groups: [] },
    kinds: { sprint: { title: 'Спринты', icon: 'sprint' }, task: { title: 'Задачи', icon: 'checkbox-tree' } },
    edges: { IN_SPRINT: { label: 'в спринте', color: '--acc' }, DEPENDS_ON: { label: 'зависит от', color: '--wrn' } },
    statuses: {
      items: [
        { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: '--t2' },
        { code: 'in_progress', title: 'В работе', category: 'active', icon: 'progression', color: '--acc' },
        { code: 'done', title: 'Готово', category: 'done', icon: 'check-mark', color: '--suc' },
      ],
    },
  };
}

function dat(over: Partial<KitData> = {}): KitData {
  return {
    records: [S, T1, T2, T3],
    edges: [
      { from: 'SPR-1/T-1', to: 'SPR-1', type: 'IN_SPRINT' },
      { from: 'SPR-1/T-2', to: 'SPR-1', type: 'IN_SPRINT' },
      { from: 'SPR-1/T-3', to: 'SPR-1', type: 'IN_SPRINT' },
      { from: 'SPR-1/GHOST', to: 'SPR-1', type: 'IN_SPRINT' },
      { from: 'SPR-1/T-2', to: 'SPR-1/T-1', type: 'DEPENDS_ON' },
    ],
    journal: [],
    meta: { generated_at: '2026-11-07T12:00:00Z' },
    ...over,
  };
}

function ctxOf(data = dat()): KitCtx {
  return {
    data, config: cfg(),
    href: id => `?passport=${encodeURIComponent(id)}`,
    esc: s => s,
    md: s => <div data-testid="md">{s}</div>,
  };
}

function peek(props: Partial<Parameters<typeof RecordPeek>[0]> = {}) {
  const onClose = vi.fn();
  const onReadFull = vi.fn();
  const r = render(
    <RecordPeek record={S} ctx={ctxOf()} onClose={onClose} onReadFull={onReadFull} taskEdges={['IN_SPRINT']} {...props} />,
  );
  return { ...r, onClose, onReadFull };
}

describe('S5-12 · peekTasks', () => {
  it('задачи — входящие рёбра заданных типов; вне выборки помечены, чужие типы не берутся', () => {
    const t = peekTasks('SPR-1', ctxOf(), ['IN_SPRINT']);
    expect(t.map(x => x.id)).toEqual(['SPR-1/T-1', 'SPR-1/T-2', 'SPR-1/T-3', 'SPR-1/GHOST']);
    expect(t[3].record).toBeUndefined();
    expect(peekTasks('SPR-1/T-1', ctxOf(), ['IN_SPRINT'])).toEqual([]);
  });
});

describe('S5-12 · peek записи', () => {
  it('диалог с заголовком записи; задачи идут раньше текста', () => {
    peek();
    const dlg = screen.getByRole('dialog', { name: 'Спринт рун' });
    const tasks = within(dlg).getByTestId('kit-peek-tasks');
    const text = within(dlg).getByTestId('kit-peek-text');
    expect(tasks.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('задачи: статус словами, заголовок-ссылка, счёт готовых «1 из 4»', () => {
    peek();
    const tasks = screen.getByTestId('kit-peek-tasks');
    const rows = within(tasks).getAllByTestId('kit-peek-task');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('Готово');
    expect(within(rows[1]).getByRole('link', { name: /Вырезать ᚢ/ }).getAttribute('href')).toBe('?passport=SPR-1%2FT-2');
    expect(rows[3].getAttribute('data-missing')).toBe('true');
    expect(tasks.textContent).toContain('1 из 4');
  });

  it('текст записи — через ctx.md (рендер чтения kit)', () => {
    peek();
    expect(within(screen.getByTestId('kit-peek-text')).getByTestId('md').textContent).toContain('собрать руны');
  });

  it('«Читать целиком» — onReadFull(id)', () => {
    const { onReadFull } = peek();
    fireEvent.click(screen.getByRole('button', { name: 'Читать целиком' }));
    expect(onReadFull).toHaveBeenCalledWith('SPR-1');
  });

  it('с readHref кнопка — ссылка на режим чтения (открывается и в новой вкладке)', () => {
    peek({ readHref: id => `?passport=${id}&read=1` });
    const a = screen.getByRole('link', { name: 'Читать целиком' });
    expect(a.getAttribute('href')).toBe('?passport=SPR-1&read=1');
  });

  it('без taskEdges блока задач нет (peek задачи — только текст)', () => {
    peek({ record: T1, taskEdges: undefined });
    expect(screen.queryByTestId('kit-peek-tasks')).toBeNull();
    expect(screen.getByTestId('kit-peek-text')).toBeTruthy();
  });

  it('record=null — peek закрыт', () => {
    peek({ record: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('много задач — показан лимит и «ещё N — в полном чтении»', () => {
    peek({ taskLimit: 2 });
    expect(screen.getAllByTestId('kit-peek-task')).toHaveLength(2);
    expect(screen.getByTestId('kit-peek-tasks').textContent).toContain('ещё 2');
  });
});

describe('S5-12 · честные состояния peek', () => {
  it('задач нет — проверенный ноль, а не пустота', () => {
    peek({ ctx: ctxOf(dat({ edges: [] })) });
    const tasks = screen.getByTestId('kit-peek-tasks');
    expect(tasks.querySelector('[data-state="empty"]')).toBeTruthy();
    expect(tasks.textContent).toContain('Задач нет');
  });

  it('рёбра не загрузились — ошибка, а не «задач нет»', () => {
    peek({ ctx: ctxOf(dat({ meta: { generated_at: 'x', errors: [{ block: 'edges', reason: 'HTTP 503' }] } })) });
    const tasks = screen.getByTestId('kit-peek-tasks');
    expect(tasks.querySelector('[data-state="error"]')).toBeTruthy();
    expect(tasks.textContent).toContain('HTTP 503');
    expect(tasks.textContent).not.toContain('Задач нет');
  });

  it('выборка обрезана — пометка, что задач может быть больше', () => {
    peek({ ctx: ctxOf(dat({ meta: { generated_at: 'x', truncated: true } })) });
    expect(screen.getByTestId('kit-peek-tasks').textContent).toContain('задач может быть больше');
  });

  it('текста нет — «Текста нет», а не пустой блок', () => {
    peek({ record: { ...S, body_md: '  ' } });
    expect(screen.getByTestId('kit-peek-text').textContent).toContain('Текста нет');
  });

  it('en: подписи из локали kit', () => {
    render(
      <KitLangProvider lang="en">
        <RecordPeek record={S} ctx={ctxOf()} onClose={() => {}} onReadFull={() => {}} taskEdges={['IN_SPRINT']} />
      </KitLangProvider>,
    );
    expect(screen.getByRole('button', { name: 'Read in full' })).toBeTruthy();
    expect(screen.getByTestId('kit-peek-tasks').textContent).toContain('1 of 4');
  });

  it('axe: без нарушений', async () => {
    peek();
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });
});

describe('S5-12 · peek в URL', () => {
  it('open/close пишут ?peek=…, значение читается обратно', () => {
    const { result } = renderHook(() => useRecordPeek());
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]('SPR-1'));
    expect(new URLSearchParams(window.location.search).get(PEEK_PARAM)).toBe('SPR-1');
    expect(result.current[0]).toBe('SPR-1');
    act(() => result.current[2]());
    expect(new URLSearchParams(window.location.search).get(PEEK_PARAM)).toBeNull();
    expect(result.current[0]).toBeNull();
  });
});
