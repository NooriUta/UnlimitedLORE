# aida-lore-mcp

stdio MCP server exposing **AIDA LORE** (read + write) over the UnlimitedLORE
backend. It proxies the backend's named slices — it never talks to ArcadeDB
directly, so all parameter whitelisting and SQL composition stay server-side.

## Tools

| Tool | Kind | Backend call |
|------|------|--------------|
| `lore_list_slices` | read | `GET /lore/slices` |
| `lore_query_slice` | read | `GET /lore/slice/{slice}` (+ params) |
| `lore_set_status` | write | `POST /lore/status` (SCD2 transition) |
| `lore_create_task` | write | `POST /lore/task` (+ optional `phase_uid` → IN_PHASE) |
| `lore_edit_task` | write | `POST /lore/task/edit` |
| `lore_create_phase` | write | `POST /lore/phase` (KnowPhase + PART_OF + hist) |
| `lore_link_task_phase` | write | `POST /lore/task/phase` (IN_PHASE add/remove) |

BENCHMARK tools are Phase 2 (`src/tools/bench.ts`), pending the bench spec.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `LORE_BACKEND_URL` | `http://localhost:9100` | UnlimitedLORE backend base URL |
| `LORE_SEER_ROLE` | `admin` | `X-Seer-Role` header for write tools |

## Build & run

```bash
cd mcp-server
npm install
npm run build      # → dist/index.js
node dist/index.js # speaks MCP over stdio
```

The backend (`UnlimitedLORE/backend`, port 9100) must be running, and it needs
`ARCADEDB_ROOT_PASSWORD` to reach ArcadeDB.

## Register in Claude Code

The repo root ships `.mcp.json`:

```json
{
  "mcpServers": {
    "aida-lore": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": { "LORE_BACKEND_URL": "http://localhost:9100", "LORE_SEER_ROLE": "admin" }
    }
  }
}
```

For Claude Desktop, add the same block to its config with an absolute path to
`dist/index.js`.

## Quick smoke test (JSON-RPC over stdio)

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/index.js
```
