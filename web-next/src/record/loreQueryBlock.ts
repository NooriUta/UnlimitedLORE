// Исполнитель блока lore-query в тексте записи (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04).
//
// Ответы владелицы 11.11.2026 («по всем вопросам принимаю твои рекомендации»):
// язык — свой конвейер, тот же, что исполняет MCP run_block (S6-08), плюс
// `question: N` — до встройки Völva честный отказ «пока не исполняется».
//
//   <срез> [| where k = v [and k = v …]] [| limit N] [| offset N] [| fields a,b] [| chart …]
//
// Разбор — копия mcp-server/src/tools/runBlock.ts: общего пакета между MCP и
// web-next нет. Расхождение ловит сторож паритета в loreQueryBlock.test.ts —
// человек и агент обязаны понимать блок одинаково.
// Всё, что исказило бы ответ (group by, in (…), сравнения кроме «=»), — отказ
// с кодом, а не пустая таблица.
import { LiveBlockError } from '@seidr/kit/content';
import type { LiveBlockRun, LiveTableColumn } from '@seidr/kit/content';
import { LoreApiError, fetchSlice } from '../api/loreClient';

export type ParsedLoreQuery =
  | { ok: true; slice: string; params: Record<string, string>; warnings: string[] }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ParsedLoreQuery => ({ ok: false, code, message });

const unquote = (v: string) => {
  const t = v.trim();
  return (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) ? t.slice(1, -1) : t;
};

function body(text: string): { ok: true; body: string } | { ok: false; code: string; message: string } {
  const t = text.trim();
  if (!t.startsWith('```')) return { ok: true, body: t };
  const lines = t.split(/\r?\n/);
  const info = lines[0].slice(3).trim();
  const kind = info.split(/\s+/)[0] ?? '';
  if (kind !== 'lore-query') {
    return { ok: false, code: 'NOT_LORE_QUERY', message: `блок «${kind || '(без типа)'}» — не lore-query; run_block выполняет только lore-query` };
  }
  const end = lines.length > 1 && lines[lines.length - 1].trim() === '```' ? lines.length - 1 : lines.length;
  return { ok: true, body: lines.slice(1, end).join('\n').trim() };
}

export function parseLoreQuery(text: string, vars: Record<string, string> = {}): ParsedLoreQuery {
  const b = body(text ?? '');
  if (!b.ok) return fail(b.code, b.message);
  if (!b.body) return fail('EMPTY_BLOCK', 'блок пуст — нечего выполнять');
  if (/^question\s*:/i.test(b.body)) {
    return fail('UNSUPPORTED_FORM', 'ссылка question: N — сохранённый вопрос Völva; через срезы LORE его не выполнить, откройте вопрос в Völva');
  }
  let unresolved: string | undefined;
  const src = b.body.replace(/\$([A-Za-z_][\w.]*)/g, (m, name: string) => {
    if (vars[name] !== undefined) return vars[name];
    unresolved ??= m;
    return m;
  });
  if (unresolved) {
    return fail('UNRESOLVED_VAR', `переменная ${unresolved} не задана — передайте её в vars (например {"this.project":"owner/repo"})`);
  }
  const stages = src.split('|').map(s => s.replace(/\s+/g, ' ').trim());
  const slice = stages.shift() ?? '';
  if (!/^[A-Za-z0-9_]+$/.test(slice)) return fail('BAD_SLICE', `первая стадия должна быть id среза, а не «${slice}»`);
  const params: Record<string, string> = {};
  const warnings: string[] = [];
  for (const st of stages) {
    if (!st) return fail('BAD_STAGE', 'пустая стадия конвейера («||» или «|» в конце)');
    const [head, ...rest] = st.split(' ');
    const arg = rest.join(' ').trim();
    switch (head.toLowerCase()) {
      case 'where': {
        for (const cond of arg.split(/\s+and\s+/i)) {
          const m = /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(cond.trim());
          if (!m || /^\(/.test(m[2].trim()) || /\s(in|or)\s/i.test(` ${cond} `)) {
            return fail('UNSUPPORTED_CONDITION', `условие «${cond.trim()}» не исполнить срезом: поддерживается только «поле = значение» через and`);
          }
          params[m[1]] = unquote(m[2]);
        }
        break;
      }
      case 'limit':
      case 'offset':
        if (!/^\d+$/.test(arg)) return fail('BAD_STAGE', `${head} ждёт целое число, а не «${arg}»`);
        params[head.toLowerCase()] = arg;
        break;
      case 'fields':
        if (!arg) return fail('BAD_STAGE', 'fields ждёт список колонок через запятую');
        params.fields = arg.replace(/\s+/g, '');
        break;
      case 'chart':
        warnings.push(`стадия «${st}» — только вид результата; агенту возвращаются строки таблицей`);
        break;
      default:
        return fail('UNSUPPORTED_STAGE', `стадия «${st}» не исполнить срезом без искажения ответа; поддерживаются where / limit / offset / fields / chart`);
    }
  }
  return { ok: true, slice, params, warnings };
}

/** Сколько колонок показать, если fields не задан: таблица в тексте, а не дамп записи. */
const AUTO_COLUMNS = 6;

const cell = (v: unknown): string | number | null =>
  v == null ? null : typeof v === 'number' ? v : typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v);

/**
 * Исполнитель для MartProse `blocks={{'lore-query': …}}`. vars — переменные
 * записи ($this.id …). Время ответа — заголовок Date сервера (served_at).
 */
export function loreQueryRun(vars: Record<string, string>, fetchImpl?: typeof fetch): LiveBlockRun {
  return async (source, signal) => {
    const p = parseLoreQuery(source, vars);
    if (!p.ok) throw new LiveBlockError(p.code, p.message);
    let b;
    try {
      b = await fetchSlice(p.slice, p.params, { signal, fetchImpl });
    } catch (e) {
      if (e instanceof LoreApiError) throw new LiveBlockError(e.code || `HTTP ${e.status}`, e.detail || e.message, e.status);
      throw e;
    }
    const keys = p.params.fields ? p.params.fields.split(',').filter(Boolean)
      : Object.keys(b.rows[0] ?? {}).slice(0, AUTO_COLUMNS);
    const columns: LiveTableColumn[] = keys.map(k => ({ key: k, title: k }));
    const rows = b.rows.map(r => Object.fromEntries(keys.map(k => [k, cell((r as Record<string, unknown>)[k])])));
    const total = b.page?.total ?? (b.truncated ? undefined : rows.length);
    return { kind: 'table', columns, rows, total, generatedAt: b.served_at, scope: b.scope?.note };
  };
}
