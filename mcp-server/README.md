# aida-lore-mcp

stdio MCP server exposing **AIDA LORE** (read + write) over the UnlimitedLORE
backend. It proxies the backend's named slices — it never talks to ArcadeDB
directly, so all parameter whitelisting and SQL composition stay server-side.

## Tools

~62 tools total, named `<category>_<verb>` (ADR-LORE-014 §1-2 — no `lore_` prefix; canon verbs
new/set/del/mv/get/log/search, plus `<cat>_link(rel, ...)` for edges). A representative sample:

| Tool | Kind | Backend call |
|------|------|--------------|
| `list_slices` | read | `GET /lore/slices` |
| `query_slice` | read | `GET /lore/slice/{slice}` (+ params) |
| `status_set` | write | `POST /lore/status` (SCD2 transition) |
| `task_new` | write | `POST /lore/task` (+ optional `phase_uid` → IN_PHASE) |
| `task_set` | write | `POST /lore/task/edit` |
| `sprint_phase_new` | write | `POST /lore/phase` (KnowPhase + PART_OF + hist) |
| `task_link` | write | `POST /lore/task/phase` or `/lore/task/component` (`rel` picks the edge) |

Full old→new mapping and the complete link-collapse table: [MIGRATION.md](./MIGRATION.md). Live,
authoritative catalog with every tool's params: run `tools/list` (see smoke test below), or the
`/lore?section=mcp` page in the UI. Per-role permission profiles for these tools:
[agent-profiles/](./agent-profiles/).

`bench_*` tools (`src/tools/muninn.ts`) are a separate, untouched family for the RAGVSDL
experiment mart — documented on `/benchmark?tab=mcp` instead.

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
