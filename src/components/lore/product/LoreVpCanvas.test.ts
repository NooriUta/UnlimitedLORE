import { describe, it, expect } from 'vitest';
import { buildStickerNode, vpConnection, sharedValues, crossSegmentScenarios } from './LoreVpCanvas';

// FIT-06: тест-страж на конкретную регрессию 2026-07-23 — замена width/height
// (верхний уровень узла) на style: { width, height } прошла типы, тесты и
// сборку, и уронила ВСЕ рёбра ReactFlow-канвы разом, без единой ошибки в
// консоли (движок считает позиции хендлов по верхнеуровневым width/height,
// а не по CSS). Один assert закрывает весь класс правки.
describe('buildStickerNode (FIT-06)', () => {
  it('несёт width/height числами на ВЕРХНЕМ уровне узла', () => {
    const node = buildStickerNode({
      id: 'PAIN-X', parentId: 'pains', width: 114, height: 74,
      position: { x: 0, y: 0 }, title: 'Боль', code: 'PAIN-X',
      color: 'var(--pain)', rank: null, dim: false,
    });
    expect(node.width).toBe(114);
    expect(node.height).toBe(74);
  });

  it('НЕ дублирует геометрию в style — движок её там не читает', () => {
    const node = buildStickerNode({
      id: 'PAIN-X', parentId: 'pains', width: 114, height: 74,
      position: { x: 0, y: 0 }, title: 'Боль', code: 'PAIN-X',
      color: 'var(--pain)', rank: null, dim: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const style = (node as any).style;
    expect(style?.width).toBeUndefined();
    expect(style?.height).toBeUndefined();
  });

  it('extent: parent — стикер не может уехать из своей секции', () => {
    const node = buildStickerNode({
      id: 'PAIN-X', parentId: 'pains', width: 114, height: 74,
      position: { x: 0, y: 0 }, title: 'Боль', code: 'PAIN-X',
      color: 'var(--pain)', rank: null, dim: false,
    });
    expect(node.extent).toBe('parent');
    expect(node.parentId).toBe('pains');
  });
});

// VP-01 / FIT-08: связь протягивается мышью и СРАЗУ пишется ребром. Ошибка в
// разборе пары не роняет экран — она записывает в корпус не то ребро, то есть
// выглядит как успешная работа. Поэтому и положительные пары, и отказы
// проверяются поимённо.
describe('vpConnection (FIT-08)', () => {
  const ids = {
    pains: ['PAIN-A'],
    gains: ['GAIN-A'],
    jobs: ['JOB-A'],
  };

  it('сценарий → боль = RELIEVES, префикс сектора снимается', () => {
    expect(vpConnection('rel-UC-X', 'PAIN-A', ids))
      .toEqual({ scope: 'uc', rel: 'relieves', source: 'UC-X', target: 'PAIN-A' });
  });

  it('сценарий → выгода = DELIVERS', () => {
    expect(vpConnection('crt-UC-X', 'GAIN-A', ids))
      .toEqual({ scope: 'uc', rel: 'delivers', source: 'UC-X', target: 'GAIN-A' });
  });

  it('сценарий → работа = PERFORMS (узел из «Продукты и услуги»)', () => {
    expect(vpConnection('ps-UC-X', 'JOB-A', ids))
      .toEqual({ scope: 'uc', rel: 'performs', source: 'UC-X', target: 'JOB-A' });
  });

  it('боль → работа = BLOCKS, внутри круга', () => {
    expect(vpConnection('PAIN-A', 'JOB-A', ids))
      .toEqual({ scope: 'vp', rel: 'blocks', source: 'PAIN-A', target: 'JOB-A' });
  });

  it('выгода → работа = SUCCESS_OF', () => {
    expect(vpConnection('GAIN-A', 'JOB-A', ids))
      .toEqual({ scope: 'vp', rel: 'success_of', source: 'GAIN-A', target: 'JOB-A' });
  });

  // ── отказы: без них зелёный тест означал бы «соединяется всё со всем» ──

  it('направление не симметрично: боль → сценарий не связывается', () => {
    expect(vpConnection('PAIN-A', 'ps-UC-X', ids)).toBeNull();
  });

  it('боль → выгода не связывается: такого ребра нет в модели', () => {
    expect(vpConnection('PAIN-A', 'GAIN-A', ids)).toBeNull();
  });

  it('работа → боль не связывается', () => {
    expect(vpConnection('JOB-A', 'PAIN-A', ids)).toBeNull();
  });

  it('карточка-дыра и сектор — не сущности, от них не тянется', () => {
    expect(vpConnection('hole-pr', 'PAIN-A', ids)).toBeNull();
    expect(vpConnection('ps-UC-X', 'empty-pains', ids)).toBeNull();
    expect(vpConnection('pains', 'JOB-A', ids)).toBeNull();
  });

  it('узел сам на себя не связывается', () => {
    expect(vpConnection('PAIN-A', 'PAIN-A', ids)).toBeNull();
    // один и тот же сценарий в двух секторах — те же две карточки одной сущности
    expect(vpConnection('ps-UC-X', 'rel-UC-X', ids)).toBeNull();
  });

  it('ценность чужой канвы не опознаётся: её нет в наборах этой фичи', () => {
    expect(vpConnection('ps-UC-X', 'PAIN-НЕ-НАША', ids)).toBeNull();
  });
});

// FIT-04: сравнение сегментов — СОСТАВ, а не счётчик. «Сегментов два» не
// отвечает, стоит ли делить фичу; отвечает то, какие ценности общие, а какие
// принадлежат одному, и какой сценарий служит разным сегментам сразу.
describe('buildStickerNode: отметка сегмента (FIT-04)', () => {
  const base = {
    id: 'JOB-X', parentId: 'jobs', width: 114, height: 74,
    position: { x: 0, y: 0 }, title: 'Работа', code: 'JOB-X',
    color: 'var(--job)', rank: null, dim: false,
  };
  it('отметка доезжает до data узла — её рисует StickerNode', () => {
    const badge = { text: 'общая', title: 'ещё у: Архитектор', tone: 'var(--inf)' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((buildStickerNode({ ...base, badge }).data as any).badge).toEqual(badge);
  });
  it('без отметки поля нет вовсе — карточка своя', () => {
    expect('badge' in buildStickerNode(base).data).toBe(false);
  });
});

describe('sharedValues (FIT-04)', () => {
  const actorOf = new Map<string, string[]>([
    ['JOB-RECALL', ['ACT-DEV', 'ACT-ARCH', 'ACT-AGENT']],
    ['JOB-SHIP', ['ACT-DEV', 'ACT-AGENT']],
    ['PAIN-ONLY-AGENT', ['ACT-AGENT']],
    ['GAIN-NOBODY', []],
  ]);
  const ids = ['JOB-RECALL', 'JOB-SHIP', 'PAIN-ONLY-AGENT', 'GAIN-NOBODY'];

  it('при выбранном сегменте общая ценность несёт ДРУГИЕ сегменты, а не себя', () => {
    const m = sharedValues(ids, actorOf, 'ACT-DEV');
    expect(m.get('JOB-RECALL')).toEqual(['ACT-ARCH', 'ACT-AGENT']);
    expect(m.get('JOB-SHIP')).toEqual(['ACT-AGENT']);
  });

  it('ценность одного сегмента не помечается — она его собственная', () => {
    const m = sharedValues(ids, actorOf, 'ACT-AGENT');
    expect(m.has('PAIN-ONLY-AGENT')).toBe(false);
    expect(m.has('JOB-SHIP')).toBe(true);
  });

  it('ценность без акторов и чужая для сегмента — не общая', () => {
    const m = sharedValues(ids, actorOf, 'ACT-ARCH');
    expect(m.has('GAIN-NOBODY')).toBe(false);
    expect(m.has('JOB-SHIP')).toBe(false);   // у архитектора её нет вовсе
    expect([...m.keys()]).toEqual(['JOB-RECALL']);
  });

  it('без выбранного сегмента («все вместе») сравнивать не с чем — пусто', () => {
    expect(sharedValues(ids, actorOf, '').size).toBe(0);
  });
});

describe('crossSegmentScenarios (FIT-04)', () => {
  const actorOf = new Map<string, string[]>([
    ['PAIN-DEV', ['ACT-DEV']],
    ['PAIN-PO', ['ACT-PO']],
    ['JOB-SHARED', ['ACT-DEV', 'ACT-PO']],
    ['GAIN-DEV', ['ACT-DEV']],
    ['GAIN-NOBODY', []],
  ]);
  const canvas = ['PAIN-DEV', 'PAIN-PO', 'JOB-SHARED', 'GAIN-DEV', 'GAIN-NOBODY'];

  it('сценарий, закрывающий ценности РАЗНЫХ сегментов без общего, отмечается и называет их', () => {
    const m = crossSegmentScenarios(
      [{ uc_id: 'UC-TWO', relieves_pain_ids: ['PAIN-DEV', 'PAIN-PO'] }], canvas, actorOf);
    expect(m.get('UC-TWO')).toEqual(['ACT-DEV', 'ACT-PO']);
  });

  it('сценарий одного сегмента не отмечается', () => {
    const m = crossSegmentScenarios(
      [{ uc_id: 'UC-DEV', relieves_pain_ids: ['PAIN-DEV'], delivers_gain_ids: ['GAIN-DEV'] }], canvas, actorOf);
    expect(m.size).toBe(0);
  });

  it('общая ценность — не повод делить: есть сегмент, которому служит всё', () => {
    // JOB-SHARED у DEV и PO, PAIN-DEV у DEV — DEV обслужен целиком
    const m = crossSegmentScenarios(
      [{ uc_id: 'UC-OK', relieves_pain_ids: ['PAIN-DEV'], performs_job_ids: ['JOB-SHARED'] }], canvas, actorOf);
    expect(m.size).toBe(0);
  });

  it('одна общая работа — не «два сценария»: закрывает одну ценность', () => {
    const m = crossSegmentScenarios([{ uc_id: 'UC-ONE', performs_job_ids: ['JOB-SHARED'] }], canvas, actorOf);
    expect(m.size).toBe(0);
  });

  it('ценности без акторов и чужие для канвы в сравнении не участвуют', () => {
    const m = crossSegmentScenarios(
      [{ uc_id: 'UC-X', relieves_pain_ids: ['PAIN-DEV', 'PAIN-ЧУЖАЯ'], delivers_gain_ids: ['GAIN-NOBODY'] }],
      canvas, new Map([...actorOf, ['PAIN-ЧУЖАЯ', ['ACT-PO']]]));
    expect(m.size).toBe(0);
  });
});
