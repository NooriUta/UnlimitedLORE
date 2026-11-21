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
//   ends.last_update   — последнее обновление объектов на обоих концах (последняя версия, updated_at, created_at;
//                        владелица 19.11.2026: «дата новых связей последняя дата обновления объектов» — «да»);
//   transfer           — ничего не известно: момент снимка источника.
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

const list = v => (Array.isArray(v) ? v : [v]);
/** Самый поздний момент среди значений (строки, списки строк); ничего нет — null. */
export function lastUpdate(...values) {
  const all = values.flatMap(list).map(moment).filter(Boolean).sort();
  return all.length ? all[all.length - 1] : null;
}

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
  const ends = lastUpdate(row.out_versions, row.out_updated, row.in_versions, row.in_updated, row.in_created);
  if (ends) return { valid_from: ends, valid_to: to, source: 'ends.last_update' };
  return { valid_from: at, valid_to: to, source: 'transfer' };
}

/**
 * «Момент переноса» для связей без своего момента — момент снимка источника: самая поздняя версия (valid_from)
 * среди типов версий источника. Не часы машины: те же данные дают тот же момент и тот же отпечаток переноса
 * (детерминизм, репетиция 1.18-rc 19.11.2026). Тип, которого нет в источнике, пропускается; нет ни одного
 * момента — ошибка, а не подстановка.
 */
export async function sourceMoment(db, histTypes) {
  let best = null;
  for (const T of histTypes) {
    let rows;
    try { rows = await db.src(`SELECT max(valid_from) AS m FROM ${T}`); } catch { continue; }
    const m = rows && rows[0] ? moment(rows[0].m) : null;
    if (m && (!best || m > best)) best = m;
  }
  if (!best) throw new Error('момент снимка источника не найден: ни у одного типа версий нет valid_from');
  return best;
}

/** Запрос моментов записи-начала у ребра источника (для valid_from), страница после last. */
export const outMomentsQuery = (edge, last) => `SELECT @rid AS r, @out.created_at AS out_created, @out.updated_at AS out_updated, @out.out('HAS_STATE').valid_from AS out_versions, @in.created_at AS in_created, @in.updated_at AS in_updated, @in.out('HAS_STATE').valid_from AS in_versions FROM ${edge} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`;

/**
 * Поля версии в записях рёбер шага связей (list = [{ content: { mig_src_rid, …свойства ребра } }]):
 * у историчной связи ставятся valid_from / valid_to, ответ — откуда взят valid_from (счёт по источникам).
 * Неисторичная связь не трогается — ответ null. outMoments: адрес ребра источника → { out_created, out_versions }.
 */
export function stampEdgeHistory(T, list, outMoments, at) {
  if (!isHistoric(T)) return null;
  const sources = {};
  for (const w of list) {
    const m = outMoments.get(w.content.mig_src_rid) || {};
    const v = edgeVersion({ ...w.content, out_created: m.out_created, out_updated: m.out_updated, out_versions: m.out_versions, in_created: m.in_created, in_updated: m.in_updated, in_versions: m.in_versions }, at);
    w.content.valid_from = v.valid_from;
    if (v.valid_to) w.content.valid_to = v.valid_to; else delete w.content.valid_to;
    sources[v.source] = (sources[v.source] || 0) + 1;
  }
  return sources;
}

/** Объявление полей версии у типа ребра в приёмнике — по модели, одно на все историчные связи. */
export function edgeHistoryDdl(edge) {
  if (!isHistoric(edge)) return [];
  return EDGE_HISTORY_FIELDS.map(f => `CREATE PROPERTY ${edge}.${f} DATETIME`);
}
