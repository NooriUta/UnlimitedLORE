// SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 · Временные ряды модели 1.18 (shared/model/lore-model.json, раздел series).
// Установщик заводит их в новой базе тем же DDL, что строит бэкенд (LoreModelSeries.ddl) — тексты сверяют
// оба теста. Ряд ArcadeDB запечатан: тег после создания не добавить, поэтому состав — часть контракта.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = new Set(['STRING', 'INTEGER', 'LONG', 'DOUBLE', 'BOOLEAN']);

export function seriesDdl(name, s) {
  const cols = obj => Object.entries(obj || {}).map(([k, t]) => {
    if (!IDENT.test(k)) throw new Error(`${name}: столбец «${k}» — не идентификатор`);
    if (!TYPES.has(t)) throw new Error(`${name}.${k}: тип «${t}», бывают ${[...TYPES].sort().join(', ')}`);
    return `${k} ${t}`;
  }).join(', ');
  if (!IDENT.test(name) || !IDENT.test(s.timestamp || '')) throw new Error(`ряд ${name}: имя или момент — не идентификатор`);
  const tags = cols(s.tags), fields = cols(s.fields);
  return `CREATE TIMESERIES TYPE ${name} IF NOT EXISTS TIMESTAMP ${s.timestamp} TAGS (${tags})` + (fields ? ` FIELDS (${fields})` : '');
}

/**
 * Группа ArcadeDB для учётки сторожа (server-groups.json): права только на создание записей ряда
 * AuditDbLogin; права на базу целиком (схема, чтение прочих типов) — пусто. Токен сторожа выдаётся
 * этой группе; root сторож не использует.
 */
export function guardGroup(database, series = 'AuditDbLogin') {
  return {
    databases: {
      [database]: {
        groups: {
          'db-guard': { access: [], resultSetLimit: -1, readTimeout: -1, types: { [series]: { access: ['createRecord'] } } },
        },
      },
    },
  };
}
