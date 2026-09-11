import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loreGet } from '../backend.js';
import { readBuildInfo, type BuildInfo } from '../buildInfo.js';
import { driftVerdict, type Drift } from '../drift.js';

// SE-10: сверка сборки MCP-сервера со сборкой бэкенда.
//
// MCP-сервер сессий собирается из основного чекаута руками и живёт своей
// жизнью: 10.09.2026 он оказался на 281 коммит позади develop, и правки схем
// инструментов до агентов не доходили. Новый параметр давал честный отказ
// «Unrecognized key», а исправленное описание — ничего: сессия молча читала
// старый текст. Здесь расхождение становится видимым: агенту — инструментом,
// человеку — строкой в stderr при старте.

type BackendVersion = { commit?: string; built_at?: string; schema_version?: number };

export type VersionReport = {
  mcp: BuildInfo;
  backend: BackendVersion | null;
  drift: Drift;
  backend_error?: string;
};

export async function versionReport(): Promise<VersionReport> {
  const mcp = readBuildInfo();
  let backend: BackendVersion | null = null;
  let backendError: string | undefined;
  try {
    backend = (await loreGet('/lore/version')) as BackendVersion;
  } catch (e) {
    // Бэкенд недоступен — это НЕ «ok» и не «MCP старше»: вердикт unknown с
    // причиной, чтобы «не смогли проверить» не читалось как «проверили».
    backendError = e instanceof Error ? e.message : String(e);
  }
  const drift = driftVerdict(mcp.built_at, backend?.built_at);
  return backendError ? { mcp, backend, drift, backend_error: backendError } : { mcp, backend, drift };
}

export function registerVersion(server: McpServer): void {
  server.tool(
    'lore_version',
    'Build of this MCP server vs build of the LORE backend (SE-10). Returns {mcp:{commit,built_at}, ' +
      'backend:{commit,built_at,schema_version}, drift:{verdict: ok|mcp_older|unknown, reason}}. ' +
      'mcp_older = the tool schemas you see may lag the backend (a new parameter answers ' +
      '"Unrecognized key", a fixed description still reads old) — rebuild mcp-server and restart the session. ' +
      'Call it when a tool rejects a parameter the backend is known to accept.',
    {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await versionReport(), null, 2) }] }),
  );
}

/** При старте — одна строка в stderr, если MCP старше бэкенда или сверить нельзя.
 *  Старт не роняет: устаревший MCP хуже отсутствующего только тогда, когда о
 *  нём молчат. */
export async function warnIfStale(): Promise<void> {
  try {
    const r = await versionReport();
    if (r.drift.verdict !== 'ok') console.error(`[aida-lore-mcp] сборка: ${r.drift.reason}`);
  } catch (e) {
    console.error(`[aida-lore-mcp] сверка сборки не удалась: ${e instanceof Error ? e.message : String(e)}`);
  }
}
