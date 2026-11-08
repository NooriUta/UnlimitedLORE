// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-27 — «Показывать закрытые»: внизу, свёрнуты / все / за 30 дней / скрыть.
// Скрин владелицы (прототип v4, «Вид · дополнительно»): закрытые = категории
// «завершено» и «снято»; у ADR «принято» — открытая категория (это задаёт
// конфиг статусов, а не kit). Режим — часть состояния списка (URL lc) и
// сохранённого вида; умолчание — из конфига (list.showClosed), иначе «все»: kit нейтрален,
// разделы LORE (спринты, ADR) включают «внизу» своим конфигом.
// Скрытое — числом: группа «Закрытые N», «Показано N из M» честно.
// «За 30 дней» отсчитываются от момента выдачи (meta.generated_at), а не от часов браузера:
// один и тот же ответ сервера даёт один и тот же список.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { validateKitConfig } from '../core/validate';
import { ListView } from './ListView';
import { readListState, splitClosed, writeListState, DEFAULT_LIST_STATE } from './listModel';

beforeAll(() => { registerGameIcons(gameIcons); });

const NOW = '2026-11-08T12:00:00Z';
const rec = (id: string, status: string, updated_at = '2026-11-01T00:00:00Z'): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {}, updated_at });

const cfg = (showClosed?: 'below' | 'all' | 'days30' | 'hide'): KitConfig => ({
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'accepted', title: 'принято', category: 'active', icon: 'laurel-crown', color: 'var(--suc)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
    { code: 'cancelled', title: 'снято', category: 'cancelled', icon: 'cross-mark', color: 'var(--t3)' },
  ] },
  list: { views: ['list', 'board'], columns: ['title+id', 'status'], groupings: ['status'], ...(showClosed ? { showClosed } : {}) },
});

const recs = [
  rec('a', 'todo'), rec('b', 'accepted'),
  rec('c', 'done', '2026-11-05T00:00:00Z'), // закрыта 3 дня назад
  rec('d', 'done', '2026-08-01T00:00:00Z'), // закрыта давно
  rec('e', 'cancelled', '2026-10-20T00:00:00Z'),
];
const data = (): KitData => ({ records: recs, edges: [], journal: [], meta: { generated_at: NOW, total: 5, truncated: false } });
const ids = (c: HTMLElement) => [...c.querySelectorAll('tbody [data-record-id]')].map(r => r.getAttribute('data-record-id'));

describe('модель: splitClosed', () => {
  it('закрытые — категории done и cancelled; «принято» (active) — открытое', () => {
    const s = splitClosed(recs, 'below', cfg(), NOW);
    expect(s.open.map(r => r.id)).toEqual(['a', 'b']);
    expect(s.closed.map(r => r.id)).toEqual(['c', 'd', 'e']);
  });
  it('all — всё открыто; hide — закрытые убраны, но посчитаны', () => {
    expect(splitClosed(recs, 'all', cfg(), NOW).open).toHaveLength(5);
    const h = splitClosed(recs, 'hide', cfg(), NOW);
    expect(h.open.map(r => r.id)).toEqual(['a', 'b']);
    expect(h.hidden).toBe(3);
  });
  it('days30 — закрытые за последние 30 дней остаются в выдаче, старые скрыты', () => {
    const s = splitClosed(recs, 'days30', cfg(), NOW);
    expect(s.open.map(r => r.id)).toEqual(['a', 'b', 'c', 'e']);
    expect(s.hidden).toBe(1);
  });
  it('режим в URL: lc, умолчание не пишется', () => {
    expect(writeListState({ ...DEFAULT_LIST_STATE, closed: 'hide' }).lc).toBe('hide');
    expect(writeListState(DEFAULT_LIST_STATE).lc).toBeNull();
    expect(readListState(new URLSearchParams('lc=days30')).closed).toBe('days30');
    expect(readListState(new URLSearchParams('lc=мусор')).closed).toBeUndefined();
  });
});

describe('контракт: list.showClosed', () => {
  it('известные режимы проходят, чужой — ошибка конфига', () => {
    const listErrors = (c: unknown) => validateKitConfig(c).errors.filter(e => e.path.startsWith('list'));
    expect(listErrors(cfg('days30'))).toEqual([]);
    expect(listErrors({ ...cfg(), list: { ...cfg().list!, showClosed: 'never' as never } }).map(e => e.path)).toContain('list.showClosed');
  });
});

describe('список: «Закрытые N»', () => {
  it('без list.showClosed — все записи, группы «Закрытые» нет (kit нейтрален)', () => {
    const { container } = render(<ListView config={cfg()} data={data()} urlState={false} />);
    expect(ids(container)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(screen.queryByRole('button', { name: /Закрытые/ })).toBeNull();
  });

  it('«внизу, свёрнуты»: открытые сверху, группа «Закрытые 3» свёрнута и раскрывается', () => {
    const { container } = render(<ListView config={cfg('below')} data={data()} urlState={false} />);
    expect(ids(container)).toEqual(['a', 'b']);
    const btn = screen.getByRole('button', { name: /Закрытые\s*3/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(ids(container)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 5 из 5');
  });

  it('hide — закрытых нет, но «Показано 2 из 5» и пометка, сколько скрыто', () => {
    const { container } = render(<ListView config={cfg('hide')} data={data()} urlState={false} />);
    expect(ids(container)).toEqual(['a', 'b']);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 2 из 5');
    expect(screen.getByTestId('kit-list-closed-hidden').textContent).toContain('3');
  });

  it('с группировкой «внизу» — закрытые одной группой в конце, а не внутри статусов', () => {
    const { container } = render(<ListView config={cfg('below')} data={data()} urlState={false} initial={{ group: 'status' }} />);
    const heads = [...container.querySelectorAll('[data-group-key]')].map(g => g.getAttribute('data-group-key'));
    expect(heads[heads.length - 1]).toBe('__closed__');
    expect(heads).not.toContain('done');
  });
});

describe('поповер «Вид»: режим закрытых', () => {
  it('кнопка «Вид» открывает панель с выбором режима; выбор применяется к списку', () => {
    const { container } = render(<ListView config={cfg('below')} data={data()} urlState={false} head={{ title: 'Задачи' }} />);
    fireEvent.click(within(screen.getByTestId('kit-screenhead')).getByRole('button', { name: /Вид/ }));
    const dlg = screen.getByRole('dialog', { name: /Вид/ });
    const seg = within(dlg).getByRole('radiogroup', { name: /Показывать закрытые/ });
    expect(within(seg).getByRole('radio', { name: /внизу/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(seg).getByRole('radio', { name: /все/ }));
    expect(ids(container)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(screen.queryByRole('button', { name: /Закрытые\s*3/ })).toBeNull();
  });
});
