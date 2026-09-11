#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerLoreRead } from './tools/loreRead.js';
import { registerLoreWrite } from './tools/loreWrite.js';
import { BACKEND_URL } from './backend.js';
import { registerMuninn } from './tools/muninn.js';
import { registerClaudeRules } from './tools/claudeRules.js';
import { registerForgejo, forgejoConfigured } from './tools/forgejo.js';
import { registerVersion, warnIfStale } from './tools/version.js';
import { readBuildInfo } from './buildInfo.js';
import { withStrictTools } from './tools/strictTool.js';

// stdio MCP server for AIDA LORE. Talks to the UnlimitedLORE backend (:9100),
// which in turn serves system_aida_lore. NEVER write to stdout — it is the
// JSON-RPC channel; diagnostics go to stderr only.
// withStrictTools (MT-09): wraps .tool() so every schema below is registered
// strict — an unknown parameter is a 400, not a silently dropped key.
//
// SE-10: версия сервера — отметка сборки (dist/build-info.json), а не
// константа '1.0.0': по константе нельзя было отличить сборку двухнедельной
// давности от сегодняшней, а именно это расхождение и прятало правки схем.
const build = readBuildInfo();
const server = withStrictTools(new McpServer({ name: 'aida-lore', version: build.commit }));

registerLoreRead(server);
registerLoreWrite(server);
registerMuninn(server);
// Правила CLAUDE переехали из репозитория в LORE (29.08.2026): main зеркалируется
// в публичный GitHub. Эти два инструмента и есть путь туда и обратно — без них
// перенос оставлял бы правила без способа их положить и забрать.
registerClaudeRules(server);
// FJ-04: forgejo_* появляются только при заявленном мосте (LORE_FORGEJO / FORGEJO_*-env);
// без него инструментов нет вовсе — лучше, чем вечные 503 (ADR-LORE-024).
registerForgejo(server);
if (!forgejoConfigured()) console.error('[aida-lore-mcp] forgejo bridge off (no LORE_FORGEJO/FORGEJO_* env) — forgejo_* tools not registered');
// SE-10: сверка своей сборки со сборкой бэкенда — инструментом для агента и
// строкой в stderr для человека.
registerVersion(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[aida-lore-mcp] ready — backend ${BACKEND_URL}, build ${build.commit} @ ${build.built_at || 'unknown'}`);
  // После connect и без await: предупреждение не должно задерживать готовность
  // и не должно ронять старт, если бэкенд недоступен.
  void warnIfStale();
}

main().catch((e) => {
  console.error('[aida-lore-mcp] fatal:', e);
  process.exit(1);
});
