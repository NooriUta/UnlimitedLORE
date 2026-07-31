import { describe, it, expect } from 'vitest';
import { buildStickerNode } from './LoreVpCanvas';

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
