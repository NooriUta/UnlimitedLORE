// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 · Историчные связи при переносе.
// Какие связи ведут историю в самом ребре и какими полями — раздел edge_history модели (одно описание на
// все связи, а не список здесь). Перенос даёт такому ребру «действует с» (valid_from) и «действует по»
// (valid_to) и объявляет оба свойства в схеме приёмника; у текущих связей valid_to пусто.
//
// Откуда valid_from, по убыванию точности (первое найденное):
//   edge.valid_from    — у ребра уже есть (ROLE_HELD_BY, закрытые сохраняют и valid_to);
//   edge.created_at    — ребро помнит момент создания;
//   out.first_version  — первая версия записи, от которой идёт связь (раньше неё связи быть не могло);
//   out.created_at     — момент создания этой записи;
//   transfer           — ничего не известно: момент переноса (так же поступил шаг V старой базы для ролей).
// Источник считается в отчёте переноса по каждой связи — подставленное видно, а не выдаётся за известное.
import model from '../../shared/model/lore-model.json' with { type: 'json' };
import { toDateTime } from './apply-map.mjs';

const EH = model.edge_history || { fields: [], edges: {} };
/** Поля версии у историчного ребра — из модели. */
export const EDGE_HISTORY_FIELDS = EH.fields;
/** Историчные связи — из модели. */
export const HISTORIC_EDGES = Object.keys(EH.edges);
export const isHistoric = edge => HISTORIC_EDGES.includes(edge);

/** Колонки, которые нужно прочитать у ребра источника, чтобы вывести его версию. */
export const SOURCE_COLUMNS = ['valid_from', 'valid_to', 'created_at', '@out.created_at AS out_created', "@out.out('HAS_STATE').valid_from AS out_versions"];

const moment = v => (v === undefined || v === null || v === '' ? null : toDateTime(v));

/** Версия ребра: valid_from, valid_to и откуда взят valid_from. at — момент переноса (ISO). */
export function edgeVersion(row, at) {
  const to = moment(row.valid_to);
  const own = moment(row.valid_from);
  if (own) return { valid_from: own, valid_to: to, source: 'edge.valid_from' };
  const created = moment(row.created_at);
  if (created) return { valid_from: created, valid_to: to, source: 'edge.created_at' };
  const versions = (Array.isArray(row.out_versions) ? row.out_versions : [row.out_versions]).map(moment).filter(Boolean).sort();
  if (versions.length) return { valid_from: versions[0], valid_to: to, source: 'out.first_version' };
  const outCreated = moment(row.out_created);
  if (outCreated) return { valid_from: outCreated, valid_to: to, source: 'out.created_at' };
  return { valid_from: at, valid_to: to, source: 'transfer' };
}

/** Объявление полей версии у типа ребра в приёмнике — по модели, одно на все историчные связи. */
export function edgeHistoryDdl(edge) {
  if (!isHistoric(edge)) return [];
  return EDGE_HISTORY_FIELDS.map(f => `CREATE PROPERTY ${edge}.${f} DATETIME`);
}
