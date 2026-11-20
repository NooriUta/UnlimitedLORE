// Подписи связи в обе стороны — из документа модели (SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS).
//
// Обратная подпись — `inverse_label` у связи (решение владелицы 20.11.2026, вариант «а»): так связь
// называется с ДРУГОГО конца. Запасной путь — подпись той же связи у типа на другом конце
// (`relations[]` с обратным `dir`). Пара собирается на ЛЮБОМ месте показа (вкладка, свойство,
// часть): configFromModel берёт во вкладки только `link_tab`, а подпись нужна и остальным.
//
// Нет одной из сторон — строкой в `notes`: тогда вкладка «Связи» покажет вторую подпись
// словами «входящая: …», а не молча то же слово (методика §7.3.2: «требует» и «нужна для» — разные слова).
//
// Одна связь у разных типов может быть подписана по-разному («Задачи» у спринта, «Фазы» у
// вехи); здесь — первая встреченная по порядку типов в документе. Подпись своего вида записи
// главнее и берётся из kinds (RecordLinks.linkGroupLabel).
import type { LoreModelDoc } from './loadModel';

export interface EdgeLabelPair { out?: string; in?: string }

export interface EdgeLabelsFromModel {
  labels: Record<string, EdgeLabelPair>;
  notes: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function edgeLabelsFromModel(model: Pick<LoreModelDoc, 'types'>): EdgeLabelsFromModel {
  const labels: Record<string, EdgeLabelPair> = {};
  const inverse: Record<string, EdgeLabelPair> = {};
  for (const t of Object.values(isObj(model.types) ? model.types : {})) {
    if (!isObj(t) || !Array.isArray(t.relations)) continue;
    for (const r of t.relations) {
      if (!isObj(r)) continue;
      const rel = str(r.rel);
      if (!rel) continue;
      const side = str(r.dir) === 'in' ? 'in' : 'out';
      const other = side === 'in' ? 'out' : 'in';
      const label = str(r.label);
      // Ключ ответа сервера — inverse_label; inverseLabel — тот же ключ в файле модели.
      const inv = str(r.inverse_label) || str(r.inverseLabel);
      if (label) { const pair = (labels[rel] ??= {}); if (!pair[side]) pair[side] = label; }
      if (inv) { const pair = (inverse[rel] ??= {}); if (!pair[other]) pair[other] = inv; }
    }
  }
  // Своя подпись стороны главнее обратной подписи другого конца: её написали именно для этой стороны.
  for (const [rel, p] of Object.entries(inverse)) {
    const pair = (labels[rel] ??= {});
    if (!pair.out && p.out) pair.out = p.out;
    if (!pair.in && p.in) pair.in = p.in;
  }
  const notes: string[] = [];
  for (const [rel, p] of Object.entries(labels)) {
    if (!p.in) notes.push(`у связи «${rel}» нет обратной подписи — во входящих показана словами «входящая: …»`);
    else if (!p.out) notes.push(`у связи «${rel}» нет прямой подписи — в исходящих показана словами «исходящая: …»`);
  }
  return { labels, notes };
}
