// SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S5-10 — приёмка preprod 14.11 (v1.17.21): легенда графа показывала
// коды рёбер (DOCUMENTED_IN, PARENT_OF), а не слова. Причина: словарь LORE_EDGE_TYPES составлен
// руками и не содержал типов, которые сервер реально отдаёт (граф /lore/graph отдаёт ЛЮБОЕ ребро
// между записями паспорта). Правило: подпись на обоих языках у каждого типа ребра из реестров
// сервера — модели (shared/model/lore-model.json: rel связей и полей) и схемы (CREATE EDGE TYPE
// в LoreSchemaInitializer/LoreSchemaMigrations). Новый тип без подписи валит этот тест.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LORE_EDGE_TYPES, loreEdgeLabel, loreEdgesConfig } from './loreEdges';

const ROOT = resolve(__dirname, '..', '..', '..');

function modelRels(): Set<string> {
  const model = JSON.parse(readFileSync(resolve(ROOT, 'shared', 'model', 'lore-model.json'), 'utf8')) as unknown;
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'rel' && typeof v === 'string') out.add(v);
      walk(v);
    }
  };
  walk(model);
  return out;
}

function schemaEdges(): Set<string> {
  const dir = resolve(ROOT, 'backend', 'src', 'main', 'java', 'studio', 'seer', 'heimdall', 'lore');
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter(n => n.endsWith('.java'))) {
    for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/CREATE EDGE TYPE +([A-Za-z_]+)/g)) out.add(m[1]);
  }
  return out;
}

// Не подписываем сознательно: E — базовый тип ArcadeDB; ClRoutine* — служебные рёбра прогонов
// гейтов качества (ClRoutineRun → метрика/выход), их концы не записи паспорта, в граф не попадают.
const NOT_GRAPH = (t: string) => t === 'E' || t.startsWith('ClRoutine');

describe('S5-10 · подписи рёбер графа на обоих языках', () => {
  const rels = modelRels();
  const schema = schemaEdges();

  it('реестры прочитаны (положительный контроль: пустой реестр — не «всё подписано»)', () => {
    expect(rels.has('DOCUMENTED_IN')).toBe(true);
    expect(rels.has('PARENT_OF')).toBe(true);
    expect(schema.size).toBeGreaterThan(40);
  });

  it('у каждого типа ребра сервера есть подпись ru и en', () => {
    const missing = [...new Set([...rels, ...schema])].filter(t => !NOT_GRAPH(t)).filter(t => {
      const e = LORE_EDGE_TYPES[t];
      return !e || !e.ru.trim() || !e.en.trim();
    }).sort();
    expect(missing).toEqual([]);
  });

  // SPRINT_LORE_KNOW_REGISTRY/KREG-10 (владелец 25.11.2026, «а»): подписи — на трёх языках, ru/en/pl.
  it('у каждого ребра словаря есть ru, en и pl', () => {
    const missing = Object.entries(LORE_EDGE_TYPES)
      .filter(([, e]) => !e.ru?.trim() || !e.en?.trim() || !e.pl?.trim())
      .map(([t]) => t);
    expect(missing).toEqual([]);
  });

  it('loreEdgeLabel: pl отдаёт польскую подпись, без неё — английскую', () => {
    expect(loreEdgeLabel('pl', 'DEPENDS_ON')).toBe(LORE_EDGE_TYPES.DEPENDS_ON.pl);
    expect(loreEdgeLabel('pl', 'DEPENDS_ON')).toBe('zależy od');
    const saved = LORE_EDGE_TYPES.BLOCKS;
    LORE_EDGE_TYPES.BLOCKS = { ...saved, pl: undefined };
    try {
      expect(loreEdgeLabel('pl', 'BLOCKS')).toBe(saved.en);
    } finally {
      LORE_EDGE_TYPES.BLOCKS = saved;
    }
    expect(loreEdgeLabel('pl', 'NO_SUCH_EDGE')).toBe('NO_SUCH_EDGE');
  });

  it('подпись — слова, а не код; ru кириллицей', () => {
    for (const [t, e] of Object.entries(LORE_EDGE_TYPES)) {
      expect(e.ru, t).not.toBe(t);
      expect(e.en, t).not.toBe(t);
      expect(e.ru, t).toMatch(/[а-яё]/i);
      expect(e.color, t).toMatch(/^--(acc|suc|wrn|dng|inf|t1|t2|t3)$/);
    }
  });

  it('легенда: DOCUMENTED_IN и PARENT_OF — словами на выбранном языке', () => {
    expect(loreEdgesConfig('ru').DOCUMENTED_IN?.label).toBe(loreEdgeLabel('ru', 'DOCUMENTED_IN'));
    expect(loreEdgeLabel('ru', 'DOCUMENTED_IN')).not.toBe('DOCUMENTED_IN');
    expect(loreEdgeLabel('en', 'PARENT_OF')).not.toBe('PARENT_OF');
    expect(loreEdgeLabel('ru', 'PARENT_OF')).toMatch(/[а-яё]/i);
  });

  it('структурный слой совпадает с серверным STRUCTURAL_RELS', () => {
    const src = readFileSync(resolve(ROOT, 'backend', 'src', 'main', 'java', 'studio', 'seer', 'heimdall', 'lore', 'LoreGraphBuilder.java'), 'utf8');
    const block = /STRUCTURAL_RELS = Set\.of\(([^)]*)\)/.exec(src)?.[1] ?? '';
    const server = [...block.matchAll(/"([A-Z_]+)"/g)].map(m => m[1]).sort();
    expect(server.length).toBeGreaterThan(3);
    const ours = Object.entries(LORE_EDGE_TYPES).filter(([, e]) => e.layer === 'structural').map(([t]) => t).sort();
    expect(ours).toEqual(server);
  });
});
