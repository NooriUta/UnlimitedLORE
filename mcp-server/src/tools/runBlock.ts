// SPRINT_UXR_S6_VOLVA_IN_LORE/S6-08 — «выполнить блок» lore-query для агентов.
//
// Исходник блока лежит в Markdown записи (SPEC-LORE-UXR-EMBED-BLOCKS). Язык
// короткой формы — открытый вопрос спеки (свой конвейер / SQL / MBQL Völva),
// поэтому здесь исполняется только то, что однозначно ложится на срез LORE:
//
//   <slice> [| where k = v [and k = v …]] [| limit N] [| offset N] [| fields a,b] [| chart …]
//
// Всё, что исказило бы ответ (group by, in (…), сравнения кроме «=», ссылка
// question: N на сохранённый вопрос Völva), отказывается ЯВНО — с кодом и
// причиной. Отказ — не пустая выдача: у него нет rows.

import type { SliceExtra, SliceMeta, SlicePage } from '../backend.js';

export type ParsedBlock =
  | { ok: true; slice: string; params: Record<string, string>; warnings: string[] }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ParsedBlock => ({ ok: false, code, message });

const unquote = (v: string) => {
  const t = v.trim();
  return (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) ? t.slice(1, -1) : t;
};

/** Снимает ограду ```lore-query … ```, если она есть; чужой тип блока — отказ. */
function body(text: string): { ok: true; body: string } | { ok: false; code: string; message: string } {
  const t = text.trim();
  if (!t.startsWith('```')) return { ok: true, body: t };
  const lines = t.split(/\r?\n/);
  const info = lines[0].slice(3).trim();
  const kind = info.split(/\s+/)[0] ?? '';
  if (kind !== 'lore-query') {
    return { ok: false, code: 'NOT_LORE_QUERY', message: `блок «${kind || '(без типа)'}» — не lore-query; run_block выполняет только lore-query` };
  }
  const end = lines.length > 1 && lines.at(-1)!.trim() === '```' ? lines.length - 1 : lines.length;
  return { ok: true, body: lines.slice(1, end).join('\n').trim() };
}

export function parseLoreQueryBlock(text: string, vars: Record<string, string> = {}): ParsedBlock {
  const b = body(text ?? '');
  if (!b.ok) return fail(b.code, b.message);
  if (!b.body) return fail('EMPTY_BLOCK', 'блок пуст — нечего выполнять');
  if (/^question\s*:/i.test(b.body)) {
    return fail('UNSUPPORTED_FORM', 'ссылка question: N — сохранённый вопрос Völva; через срезы LORE его не выполнить, откройте вопрос в Völva');
  }

  // $this.project, $depth … — из vars; без значения параметр не подставляется пустым.
  let unresolved: string | undefined;
  const src = b.body.replace(/\$([A-Za-z_][\w.]*)/g, (m, name: string) => {
    if (vars[name] !== undefined) return vars[name];
    unresolved ??= m;
    return m;
  });
  if (unresolved) {
    return fail('UNRESOLVED_VAR', `переменная ${unresolved} не задана — передайте её в vars (например {"this.project":"owner/repo"})`);
  }

  const stages = src.split('|').map((s) => s.replace(/\s+/g, ' ').trim());
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

/** Метаданные полноты: «сколько всего», «всё ли пришло», «сужено ли». */
export function completeness(
  rows: unknown[],
  meta: SliceMeta | undefined,
  page: SlicePage | undefined,
  extra: SliceExtra | undefined,
  projectNote: { param: string | null; source: 'block' | 'session_default' | null },
  warnings: string[],
) {
  const truncated = meta !== undefined && meta.truncated !== false;
  const hasMore = page ? page.has_more : truncated;
  // Обрезанная бэкендом выдача не знает итога — null, а не число строк.
  const total = page ? page.total : truncated ? null : rows.length;
  const w = [...warnings];
  if (truncated) w.push(`выдача обрезана бэкендом${meta?.limit ? ` на ${meta.limit}` : ''}${meta?.hint ? ` — ${meta.hint}` : ''}`);
  if (page?.warning) w.push(page.warning);
  if (extra?.outside_scope) w.push('outside_scope: запись с таким id существует, но вне ваших проектов — пустой ответ не значит «нет»');
  const applied = (x: unknown) => typeof x === 'object' && x !== null && (x as { applied?: unknown }).applied === true;
  const narrowed = applied(extra?.scope) || applied(extra?.scope_projects) || projectNote.source === 'session_default';
  return {
    returned: rows.length,
    total,
    truncated,
    has_more: hasMore,
    complete: !truncated && !hasMore,
    ...(page ? { limit: page.limit, offset: page.offset } : meta?.limit ? { limit: meta.limit } : {}),
    scope: {
      narrowed,
      project: projectNote.param,
      project_source: projectNote.source,
      backend_scope: extra?.scope ?? null,
      scope_projects: extra?.scope_projects ?? null,
      outside_scope: extra?.outside_scope ?? null,
    },
    warnings: w,
  };
}
