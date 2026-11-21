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
 * План рядов модели для переноса: каждый ряд модели создаётся её DDL; если ряд есть в источнике (тип 't' в
 * schema:types) — его точки копируются. Ряд запечатан: столбец источника, которого нет в модели, приёмник не примет,
 * и точки потерялись бы — поэтому отказ до записи, а не потеря. Столбец модели, которого нет в источнике, — пуст.
 * srcTypes — строки schema:types источника (name, type, timestampColumn, tsColumns).
 */
export function seriesPlan(srcTypes, series) {
  const src = Object.fromEntries((srcTypes || []).filter(t => t.type === 't').map(t => [t.name, t]));
  const bad = [];
  const plan = Object.entries(series || {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => {
    const t = src[name];
    if (t) {
      if (t.timestampColumn && t.timestampColumn !== s.timestamp) bad.push(`${name}: момент источника «${t.timestampColumn}», в модели «${s.timestamp}»`);
      const declared = new Set([s.timestamp, ...Object.keys(s.tags || {}), ...Object.keys(s.fields || {})]);
      const extra = (t.tsColumns || []).map(c => c.name).filter(c => !declared.has(c));
      if (extra.length) bad.push(`${name}: столбцов источника ${extra.join(', ')} нет в модели — ряд запечатан, точки бы потерялись`);
    }
    return { name, ddl: seriesDdl(name, s), ts: s.timestamp, copy: Boolean(t) };
  });
  if (bad.length) throw new Error('ряды модели не сходятся с источником: ' + bad.join('; '));
  return plan;
}

const fmtTs = ms => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
/** Момент ряда (строка UTC «ГГГГ-ММ-ДД ЧЧ:ММ:СС.ммм» или число) → миллисекунды. */
export function tsMillis(v) {
  const ms = typeof v === 'number' ? v : Date.parse(String(v).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) throw new Error('момент временного ряда не разобран: ' + v);
  return ms;
}

/**
 * Перенос точек ряда, детерминированно и по страницам. Строк без @rid, поэтому страница — окно по времени: сутки,
 * а окно, упёршееся в потолок ответа (cap), делится пополам. Окна идут по времени, точки окна — по моменту, затем по
 * содержимому, поэтому порядок записи одинаков от прогона к прогону. Сверка: число точек источника = записанных.
 * bounds() → {a, b} (min/max момента), window(aMs, bMs) → строки [a, b), count() → число точек источника,
 * insert(content) — запись одной точки (момент — миллисекундами, пустые столбцы не пишутся).
 */
export async function copySeries({ bounds, window, count, insert, ts = 'ts', cap = 20000, day = 86400000, concurrency = 8 }) {
  const m = await bounds();
  let n = 0;
  if (m && m.a != null) {
    const canon = r => JSON.stringify(Object.keys(r).sort().map(k => [k, r[k]]));
    const win = async (a, b) => {
      const rows = await window(a, b);
      if (rows.length >= cap && b - a > 1) { const mid = Math.floor((a + b) / 2); await win(a, mid); await win(mid, b); return; }
      const content = rows.map(r => {
        const c = {};
        for (const [k, v] of Object.entries(r)) if (!k.startsWith('@') && v !== null && v !== undefined) c[k] = v;
        c[ts] = tsMillis(r[ts]);
        return c;
      }).sort((x, y) => (x[ts] - y[ts]) || (canon(x) < canon(y) ? -1 : canon(x) > canon(y) ? 1 : 0));
      let i = 0;
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => { while (i < content.length) await insert(content[i++]); }));
      n += content.length;
    };
    const lo = tsMillis(m.a), hi = tsMillis(m.b) + 1;
    for (let a = lo; a < hi; a += day) await win(a, Math.min(a + day, hi));
  }
  const source = Number(await count());
  if (source !== n) throw new Error(`перенос ряда: в источнике ${source} точек, перенесено ${n}`);
  return { source, target: n };
}

/** SQL-обвязка copySeries для источника db.src и приёмника db.dstCommand. */
export function seriesIo(db, name, ts) {
  if (!IDENT.test(name) || !IDENT.test(ts)) throw new Error(`ряд ${name}: имя или момент — не идентификатор`);
  return {
    ts,
    bounds: async () => (await db.src(`SELECT min(${ts}) AS a, max(${ts}) AS b FROM ${name}`))[0],
    window: (a, b) => db.src(`SELECT FROM ${name} WHERE ${ts} >= '${fmtTs(a)}' AND ${ts} < '${fmtTs(b)}'`),
    count: async () => (await db.src(`SELECT count(*) AS n FROM ${name}`))[0].n,
    insert: c => db.dstCommand(`INSERT INTO ${name} CONTENT :c`, { c }),
  };
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
