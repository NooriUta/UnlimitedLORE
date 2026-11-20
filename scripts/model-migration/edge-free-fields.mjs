// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE · Свободные поля на ребре при переносе в модель 1.18.
// Какие связи несут свободные поля и в каком свойстве — раздел edge_free_fields модели (как edge_history).
// Перенос объявляет у такой связи свойство-словарь (MAP) и отметки (*_at — DATETIME, *_by — STRING), рёбра
// переносит как есть (edgeWrites копирует свойства), моменты отметок приводит к DATETIME и сверяет словари
// приёмника с источником: потерянное или изменённое значение — потеря, а не «перенесено».
import model from '../../shared/model/lore-model.json' with { type: 'json' };
import { toDateTime } from './apply-map.mjs';

const EF = model.edge_free_fields || {};
/** Связи со свободными полями — из модели. */
export const FREE_FIELD_EDGES = Object.keys(EF);
export const carriesFreeFields = edge => FREE_FIELD_EDGES.includes(edge);

/** DDL приёмника: словарь значений и отметки — по модели. */
export function edgeFreeFieldsDdl(edge) {
  const s = EF[edge];
  if (!s) return [];
  return [
    `CREATE PROPERTY ${edge}.${s.property} IF NOT EXISTS MAP`,
    ...s.stamp.map(f => `CREATE PROPERTY ${edge}.${f} IF NOT EXISTS ${f.endsWith('_at') ? 'DATETIME' : 'STRING'}`),
  ];
}

const empty = v => v === undefined || v === null || v === '';

/**
 * Записи рёбер шага связей ([{ content }]): моменты отметок — в DATETIME, пустой словарь не пишется.
 * Ответ — счёт (с полями / голые / значений) или null, если связь полей не несёт.
 */
export function stampFreeFields(T, list) {
  const s = EF[T];
  if (!s) return null;
  const stats = { with_fields: 0, bare: 0, values: 0 };
  for (const w of list) {
    const c = w.content;
    for (const f of s.stamp) if (f.endsWith('_at') && !empty(c[f])) c[f] = toDateTime(c[f]);
    const fields = c[s.property];
    if (fields && typeof fields === 'object' && Object.keys(fields).length) {
      stats.with_fields++; stats.values += Object.keys(fields).length;
    } else { delete c[s.property]; stats.bare++; }
  }
  return stats;
}

const canon = f => (f && typeof f === 'object' && Object.keys(f).length
  ? JSON.stringify(Object.keys(f).sort().map(k => [k, String(f[k])])) : '');

/**
 * Сверка без потерь: expected — записи шага связей ({ content: { mig_src_rid, fields } }), got — строки приёмника
 * ({ s: mig_src_rid, fields }). Ребро, которого нет в приёмнике, или словарь, отличный от источника, — в lost.
 */
export function freeFieldsLoss(expected, got, property = 'fields') {
  const have = new Map(got.map(x => [x.s, canon(x[property] ?? x.fields)]));
  const lost = [];
  for (const w of expected) {
    const src = w.content.mig_src_rid;
    const want = canon(w.content[property]);
    if (!have.has(src)) lost.push({ src, reason: 'нет ребра в приёмнике' });
    else if (have.get(src) !== want) lost.push({ src, reason: 'словарь полей отличается', want, got: have.get(src) });
  }
  return { checked: expected.length, lost };
}
