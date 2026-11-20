// Метрики гейта в паспорте v2 (спека LORE_SCHEMA_V12_NEW_TYPES; владелица 19–20.11.2026: «доделать функции,
// чтобы все поля работали»). Сервер присылает часть `metrics` (тип qg_metric) со всеми полями: порог, единица,
// направление, последнее измерение, итог. Паспорт показывает все поля, а там, где значения нет, — пишет об этом
// словами: «нет измерения», а не пустую ячейку или ноль.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordFromServer } from '../api/liveRecord';
import { fromLoreRecord, qgMetricPartForView, QG_METRIC_COLUMNS, type LorePart, type LoreRecord1 } from './loreRecordContract';

const METRICS: LorePart = {
  key: 'metrics', label: 'Метрики', type: 'qg_metric', rel: 'MEASURED_BY', dir: 'out', state: 'ok', count: 2,
  items: [
    { id: 'QG-1:P-1:0', title: 'Доля успешных', status: 'fail',
      values: { status: 'fail', code: 'P-1', title: 'Доля успешных', threshold: '≥ 98%', unit: '%', direction: 'gte', current_value: 97.5 } },
    { id: 'QG-1:P-2:1', title: 'Время ответа', status: 'unknown',
      values: { status: 'unknown', code: 'P-2', title: 'Время ответа', threshold: 'все зелёные', unit: null, direction: null, current_value: null } },
  ],
};

/**
 * Паспорт гейта — на СНЯТОМ ответе сервера (shared/fixtures/record-adr.json, сторож CT-KIT-FIXTURES): тип и
 * часть метрик подменены тем, что отдаёт фасад для quality_gate (LoreRecordFrom.ITEMS qg_metric).
 */
function gate(): LoreRecord1 {
  const body = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'record-adr.json'), 'utf8')) as { record: object; schema: { type?: string; relations?: unknown[] }; parts?: unknown };
  body.record = { ...body.record, type: 'quality_gate', id: 'QG-1', title: 'Гейт' };
  body.schema = { ...body.schema, type: 'quality_gate', relations: [...(body.schema.relations ?? []),
    { key: 'metrics', label: 'Метрики', relation: 'composition', rel: 'MEASURED_BY', dir: 'out', target_type: 'qg_metric', place: 'part', manageable: false }] };
  body.parts = [{ key: 'metrics', label: 'Метрики', type: 'qg_metric', rel: 'MEASURED_BY', dir: 'out', owned: 'strict', relation: 'composition',
    columns: ['status', 'code', 'title', 'threshold', 'unit', 'direction', 'current_value'], state: 'ok', count: 2,
    items: METRICS.items.map(i => ({ id: i.id, title: i.title, status: i.status, values: i.values })) }];
  return recordFromServer(body, '2026-11-20T00:00:00Z');
}

describe('метрики гейта — все поля спеки, пустое словами', () => {
  it('измеренная метрика: значения как есть, направление и итог словами', () => {
    const v = qgMetricPartForView(METRICS, 'ru').items[0].values!;
    expect(v.current_value).toBe(97.5);
    expect(v.unit).toBe('%');
    expect(v.threshold).toBe('≥ 98%');
    expect(v.direction).toBe('не меньше порога');
    expect(v.result).toBe('не выполнен');
  });

  it('нет измерения, единицы и направления — пишется словами, не пусто и не ноль', () => {
    const v = qgMetricPartForView(METRICS, 'ru').items[1].values!;
    expect(v.current_value).toBe('нет измерения');
    expect(v.unit).toBe('не задана');
    expect(v.direction).toBe('не задано');
    expect(v.result).toBe('не измерено');
  });

  it('английская локаль — свои слова', () => {
    const v = qgMetricPartForView(METRICS, 'en').items[1].values!;
    expect(v.current_value).toBe('no measurement');
    expect(v.result).toBe('not measured');
  });

  it('паспорт гейта: вкладка «Метрики» и записи метрик несут все поля', () => {
    const { data, config } = fromLoreRecord(gate(), 'ru');
    expect(config.kinds.quality_gate.tabs?.some(t => t.key === 'metrics')).toBe(true);
    const m = data.records.find(r => r.id === 'QG-1:P-2:1');
    expect(m?.fields).toMatchObject({ code: 'P-2', threshold: 'все зелёные', current_value: 'нет измерения', result: 'не измерено' });
  });

  it('колонки таблицы метрик — все поля спеки', () => {
    expect(QG_METRIC_COLUMNS).toEqual(['fields.code', 'fields.current_value', 'fields.result', 'fields.threshold', 'fields.unit', 'fields.direction']);
  });

  it('прочие части не трогаются', () => {
    const tasks: LorePart = { key: 'tasks', label: 'Задачи', type: 'task', rel: 'PART_OF', dir: 'in', state: 'ok', count: 0, items: [] };
    expect(qgMetricPartForView(tasks, 'ru')).toBe(tasks);
  });
});
