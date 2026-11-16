// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Отпечаток итога шага для приёмки на двух машинах.
// Слова владелицы 16.11.2026: «принимаем на этой машине и на razenai должно сойтись с одинаковыми настройками».
// Итог приводится к каноническому виду (ключи по алфавиту, без undefined) и сворачивается в SHA-256;
// первые 16 знаков печатаются рядом с итогом. Одинаковые настройки и источник → одинаковый отпечаток.
import crypto from 'node:crypto';

export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export const fingerprint = v => crypto.createHash('sha256').update(canonical(v)).digest('hex').slice(0, 16);
