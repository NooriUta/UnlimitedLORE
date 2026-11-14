// SPRINT_LORE_AGENT_OBSERVABILITY/AO-02 — след источников «к сущности».
//
// MCP-сервер копит, какие записи агент читал (детальные срезы: adr, decision, spec_by_id,
// tasks_by_uids…), и после успешного создания записи (*_new, entity_upsert) шлёт этот список
// в POST /lore/sources. Бэкенд пишет рёбра SOURCED_FROM — за флагом, по умолчанию ВЫКЛ, и сам
// режет шум (последние различные, не больше порога).
//
// След — вспомогательный: его отправка не ждётся и не может уронить создание; сбой — строка
// в stderr. Копилка — в памяти процесса: перезапуск MCP её обнуляет (вариант «к сущности»
// этого не боится — след уже лежит рёбрами у созданных записей).

export type TrailRef = { type: string; id: string; via: string };

/** Детальный срез → вид записи и параметры, в которых лежит её ключ (через запятую — несколько). */
export const DETAIL_SLICES: Record<string, { type: string; keys: string[] }> = {
  adr: { type: 'adr', keys: ['id'] },
  decision: { type: 'decision', keys: ['id'] },
  spec_by_id: { type: 'spec', keys: ['id'] },
  tasks_by_uids: { type: 'task', keys: ['task_uids'] },
  question_by_id: { type: 'question', keys: ['id'] },
  doc_by_id: { type: 'doc', keys: ['id'] },
  runbook_by_id: { type: 'runbook', keys: ['id'] },
};

/** Ключ в ответе создания → вид записи (порядок — приоритет, первый найденный). */
export const CREATED_KEYS: [string, string][] = [
  ['adr_id', 'adr'], ['decision_id', 'decision'], ['spec_id', 'spec'], ['task_uid', 'task'],
  ['question_id', 'question'], ['doc_id', 'doc'], ['runbook_id', 'runbook'], ['uc_id', 'feature'],
  ['milestone_id', 'milestone'], ['release_uid', 'release'], ['component_id', 'component'], ['sprint_id', 'sprint'],
];

/** Сколько прочитанного держать (бэкенд всё равно возьмёт последние N различных). */
export const KEEP = 100;

/** Что прочитано этим вызовом инструмента. */
export function readsOf(tool: string, args: unknown): TrailRef[] {
  if (tool !== 'query_slice' || !args || typeof args !== 'object') return [];
  const a = args as { slice?: unknown; params?: unknown };
  const def = typeof a.slice === 'string' ? DETAIL_SLICES[a.slice] : undefined;
  if (!def || !a.params || typeof a.params !== 'object') return [];
  const p = a.params as Record<string, unknown>;
  const out: TrailRef[] = [];
  for (const k of def.keys) {
    const v = p[k];
    if (typeof v !== 'string') continue;
    for (const id of v.split(',').map(s => s.trim()).filter(Boolean)) out.push({ type: def.type, id, via: a.slice as string });
  }
  return out;
}

/** Создаёт ли инструмент запись (только тогда пишется след). */
export function isCreate(tool: string): boolean {
  return tool.endsWith('_new') || tool === 'entity_upsert';
}

/** Созданная запись — по ключу в ответе инструмента; null — не распознана (след не шлётся). */
export function createdOf(result: unknown): { type: string; id: string } | null {
  const r = result as { isError?: boolean; content?: { type?: string; text?: string }[] } | undefined;
  if (!r || r.isError || !Array.isArray(r.content)) return null;
  const text = r.content.find(c => c?.type === 'text')?.text;
  if (!text) return null;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.ok === false) return null;
  for (const [key, type] of CREATED_KEYS) {
    const v = b[key];
    if (typeof v === 'string' && v.trim()) return { type, id: v.trim() };
  }
  return null;
}

export type TrailPost = (path: string, body: unknown) => Promise<unknown>;

/** Копилка прочитанного одного процесса MCP. */
export class SourceTrail {
  private reads: TrailRef[] = [];

  constructor(private readonly post: TrailPost, private readonly log: (m: string) => void = console.error) {}

  /** Наблюдать вызов инструмента: прочитанное — в копилку, создание — отправить след. */
  observe(tool: string, args: unknown, result: unknown): Promise<void> | undefined {
    const r = readsOf(tool, args);
    if (r.length) {
      this.reads.push(...r);
      if (this.reads.length > KEEP) this.reads = this.reads.slice(-KEEP);
      return undefined;
    }
    if (!isCreate(tool) || this.reads.length === 0) return undefined;
    const target = createdOf(result);
    if (!target) return undefined;
    const sources = [...this.reads];
    return this.post('/lore/sources', { target, sources })
      .then(() => undefined)
      .catch(e => this.log(`[aida-lore-mcp] след источников ${target.type} ${target.id} не записан: ${(e as Error).message}`));
  }

  /** Для тестов: что накоплено. */
  snapshot(): TrailRef[] { return [...this.reads]; }
}
