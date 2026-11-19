// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Вид значения поля — для типа необъявленного поля в предложении схемы.
export function valueKind(v) {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (Array.isArray(v)) return 'list';
  if (v && typeof v === 'object') return 'map';
  return 'string';
}
