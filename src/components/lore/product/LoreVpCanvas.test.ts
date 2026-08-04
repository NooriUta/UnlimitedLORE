import { describe, it, expect } from 'vitest';
import { buildStickerNode, vpConnection } from './LoreVpCanvas';

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
