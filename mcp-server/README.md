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
| `graph` | read | `GET /lore/graph` — neighborhood (`type`+`id`, `depth` 1..4, walk only via `rels`) or slice (`scope`); `meta.rels_available`, `meta.by_depth`, `truncated`/`capped_at`/`limit` (GC-04) |
| `status_set` | write | `POST /lore/status` (SCD2 transition) |
| `task_new` | write | `POST /lore/task` (+ optional `phase_uid` → IN_PHASE) |
| `task_set` | write | `POST /lore/task/edit` |
| `sprint_phase_new` | write | `POST /lore/phase` (KnowPhase + PART_OF + hist) |
| `task_link` | write | `POST /lore/task/phase` or `/lore/task/component` (`rel` picks the edge) |
| `machine_acl` | read | `GET /lore/slice/machine_acl` — `machine_id` (→ `client_id` `minilore-link-<id>`) \| `client_id` \| `kc_sub` |
| `harness_list` | read | `GET /lore/slice/dictionary?dict_type=harness` (write via `dict_set`) |
| `machine_access_set` | write | `POST /lore/user/machine-access` — `machine_id, kc_sub, action grant\|revoke, role viewer\|actor, projects[], harnesses[], dry_run`; owner/admin only, an agent gets the server's 403 as is |
| `machine_owner_set` | write | `POST /lore/actor/owner` (+ `POST /lore/actor` if the actor is missing) — `client_id, kc_sub, profile, machine_id, harness`; humans/admin only, an agent gets the server's 403 as is |

Full old→new mapping and the complete link-collapse table: [MIGRATION.md](./MIGRATION.md). Live,
authoritative catalog with every tool's params: run `tools/list` (see smoke test below), or the
`/lore?section=mcp` page in the UI. Per-role permission profiles for these tools:
[agent-profiles/](./agent-profiles/).

`bench_*` tools (`src/tools/muninn.ts`) are a separate, untouched family for the RAGVSDL
experiment mart — documented on `/benchmark?tab=mcp` instead.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `LORE_BACKEND_URL` | `http://localhost:9100` | UnlimitedLORE backend base URL (на стенде — прямой маршрут `https://lore.odal.seidrstudio.pro/_backend`, S2-08) |
| `LORE_BACKEND_FALLBACK_URL` | — | Запасной адрес (nginx фронта `:4400`); используется, только если до основного запрос не дошёл (соединение/TLS, либо ответил SPA) |
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

## Contract snapshot (S0-01)

`src/tools/contract.test.ts` calls every tool (backend stubbed) and compares its
parameters and response shape with `src/tools/contract.snapshot.json`. A changed
parameter, a dropped tool or a missing response field fails CI on every PR. When
the change is intentional, regenerate and commit the snapshot together with it:

```bash
UPDATE_MCP_CONTRACT=1 npx vitest run src/tools/contract.test.ts
```

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
