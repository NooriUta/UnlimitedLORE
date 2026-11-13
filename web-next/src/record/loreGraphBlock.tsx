// Исполнитель блока lore-graph в тексте записи (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04).
//
// Блок рисуется общим графом kit — GraphExplorer (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03), данные —
// серверный GET /lore/graph (GC-04). Рамку, режимы «код / превью / рядом», состояния и свежесть
// рисует kit (LiveBlock); здесь — только разбор и запрос (граница K-14).
//
// Тело блока — строки «ключ: значение» (параметры после имени языка фенс не передаёт):
//   of: $this | <тип>:<код>     чья окрестность; по умолчанию — эта запись
//   depth: 1..4                 глубина обхода (сервер — до 4)
//   rels: A, B                  обход только по этим типам связей
//   structural: true            слой структурных связей
// Строки «# …» и пустые пропускаются. Любой другой ключ или кривое значение — отказ с кодом,
// а не граф «по умолчанию»: человек увидит, что блок понят не так.
import { GraphExplorer, type KitLang } from '@seidr/kit';
import { LiveBlockError } from '@seidr/kit/content';
import type { LiveBlockRun } from '@seidr/kit/content';
import { loreFetch } from '../auth/session';
import { recordHref } from '../nav/loreRoutes';
import { LORE_GRAPH_TYPES, graphNotes, type LoreGraphBody } from './loreGraph';

export type ParsedLoreGraph =
  | { ok: true; type: string; id: string; depth: number; rels: string[]; structural: boolean }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ParsedLoreGraph => ({ ok: false, code, message });
const KEYS = new Set(['of', 'depth', 'rels', 'structural']);
const REL = /^[A-Z][A-Z0-9_]*$/;

export function parseLoreGraph(source: string, vars: Record<string, string>): ParsedLoreGraph {
  const kv: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-z_]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) return fail('BAD_LINE', `строка «${line}» — ожидается «ключ: значение»`);
    const key = m[1].toLowerCase();
    if (!KEYS.has(key)) return fail('UNKNOWN_KEY', `ключ «${key}» не понят; есть: of, depth, rels, structural`);
    kv[key] = m[2].trim();
  }

  let type = vars['this.type'] ?? '';
  let id = vars['this.id'] ?? '';
  const of = kv.of ?? '$this';
  if (of !== '$this') {
    const i = of.indexOf(':');
    if (i <= 0 || i === of.length - 1) return fail('BAD_OF', `of: «${of}» — нужно $this или <тип>:<код>, например sprint:SPRINT_X`);
    type = of.slice(0, i).trim();
    id = of.slice(i + 1).trim();
  }
  if (!type || !id) return fail('UNRESOLVED_VAR', '$this не определён: блок вне записи — укажите of: <тип>:<код>');

  let depth = 1;
  if (kv.depth !== undefined) {
    depth = /^\d+$/.test(kv.depth) ? Number(kv.depth) : NaN;
    if (!(depth >= 1 && depth <= 4)) return fail('BAD_DEPTH', `depth: «${kv.depth}» — от 1 до 4`);
  }

  const rels = kv.rels ? kv.rels.split(',').map(s => s.trim()).filter(Boolean) : [];
  const bad = rels.find(r => !REL.test(r));
  if (bad) return fail('BAD_RELS', `rels: «${bad}» — тип связи пишется как IMPLEMENTED_IN`);

  const s = (kv.structural ?? 'false').toLowerCase();
  if (s !== 'true' && s !== 'false') return fail('BAD_STRUCTURAL', `structural: «${kv.structural}» — true или false`);

  return { ok: true, type, id, depth, rels, structural: s === 'true' };
}

/** Исполнитель для MartProse `blocks={{'lore-graph': …}}`; vars — переменные записи ($this.id …). */
export function loreGraphRun(vars: Record<string, string>, fetchImpl: typeof fetch = loreFetch as typeof fetch, lang: KitLang = 'ru'): LiveBlockRun {
  return async (source, signal) => {
    const p = parseLoreGraph(source, vars);
    if (!p.ok) throw new LiveBlockError(p.code, p.message);
    const q = new URLSearchParams({ type: p.type, id: p.id, depth: String(p.depth) });
    if (p.structural) q.set('structural', 'true');
    if (p.rels.length) q.set('rels', p.rels.join(','));
    const res = await fetchImpl(`/lore/graph?${q.toString()}`, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) {
      let code = `HTTP ${res.status}`;
      let detail = '';
      try { const b = await res.json() as { error?: string; detail?: string }; code = b.error || code; detail = b.detail ?? ''; } catch { /* тело не JSON */ }
      throw new LiveBlockError(code, detail || `граф не получен: ${res.status}`, res.status);
    }
    const g = await res.json() as LoreGraphBody;
    const date = res.headers.get('Date');
    const at = date ? Date.parse(date) : NaN;
    const typeOf = new Map(g.nodes.map(n => [n.id, n.type]));
    const shown = g.nodes.filter(n => n.id !== p.id).length;
    const notes = graphNotes(g.meta ?? { complete: true, truncated: false }, lang);
    const types = LORE_GRAPH_TYPES(lang);
    return {
      kind: 'view',
      shown,
      empty: shown === 0,
      generatedAt: Number.isNaN(at) ? undefined : new Date(at).toISOString(),
      node: (
        <div className="lore-graph-block">
          <GraphExplorer
            nodes={g.nodes.map(n => ({ id: n.id, type: n.type, title: n.title || n.id, depth: n.depth }))}
            edges={g.edges.map(e => ({ from: e.from, to: e.to, rel: e.rel, kind: e.kind }))}
            types={Object.fromEntries(Object.entries(types).map(([k, v]) => [k, { label: v.label, color: v.color }]))}
            hrefOf={nid => recordHref(typeOf.get(nid) ?? '', nid) ?? ''}
            storageKey="lore-graph-block"
            panelOpen={false}
            lang={lang}
          />
          {notes.length > 0 && <ul className="lore-graph-block-notes">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
        </div>
      ),
    };
  };
}
