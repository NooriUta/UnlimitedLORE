// @vitest-environment jsdom
// SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03 · GraphExplorer: два вида (Force / как
// Обсидиан), левая панель как у Обсидиана, честные состояния. Движки рисуют
// canvas/WebGL, которых в jsdom нет, — здесь они подменены заглушками, а сами
// движки проверяются в браузере (скриншоты в PR).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { GxEngineProps } from './engineTypes';
import { GraphExplorer } from './GraphExplorer';
import type { GxEdge, GxNode } from './settings';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  useEffect(() => { if (p.nodes.some(n => n.id === 'BOOM')) p.onError(new Error('webgl недоступен')); }, [p]);
  return (
    <div data-testid={`eng-${name}`} data-nodes={p.nodes.length} data-edges={p.edges.length}
      data-repel={p.settings.repel} data-color={p.nodes[0] ? p.nodeColor(p.nodes[0]) : ''}>
      {p.nodes.map(n => <button key={n.id} type="button" onClick={() => p.onSelect(n.id)}>{`узел ${n.id}`}</button>)}
    </div>
  );
};
vi.mock('./ForceEngine', () => ({ default: stub('force') }));
vi.mock('./ObsidianEngine', () => ({ default: stub('obsidian') }));

const N: GxNode[] = [
  { id: 'ADR-1', type: 'adr', title: 'Граф в kit' },
  { id: 'T-1', type: 'task', title: 'Сделать панель' },
  { id: 'T-2', type: 'task', title: 'Починить данные' },
  { id: 'C-1', type: 'component', title: 'SEIDRKIT_GRAPH' },
  { id: 'LONE', type: 'task', title: 'Без связей' },
];
const E: GxEdge[] = [
  { from: 'T-1', to: 'ADR-1', rel: 'JUSTIFIED_BY' },
  { from: 'T-2', to: 'ADR-1', rel: 'JUSTIFIED_BY' },
  { from: 'ADR-1', to: 'C-1', rel: 'BELONGS_TO' },
];
const TYPES = { adr: { label: 'ADR', color: '--suc' }, task: { label: 'Задача', color: '--t2' }, component: { label: 'Компонент', color: '--acc' } };

afterEach(() => localStorage.clear());

describe('GC-03 · GraphExplorer', () => {
  it('по умолчанию вид Force, счёт узлов и связей словами', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t1" />);
    expect((await screen.findByTestId('eng-force')).getAttribute('data-nodes')).toBe('5');
    expect(screen.getByTestId('gx-count').textContent).toBe('узлов 5 · связей 3');
  });

  it('переключатель вида: Обсидиан рисует тем же набором данных и сообщает о выборе', async () => {
    const onEngineChange = vi.fn();
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t2" onEngineChange={onEngineChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обсидиан' }));
    expect((await screen.findByTestId('eng-obsidian')).getAttribute('data-edges')).toBe('3');
    expect(onEngineChange).toHaveBeenCalledWith('obsidian');
  });

  it('панель как у Обсидиана: четыре раздела, тип снимается чекбоксом — «показано N из M»', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t3" />);
    const panel = screen.getByTestId('gx-panel');
    expect([...panel.querySelectorAll('summary')].map(s => s.textContent)).toEqual(['Фильтры', 'Группы', 'Отображение', 'Силы']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Компонент/ }));
    await waitFor(() => expect(screen.getByTestId('eng-force').getAttribute('data-nodes')).toBe('4'));
    expect(screen.getByTestId('gx-count').textContent).toBe('показано 4 из 5 · связей 2');
  });

  it('силы уходят в движок; настройки панели запоминаются в браузере по ключу места', async () => {
    const { unmount } = render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t4" />);
    fireEvent.change(screen.getByLabelText('Отталкивание'), { target: { value: '15' } });
    expect((await screen.findByTestId('eng-force')).getAttribute('data-repel')).toBe('15');
    unmount();
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t4" />);
    expect((await screen.findByTestId('eng-force')).getAttribute('data-repel')).toBe('15');
  });

  it('группа красит узлы по запросу поверх цвета типа', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t5" />);
    expect((await screen.findByTestId('eng-force')).getAttribute('data-color')).toBe('var(--suc, var(--t3))');
    fireEvent.click(screen.getByRole('button', { name: 'Новая группа' }));
    fireEvent.change(screen.getByLabelText('Запрос группы'), { target: { value: 'type:adr' } });
    await waitFor(() => expect(screen.getByTestId('eng-force').getAttribute('data-color')).toBe('var(--acc, var(--t3))'));
  });

  it('фильтры скрыли всё — это сказано и есть сброс, а не пустой холст', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t6" />);
    fireEvent.change(screen.getByLabelText('Поиск по графу'), { target: { value: 'нет-такого' } });
    expect(await screen.findByText('Фильтры скрыли все узлы')).toBeTruthy();
    expect(screen.queryByTestId('eng-force')).toBeNull();
    fireEvent.click((b => b[b.length - 1])(screen.getAllByRole('button', { name: 'Сбросить настройки' })));
    expect((await screen.findByTestId('eng-force')).getAttribute('data-nodes')).toBe('5');
  });

  it('движок не отрисовался — ошибка названа, а не пустой холст', async () => {
    render(<GraphExplorer nodes={[...N, { id: 'BOOM', type: 'task' }]} edges={E} types={TYPES} lang="ru" storageKey="t7" />);
    expect(await screen.findByText('Граф не отрисовался')).toBeTruthy();
    expect(screen.getByText(/webgl недоступен/)).toBeTruthy();
  });

  it('выбранный узел — подпись и обычная ссылка «Открыть» по адресу приложения', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t8" hrefOf={id => `?passport=${id}`} />);
    fireEvent.click(await screen.findByRole('button', { name: 'узел T-1' }));
    const sel = screen.getByTestId('gx-selected');
    expect(sel.textContent).toContain('Сделать панель');
    expect(sel.querySelector('a')!.getAttribute('href')).toBe('?passport=T-1');
  });

  it('Peek: выбранный узел — карточка приложения вместо строки; крестик закрывает', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t10"
      renderSelected={id => <article data-testid="peek-card">{`Карточка ${id}`}</article>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'узел ADR-1' }));
    expect(screen.getByTestId('peek-card').textContent).toBe('Карточка ADR-1');
    expect(screen.queryByTestId('gx-selected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть карточку' }));
    expect(screen.queryByTestId('peek-card')).toBeNull();
  });

  it('панель прячется и возвращается кнопкой', async () => {
    render(<GraphExplorer nodes={N} edges={E} types={TYPES} lang="ru" storageKey="t9" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Скрыть настройки' })); });
    expect(screen.queryByTestId('gx-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(screen.getByTestId('gx-panel')).toBeTruthy();
  });
});
