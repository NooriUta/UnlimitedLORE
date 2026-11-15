// @vitest-environment jsdom
// Хаб графа — приёмка 13.11 (SPRINT_UXR_POLISH_UAT_1113/PU-11, к S9-08). FORSETI → Граф: 27 спек.
//  1) подпись кластера — числом и ВИДОМ узлов («27 спек ▸»), если приложение дало формы слова
//     (graph.types[вид].count); иначе — как раньше, подписью типа связи;
//  2) кластер целиком внутри холста (был «DOCUMENTED_IN: 32» за правым краем);
//  3) правило кластера одно для всех раскладок: в Force/Обсидиане хаб — один узел-кластер,
//     щелчок раскрывает; раньше там все узлы шли поштучно;
//  4) у записи, где ВСЕ соседи свёрнуты, граф не объявляется пустым.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitEdge, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { RecordView } from './index';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  return (
    <div data-testid={`eng-${name}`} data-ids={p.nodes.map(n => n.id).join(',')} data-titles={p.nodes.map(n => n.title ?? '').join('|')}>
      {p.nodes.map(n => <button key={n.id} type="button" onClick={() => p.onSelect(n.id)}>{`узел ${n.id}`}</button>)}
    </div>
  );
};
vi.mock('../graph/ForceEngine', () => ({ default: stub('force') }));
vi.mock('../graph/ObsidianEngine', () => ({ default: stub('obsidian') }));

beforeAll(() => registerGameIcons(gameIcons));
beforeEach(() => window.history.replaceState(null, '', '/r'));
afterEach(() => { window.history.replaceState(null, '', '/r'); localStorage.clear(); });

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: `Запись ${id}`, status: 'ok', fields: {} });
const CENTER = rec('FORSETI', 'component');
const SPECS = Array.from({ length: 27 }, (_, i) => rec(`SPEC-${i}`, 'spec'));

const cfg = (withCount = true): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { component: { title: 'Компонент', icon: 'scroll-quill' } },
  edges: { DOCUMENTED_IN: { label: 'DOCUMENTED_IN', color: '--wrn' }, OWNS: { label: 'владеет', color: '--acc' } },
  graph: {
    depth: 1, limit: 60, colorBy: 'type',
    types: { spec: { label: 'Спека', color: '--wrn', ...(withCount ? { count: { one: '{n} спека', few: '{n} спеки', many: '{n} спек' } } : {}) } },
  },
  statuses: { items: [{ code: 'ok', title: 'ок', category: 'done', icon: 'check-mark', color: '--suc' }] },
} as KitConfig);
const dataOf = (extra = true): KitData => ({
  records: [CENTER, ...SPECS, rec('T-1', 'task')],
  edges: [
    ...SPECS.map(s => ({ from: s.id, to: 'FORSETI', type: 'DOCUMENTED_IN' }) as KitEdge),
    ...(extra ? [{ from: 'FORSETI', to: 'T-1', type: 'OWNS' } as KitEdge] : []),
  ],
  journal: [], meta: { generated_at: '2026-11-13T12:00:00Z' },
});
const show = (config = cfg(), data = dataOf()) => {
  const ctx: KitCtx = { data, config, href: id => `#rec=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div> };
  return render(<RecordView record={CENTER} ctx={ctx} tab="graph" onTab={() => {}} />);
};

/** Подпись узла-кластера — то, что получил движок (вид по умолчанию — Обсидиан, 16.11). */
async function clusterTitle(): Promise<string> {
  const eng = await screen.findByTestId('eng-obsidian');
  const ids = eng.getAttribute('data-ids')!.split(',');
  const titles = eng.getAttribute('data-titles')!.split('|');
  return titles[ids.findIndex(i => i.startsWith('cluster:'))] ?? '';
}

describe('PU-11 · хаб графа', () => {
  it('подпись кластера — «27 спек ▸» по формам слова от приложения', async () => {
    show();
    expect(await clusterTitle()).toBe('27 спек ▸');
  });
  it('форм слова нет — прежняя подпись типом связи (положительный контроль совместимости)', async () => {
    show(cfg(false));
    expect(await clusterTitle()).toContain('DOCUMENTED_IN');
  });
  it('все соседи свёрнуты — граф не «пустой», кластер на месте', async () => {
    show(cfg(), dataOf(false));
    expect(await clusterTitle()).toBe('27 спек ▸');
  });
  // Приёмка preprod 14.11 (v1.17.21): OMILORE — 48 соседей по DOCUMENTED_IN, из них 25 спек и
  // 23 технологии (вид tech). Видов два — и подпись падала на код связи «DOCUMENTED_IN: 48»,
  // хотя формы слова есть у обоих. Правило: у смешанного хаба — счёт по каждому виду.
  const mixedCfg = (techForms = true): KitConfig => {
    const c = cfg();
    return { ...c, graph: { ...c.graph!, types: { ...c.graph!.types,
      tech: { label: 'Технология', color: '--wrn', ...(techForms ? { count: { one: '{n} технология', few: '{n} технологии', many: '{n} технологий' } } : {}) } } } } as KitConfig;
  };
  const mixedData = (): KitData => {
    const specs = Array.from({ length: 25 }, (_, i) => rec(`SPEC-${i}`, 'spec'));
    const techs = Array.from({ length: 23 }, (_, i) => rec(`SPEC-TECH-${i}`, 'tech'));
    return {
      records: [CENTER, ...specs, ...techs],
      edges: [...specs, ...techs].map(s => ({ from: 'FORSETI', to: s.id, type: 'DOCUMENTED_IN' }) as KitEdge),
      journal: [], meta: { generated_at: '2026-11-14T12:00:00Z' },
    };
  };
  it('смешанный хаб (спеки + технологии) — счёт по видам, а не код связи', async () => {
    show(mixedCfg(), mixedData());
    expect(await clusterTitle()).toBe('25 спек · 23 технологии ▸');
  });
  it('смешанный хаб, у одного вида нет форм — подпись типом связи (положительный контроль)', async () => {
    show(mixedCfg(false), mixedData());
    expect(await clusterTitle()).toContain('DOCUMENTED_IN');
  });
  it('Force: подпись узла-кластера смешанного хаба — тоже по видам', async () => {
    window.history.replaceState(null, '', '/r?gview=force');
    show(mixedCfg(), mixedData());
    const eng = await screen.findByTestId('eng-force');
    expect(eng.getAttribute('data-titles')!.split('|')).toContain('25 спек · 23 технологии ▸');
  });
  it('Force: хаб — один узел-кластер, а не 27 узлов; выбор кластера раскрывает его', async () => {
    window.history.replaceState(null, '', '/r?gview=force');
    show();
    const eng = await screen.findByTestId('eng-force');
    const ids = eng.getAttribute('data-ids')!.split(',');
    expect(ids.filter(i => i.startsWith('SPEC-'))).toHaveLength(0);
    expect(ids.some(i => i.includes('DOCUMENTED_IN'))).toBe(true);
    // S9-08 (препрод 14.11): одиночное нажатие на кластер раскрывает его сразу, без карточки.
    fireEvent.click(screen.getByRole('button', { name: /узел .*DOCUMENTED_IN/ }));
    const after = (await screen.findByTestId('eng-force')).getAttribute('data-ids')!.split(',');
    expect(after.filter(i => i.startsWith('SPEC-'))).toHaveLength(27);
  });
});
