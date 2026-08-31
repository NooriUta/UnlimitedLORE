#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerLoreRead } from './tools/loreRead.js';
import { registerLoreWrite } from './tools/loreWrite.js';
import { BACKEND_URL } from './backend.js';
import { registerMuninn } from './tools/muninn.js';
import { registerClaudeRules } from './tools/claudeRules.js';
import { registerForgejo, forgejoConfigured } from './tools/forgejo.js';
import { withStrictTools } from './tools/strictTool.js';

// stdio MCP server for AIDA LORE. Talks to the UnlimitedLORE backend (:9100),
// which in turn serves system_aida_lore. NEVER write to stdout — it is the
// JSON-RPC channel; diagnostics go to stderr only.
// withStrictTools (MT-09): wraps .tool() so every schema below is registered
// strict — an unknown parameter is a 400, not a silently dropped key.
const server = withStrictTools(new McpServer({ name: 'aida-lore', version: '1.0.0' }));

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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[aida-lore-mcp] ready — backend ${BACKEND_URL}`);
}

main().catch((e) => {
  console.error('[aida-lore-mcp] fatal:', e);
  process.exit(1);
});
