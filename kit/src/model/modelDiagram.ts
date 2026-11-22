// Схема модели (ER) из документа model/0 — чистая часть кубика ModelDiagram (SPRINT_UXR_S15_KIT6).
// Кубик не знает ни одного предметного имени (K-14): виды, поля, связи, статусы и группы меню — из документа.
// Разрезы — по слову LORE 22.11.2026: целиком модель на десятки видов нечитаема, поэтому по умолчанию — вид с
// соседями на шаг, затем группа меню (surfaces.nav), полная карта — только по отдельному запросу.

export interface DiagramField { key: string; label: string; kind: string; group: string; priority: number | null }
export interface DiagramStatus { code: string; title: string; category: string; allow: string[] | null }
export interface DiagramKind { id: string; label: string; fields: DiagramField[]; statuses: DiagramStatus[] }
export interface DiagramRel { from: string; to: string; rel: string; label: string; relation: string }
/** Исходящая связь, у которой конец не назван и не находится по паре out/in: рисовать «в никуда» нельзя, терять молча — тоже. */
export interface DanglingRel { from: string; rel: string; label: string }
export interface ModelGraph { kinds: DiagramKind[]; rels: DiagramRel[]; dangling: DanglingRel[] }
export interface ModelSlice { id: string; label: string; kinds: string[] }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Граф модели: виды (поля, статусы со своими переходами) и связи. Цель связи — `target_type`, если документ её
 *  называет; иначе — вид, у которого та же связь (`rel`) объявлена входящей (`dir: in`). */
export function modelGraph(doc: unknown): ModelGraph {
  const d = isObj(doc) ? doc : {};
  const types = isObj(d.types) ? d.types : {};
  const statuses = isObj(d.statuses) ? d.statuses : {};
  const kinds: DiagramKind[] = Object.entries(types).filter(([, t]) => isObj(t)).map(([id, t]) => {
    const tt = t as Obj;
    const st = isObj(statuses[id]) ? (statuses[id] as Obj) : {};
    return {
      id, label: str(tt.label) || id,
      fields: arr(tt.fields).filter(isObj).map((f) => ({
        key: str(f.key), label: str(f.label) || str(f.key), kind: str(f.kind) || 'text', group: str(f.group),
        priority: isObj(f.display) && typeof f.display.priority === 'number' ? f.display.priority : null,
      })).filter((f) => f.key),
      statuses: arr(st.entries).filter(isObj).map((e) => ({
        code: str(e.code), title: str(e.title) || str(e.code), category: str(e.category),
        allow: Array.isArray(e.allow) ? e.allow.filter((a): a is string => typeof a === 'string') : null,
      })).filter((s) => s.code),
    };
  });
  const ids = new Set(kinds.map((k) => k.id));
  const rels: DiagramRel[] = [];
  const dangling: DanglingRel[] = [];
  for (const [from, t] of Object.entries(types)) {
    if (!isObj(t)) continue;
    for (const r of arr(t.relations).filter(isObj)) {
      if (str(r.dir) !== 'out') continue;
      const rel = str(r.rel);
      const named = str(r.target_type);
      const targets = named ? [named] : Object.entries(types)
        .filter(([id, x]) => id !== from && isObj(x) && arr(x.relations).some((y) => isObj(y) && str(y.rel) === rel && str(y.dir) === 'in'))
        .map(([id]) => id);
      const known = targets.filter((to) => ids.has(to));
      if (!known.length) dangling.push({ from, rel, label: str(r.label) || rel });
      for (const to of known) rels.push({ from, to, rel, label: str(r.label) || rel, relation: str(r.relation) });
    }
  }
  return { kinds, rels, dangling };
}

/** Разрезы по группам меню документа (surfaces.nav): подпись — своя или по ключу через `t` приложения. */
export function modelSlices(doc: unknown, t?: (key: string) => string | undefined): ModelSlice[] {
  const d = isObj(doc) ? doc : {};
  const nav = isObj(d.surfaces) ? arr(d.surfaces.nav) : [];
  const types = isObj(d.types) ? d.types : {};
  return nav.filter(isObj).map((g) => ({
    id: str(g.id), label: str(g.label) || (str(g.label_key) && t?.(str(g.label_key))) || str(g.id),
    kinds: arr(g.items).filter(isObj).map((i) => str(i.section)).filter((s) => s in types),
  })).filter((s) => s.id && s.kinds.length > 0);
}

/** Виды разреза: `focus` — вид и его соседи на один шаг; `kinds` — набор; ничего — вся модель. Порядок — как в документе. */
export function sliceKinds(g: ModelGraph, s: { focus?: string | null; kinds?: readonly string[] | null }): string[] {
  let want: Set<string>;
  if (s.focus) {
    want = new Set([s.focus]);
    for (const r of g.rels) { if (r.from === s.focus) want.add(r.to); if (r.to === s.focus) want.add(r.from); }
  } else if (s.kinds) want = new Set(s.kinds);
  else want = new Set(g.kinds.map((k) => k.id));
  return g.kinds.map((k) => k.id).filter((id) => want.has(id));
}

const ER_TYPE: Record<string, string> = { text: 'string', enum: 'enum', number: 'number', boolean: 'bool', date: 'datetime', datetime: 'datetime' };
const ent = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
const attr = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
const q = (s: string) => s.replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
// Кратность: состав и атрибут — у «многих» ровно одна цель; прочие связи — цели может не быть.
const card = (relation: string) => (relation === 'composition' || relation === 'attribute' ? '}o--||' : '}o--o|');

/** Текст Mermaid erDiagram для набора видов: сущности с полями (тип, подпись, группа), связи — только внутри набора. */
export function modelErText(g: ModelGraph, kinds: readonly string[]): string {
  const want = new Set(kinds);
  const lines = ['erDiagram'];
  for (const r of g.rels) if (want.has(r.from) && want.has(r.to)) lines.push(`  ${ent(r.from)} ${card(r.relation)} ${ent(r.to)} : "${q(`${r.rel} · ${r.label}`)}"`);
  for (const k of g.kinds) {
    if (!want.has(k.id)) continue;
    lines.push(`  ${ent(k.id)}["${q(k.label)}"] {`);
    for (const f of k.fields) lines.push(`    ${ER_TYPE[f.kind] ?? 'string'} ${attr(f.key)} "${q(`${f.label}${f.group ? ` · ${f.group}` : ''}`)}"`);
    if (!k.fields.length) lines.push(`    string id "${q(k.label)}"`);
    lines.push('  }');
  }
  return lines.join('\n');
}
