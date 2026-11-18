// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · структура вне переноса.
// Схема из модели заводила только типы карты и по одному индексу mig_src_rid. Сервер на такой базе падал:
// «Type with name 'MetricSnapshot' was not found» (журналы, планы — у них нет карты) и «Upsert must involve a UNIQUE
// index» (ClRoutineRun — уникального индекса источника нет). Правило: каждый тип источника, кроме связей и журнала
// шагов V, есть в новой базе (без карты — пустым, со структурой источника); каждый индекс источника переносится на
// новые имена полей (по карте), а индекс на поле, которого в новой схеме нет, — в пропуски с причиной.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NOT_CARRIED = new Set(['LoreSchemaVersion']); // журнал шагов V: у базы из модели его нет по построению

const q = f => { if (!NAME.test(f)) throw new Error('имя поля для схемы недопустимо: ' + f); return '`' + f + '`'; };

/** Старое имя поля → новое по карте типа: new ← from[]; новое имя отвечает и само за себя. */
export function renamesOf(type) {
  const out = {};
  for (const [f, e] of Object.entries((type && type.fields) || {})) {
    if (!(f in out)) out[f] = f;
    for (const old of e.from || []) if (!(old in out)) out[old] = f;
  }
  return out;
}

/** План: типы без карты (структура источника) и индексы источника на новых именах. srcTypes — строки schema:types. */
export function structurePlan(srcTypes, schema, notMoved = {}) {
  const types = [], indexes = [], skipped = [], typeDdl = [], indexDdl = [], notCarried = [];
  const sorted = [...srcTypes].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of sorted) {
    if (t.type === 'edge' || NOT_CARRIED.has(t.name) || schema[t.name]) continue;
    // карта решила «не переносить» (план-доска снята и т.п.) — тип не воссоздаётся, причина — в отчёт
    if (notMoved[t.name]) { notCarried.push({ type: t.name, why: notMoved[t.name] }); continue; }
    if (t.type === 't') { // временной ряд ArcadeDB: колонки — момент, теги, поля; строки без @rid
      const cols = t.tsColumns || [];
      types.push({ name: t.name, kind: 'TIMESERIES', ts: t.timestampColumn, props: cols.map(c => ({ name: c.name, type: c.dataType, role: c.role })) });
      continue;
    }
    const props = (t.properties || []).filter(p => NAME.test(p.name)).map(p => ({ name: p.name, type: p.type }));
    types.push({ name: t.name, kind: t.type === 'document' ? 'DOCUMENT' : 'VERTEX', props });
  }
  for (const t of types) {
    if (t.kind === 'TIMESERIES') {
      const of = role => t.props.filter(p => p.role === role).map(p => `${q(p.name)} ${p.type}`).join(', ');
      typeDdl.push(`CREATE TIMESERIES TYPE ${t.name} IF NOT EXISTS TIMESTAMP ${q(t.ts)} TAGS (${of('TAG')}) FIELDS (${of('FIELD')})`);
      continue;
    }
    typeDdl.push(`CREATE ${t.kind} TYPE ${t.name} IF NOT EXISTS`);
    for (const p of t.props) typeDdl.push(`CREATE PROPERTY ${t.name}.${q(p.name)} IF NOT EXISTS ${p.type}`);
    typeDdl.push(`CREATE PROPERTY ${t.name}.mig_src_rid IF NOT EXISTS STRING`);
    indexDdl.push(`CREATE INDEX IF NOT EXISTS ON ${t.name} (mig_src_rid) UNIQUE`);
  }
  for (const t of sorted) {
    if (t.type === 'edge' || NOT_CARRIED.has(t.name) || notMoved[t.name]) continue;
    const mapped = schema[t.name];
    const ren = mapped ? renamesOf(mapped) : null;
    for (const ix of [...(t.indexes || [])].sort((a, b) => a.name.localeCompare(b.name))) {
      const props = ix.properties || [];
      if (!props.length || props.every(p => p === 'mig_src_rid')) continue;
      const lost = mapped ? props.filter(p => !(p in ren)) : [];
      if (lost.length) { skipped.push({ index: ix.name, why: `поля ${lost.join(', ')} нет в новой схеме ${t.name}` }); continue; }
      const fields = props.map(p => (ren ? ren[p] : p));
      const kind = ix.type === 'FULL_TEXT' ? 'FULL_TEXT' : ix.unique ? 'UNIQUE' : 'NOTUNIQUE';
      indexes.push({ type: t.name, fields, kind, from: ix.name });
      indexDdl.push(`CREATE INDEX IF NOT EXISTS ON ${t.name} (${fields.map(q).join(', ')}) ${kind}`);
    }
  }
  // индексы создаются ПОСЛЕ записи данных: дубль в данных источника не должен ронять перенос
  return { types, indexes, skipped, notCarried, typeDdl, indexDdl, ddl: [...typeDdl, ...indexDdl] };
}

/**
 * Тип без карты переносится как есть: строка источника без служебных @-полей и без пустых значений, плюс ключ
 * происхождения mig_src_rid (по нему переносятся связи). Повод — у таких типов в источнике есть данные (журналы,
 * снимки метрик, планы), а схема «пустым со структурой» их теряла.
 */
export function asIsContent(row) {
  const out = { mig_src_rid: row['@rid'] };
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('@') || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** Строка временного ряда для записи: момент (строка UTC «ГГГГ-ММ-ДД ЧЧ:ММ:СС.ммм» или число) → миллисекунды; пустое не пишется. */
export function tsContent(row, tsColumn) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('@') || v === null || v === undefined) continue;
    out[k] = v;
  }
  const t = row[tsColumn];
  out[tsColumn] = typeof t === 'number' ? t : Date.parse(String(t).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(out[tsColumn])) throw new Error('момент временного ряда не разобран: ' + t);
  return out;
}
