// @vitest-environment jsdom
// Хаб в графе на экране: кластер «N ▸» и список связей первым на телефоне
// (SPRINT_UXR_S9_SCALE_OPT/S9-08).
//
// Критерий задачи дословно: «хаб показывает кластер „N релизов ▸" вместо N
// узлов, на телефоне первым открывается список связей».
//
// Слово «релизов» в подписи — предметное, и kit его не знает: подпись даёт
// конфиг приложения (`config.edges[type].label`), водораздел K-14. Поэтому
// здесь проверяется, что на экране стоит ПОДПИСЬ ТИПА РЕБРА и число, а не
// выдуманное слово.
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitData, KitEdge, KitRecord } from '../core/contract';
import { RecordGraph } from './RecordGraph';
import { GRAPH_CLUSTER_MAX } from './graph';

const rec = (id: string): KitRecord => ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: {} });

const config = {
  modules: [], menu: { groups: [] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  edges: { MANY: { label: 'Много чего', color: 'var(--acc)' }, FEW: { label: 'Мало чего', color: 'var(--inf)' } },
  graph: { depth: 1 as const, limit: 1000 },
} as unknown as KitConfig;

function hub(n: number, few = 2): KitData {
  const records = [rec('ego'), ...Array.from({ length: n }, (_, i) => rec(`m${i}`)), ...Array.from({ length: few }, (_, i) => rec(`f${i}`))];
  const edges: KitEdge[] = [
    ...Array.from({ length: n }, (_, i) => ({ from: 'ego', to: `m${i}`, type: 'MANY' })),
    ...Array.from({ length: few }, (_, i) => ({ from: 'ego', to: `f${i}`, type: 'FEW' })),
  ];
  return { records, edges, journal: [], meta: { generated_at: '2026-11-10T12:00:00Z', total: records.length } };
}

const ctxOf = (data: KitData): KitCtx => ({
  config, data, href: (id: string) => `/r/${id}`, role: 'reader', lang: 'ru',
} as unknown as KitCtx);

function draw(n: number, narrow?: boolean) {
  const data = hub(n);
  return render(<RecordGraph record={rec('ego')} ctx={ctxOf(data)} lang="ru" narrow={narrow} />);
}

// Состояние графа живёт в АДРЕСЕ, а адрес в jsdom один на весь файл: клик по
// «раскрыть» в одной проверке оставлял gopen=… всем следующим, и они видели уже
// раскрытый кластер. Поймано первым прогоном — поэтому адрес чистится до каждой.
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const clusters = (c: HTMLElement) => [...c.querySelectorAll('[data-cluster]')];
const nodes = (c: HTMLElement) => [...c.querySelectorAll('[data-node]')];

describe('S9-08 · кластер вместо сотни кружков', () => {
  it('положительный контроль: соседей в пределах потолка — кружки, кластеров нет', () => {
    const { container } = draw(GRAPH_CLUSTER_MAX, false);
    expect(clusters(container)).toHaveLength(0);
    // Центр плюс соседи обоих типов.
    expect(nodes(container).length).toBeGreaterThan(GRAPH_CLUSTER_MAX);
  });

  it('соседей больше потолка — на холсте ОДИН кластер вместо них', () => {
    const { container } = draw(149, false);
    expect(clusters(container)).toHaveLength(1);
    expect(container.querySelectorAll('[data-node^="m"]')).toHaveLength(0);
  });

  it('кластер несёт ЧИСЛО и ПОДПИСЬ ТИПА из конфига, а не выдуманное слово', () => {
    const { container } = draw(149, false);
    const text = clusters(container)[0].textContent ?? '';
    expect(text).toMatch(/149/);
    expect(text).toMatch(/Много чего/);
  });

  it('связи другого типа не пропали: хаб их больше не вытесняет', () => {
    const { container } = draw(149, false);
    expect(container.querySelectorAll('[data-node^="f"]')).toHaveLength(2);
  });

  it('кластер раскрывается нажатием — узлы возвращаются на холст', () => {
    const { container } = draw(20, false);
    fireEvent.click(clusters(container)[0].querySelector('[data-cluster-open]')!);
    expect(container.querySelectorAll('[data-node^="m"]').length).toBe(20);
  });

  it('кластер — настоящая кнопка: он работает и с клавиатуры', () => {
    const { container } = draw(20, false);
    const btn = clusters(container)[0].querySelector('[data-cluster-open]')!;
    expect(btn.tagName.toLowerCase(), 'не кнопка — значит недоступно без мыши').toBe('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('S9-08 · честность числа кластера', () => {
  it('выдача обрезана лимитом — сказано, что под кластером может быть больше', () => {
    const data = hub(149);
    const cut = { ...config, graph: { depth: 1 as const, limit: 40 } } as KitConfig;
    const { container } = render(
      <RecordGraph record={rec('ego')} ctx={{ ...ctxOf(data), config: cut } as KitCtx} lang="ru" narrow={false} />,
    );
    const c = clusters(container)[0];
    expect(c.getAttribute('data-at-least')).toBe('true');
    expect((c.textContent ?? '') + (c.querySelector('title')?.textContent ?? ''), 'точное число там, где его нет').toMatch(/\+|не меньше|не менее/i);
  });

  it('выдача целая — число точное, без оговорки', () => {
    const { container } = draw(149, false);
    expect(clusters(container)[0].getAttribute('data-at-least')).toBeNull();
  });
});

describe('S9-08 · телефон: первым список связей', () => {
  it('на узком экране по умолчанию открыт СПИСОК, а не холст', () => {
    const { container } = draw(149, true);
    expect(container.querySelector('.sk-rec-graph__svg'), 'граф на телефоне не читается').toBeNull();
    expect(container.querySelector('[data-testid="kit-graph-links"]')).toBeTruthy();
  });

  it('на широком экране по умолчанию холст', () => {
    const { container } = draw(149, false);
    expect(container.querySelector('.sk-rec-graph__svg')).toBeTruthy();
  });

  it('переключатель есть на обеих ширинах: выбор за человеком, а не за порогом', () => {
    for (const narrow of [true, false]) {
      const { container, unmount } = draw(149, narrow);
      expect(within(container).getByTestId('kit-graph-view'), `ширина narrow=${narrow}`).toBeTruthy();
      unmount();
    }
  });

  it('на телефоне можно переключиться на холст', () => {
    const { container } = draw(149, true);
    const sw = within(container).getByTestId('kit-graph-view');
    fireEvent.click(within(sw).getByRole('button', { name: /граф|холст|секторы/i }));
    expect(container.querySelector('.sk-rec-graph__svg')).toBeTruthy();
  });

  it('в списке связей хаб тоже не каша: однотипные свёрнуты числом', () => {
    const { container } = draw(149, true);
    const list = container.querySelector('[data-testid="kit-graph-links"]')!;
    expect(list.textContent).toMatch(/149/);
    expect(list.querySelectorAll('[data-node^="m"]').length, 'сто сорок девять строк — та же каша').toBeLessThan(149);
  });
});
