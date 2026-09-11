// SE-10: вердикт «MCP отстаёт от бэкенда» — чистая функция, без сети.
//
// Сравниваются ВРЕМЕНА сборки, не коммиты: по двум хэшам порядок не
// определить без истории, а её у MCP нет. Время сборки монотонно: бэкенд,
// собранный позже MCP, почти наверняка несёт схемы, которых у MCP нет.
//
// Неизвестность — не «ok»: молчаливое «ok» при неизвестной сборке — та же
// пустышка, что зелёный сторож, который ничего не сторожит.

export type DriftVerdict = 'ok' | 'mcp_older' | 'unknown';
export type Drift = { verdict: DriftVerdict; reason: string };

function parseInstant(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function driftVerdict(mcpBuiltAt: string | undefined, backendBuiltAt: string | undefined): Drift {
  const m = parseInstant(mcpBuiltAt);
  const b = parseInstant(backendBuiltAt);
  if (m === null || b === null) {
    return {
      verdict: 'unknown',
      reason: `отметка сборки не читается: MCP=${mcpBuiltAt?.trim() || 'нет'}, бэкенд=${backendBuiltAt?.trim() || 'нет'} — ` +
        'сверить нельзя; если это стенд, пересоберите MCP (npm run build) и проверьте /lore/version',
    };
  }
  if (m < b) {
    return {
      verdict: 'mcp_older',
      reason: `MCP собран ${mcpBuiltAt}, бэкенд собран ${backendBuiltAt} — MCP старше бэкенда: ` +
        'схемы инструментов могут отставать (новый параметр → «Unrecognized key», ' +
        'исправленное описание → старый текст). Пересоберите mcp-server (npm run build) и перезапустите сессию.',
    };
  }
  return { verdict: 'ok', reason: '' };
}
