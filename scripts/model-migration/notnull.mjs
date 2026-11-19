// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-11 · Обязательные поля схемы 1.18 — из модели, а не руками в схеме.
// Поле модели с `notnull: true` объявляется в базе MANDATORY + NOTNULL (ответ владелицы 19.11.2026 «5а»:
// пустой статус версии задачи запрещён на уровне базы). Историчное поле (historic) живёт в версии — ограничение
// ложится на тип версии (graph.<тип>.hist), прочее — на вершину. Ключ поля модели = имя поля схемы.

/** Модель → { Тип базы: [поля NOT NULL] } в порядке модели. */
export function notNullOfModel(model) {
  const out = {};
  for (const t of model.types || []) {
    const g = (model.graph || {})[t.type] || {};
    for (const f of [...(t.fields || []), ...(t.body || [])]) {
      if (f.notnull !== true) continue;
      const T = f.historic ? g.hist : g.vertex;
      if (!T) throw new Error(`модель: ${t.type}.${f.key} — notnull, но у типа нет ${f.historic ? 'версии (graph.hist)' : 'вершины (graph.vertex)'}`);
      (out[T] ||= []).push(f.key);
    }
  }
  return out;
}

/** Пометить поля схемы обязательными по модели. Поле, которого схема не объявляет, — ошибка: ограничение не на что повесить. */
export function markNotNull(types, model) {
  for (const [T, fields] of Object.entries(notNullOfModel(model))) {
    if (!types[T]) continue; // тип другого файла схемы
    for (const f of fields) {
      if (!types[T].fields[f]) throw new Error(`схема: ${T}.${f} обязательно по модели, но схема поля не объявляет`);
      types[T].fields[f].notnull = true;
    }
  }
  return types;
}
