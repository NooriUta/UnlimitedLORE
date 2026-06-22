#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerLoreRead } from './tools/loreRead.js';
import { registerLoreWrite } from './tools/loreWrite.js';
import { BACKEND_URL } from './backend.js';
import { registerBench } from './tools/bench.js';

// stdio MCP server for AIDA LORE. Talks to the UnlimitedLORE backend (:9100),
// which in turn serves system_aida_lore. NEVER write to stdout — it is the
// JSON-RPC channel; diagnostics go to stderr only.
const server = new McpServer({ name: 'aida-lore', version: '1.0.0' });

registerLoreRead(server);
registerLoreWrite(server);
registerBench(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[aida-lore-mcp] ready — backend ${BACKEND_URL}`);
}

main().catch((e) => {
  console.error('[aida-lore-mcp] fatal:', e);
  process.exit(1);
});
