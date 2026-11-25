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
| `task_link` | write | `POST /lore/task/phase`, `/lore/task/component`, `/lore/task/adr`, `/lore/task/pr`, `/lore/task/file`, `/lore/task/dep` (`rel` picks the edge; `dep` = DEPENDS_ON task→task, kind/reason) |
| `machine_acl` | read | `GET /lore/slice/machine_acl` — `machine_id` (→ `client_id` `minilore-link-<id>`) \| `client_id` \| `kc_sub` |
| `harness_list` | read | `GET /lore/slice/dictionary?dict_type=harness` (write via `dict_set`) |
| `machine_access_set` | write | `POST /lore/user/machine-access` — `machine_id, kc_sub, action grant\|revoke, role viewer\|actor, projects[], harnesses[], dry_run`; owner/admin only, an agent gets the server's 403 as is |
| `machine_new` | write | `POST /lore/actor/machine` — `machine_id, kc_sub?, harness?, name?, profile?, dry_run`; one call enrolls a miniLORE machine (actor `minilore-link-<machine_id>`, owner, KnowMachine, USES_MACHINE). Agent `full` — only for its own owner; human — themself; admin — anyone; someone else's machine/name → 409 with the owner's name |
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
| `LORE_MCP_FILE_ROOTS` | рабочая папка процесса MCP | Корни, из которых `doc_new` / `entity_upsert type=doc` читают `content_html_file`, `content_md_ru_file`, `content_md_en_file` (через `;` на Windows, `:` на POSIX). Сверка после realpath, предел 20 МБ, только UTF-8. В режиме `LORE_MCP_TRANSPORT=http` `*_file` всегда отказ — файлы клиента серверу недоступны |

## Hosted (HTTP) mode

On the LORE stand the server runs as service `lore-mcp` at `https://<LORE host>/mcp`
(`LORE_MCP_TRANSPORT=http`). Each request authenticates with either
`Authorization: Bearer <token>` or the pair `X-Lore-Client-Id` + `X-Lore-Client-Secret`
(the server then fetches and caches the client_credentials token itself; needs
`LORE_OIDC_ISSUER`). Claude Code: `headersHelper` →
`node mcp-server/scripts/lore-mcp-headers.mjs`. OpenCode (`"oauth": false` is
mandatory, otherwise the secret headers go to `/.well-known` and `/register`):

```json
{ "mcp": { "aida-lore": { "type": "remote", "url": "https://<LORE host>/mcp", "enabled": true, "oauth": false,
  "headers": { "X-Lore-Client-Id": "{env:LORE_MCP_CLIENT_ID}", "X-Lore-Client-Secret": "{env:LORE_MCP_CLIENT_SECRET}",
    "X-Lore-Mcp-Profile": "full", "X-Lore-Harness": "opencode", "X-Lore-Machine": "{env:LORE_MACHINE_ID}",
    "X-Lore-Session-Id": "opencode-{env:OPENCODE_PID}" } } } }
```

HTTP-mode settings (issue #4): `LORE_MCP_HOST` (default `127.0.0.1`; the `lore-mcp`
image sets `0.0.0.0`), `LORE_MCP_PORT` (default `9200`), `LORE_MCP_TOKEN` — gateway token
for clients without Keycloak (Llama Chat and other web UIs): when set, every `/mcp` request
must carry it as `Authorization: Bearer <token>` or `X-Lore-Mcp-Token: <token>`, else 401;
the gateway token is never forwarded to the backend. `LORE_MCP_CORS_ORIGINS` — comma list
of allowed browser origins (preflight 204, foreign origin 403; empty = CORS off).
`GET /health` and `GET /mcp/health` answer 200 without auth. No token on a non-loopback
host → loud warning at start. Writing without Keycloak over HTTP is not supported yet: the
HTTP mode does not send `X-Seer-Role` (owner decision pending).

Full configs, the OpenCode 1.19.6 probe and error codes:
[docs/runbooks/mcp-hosted.md](../docs/runbooks/mcp-hosted.md).

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

**Canonical: user scope** (`~/.claude.json`), not a project `.mcp.json`. Since
#1298 the repo no longer tracks `.mcp.json` — secrets and machine paths must not
travel between branches — and a stale local project file *overrides* the user
entry (13.11.2026: an old secret there gave every call 401 while the user entry
was fine). Build a dedicated checkout (e.g. `C:\AIDA\UnlimitedLORE-mcp`) and
register it once per machine:

```bash
claude mcp add --scope user aida-lore \
  -e LORE_BACKEND_URL=https://lore.odal.seidrstudio.pro/_backend \
  -e LORE_OIDC_ISSUER=https://odal.seidrstudio.pro/kc/realms/omilore \
  -e LORE_MCP_CLIENT_ID=lore-mcp-full \
  -e LORE_MCP_CLIENT_SECRET=<secret of THIS client> \
  -e LORE_MACHINE_ID=<machine name> \
  -- node /abs/path/UnlimitedLORE-mcp/mcp-server/dist/index.js
```

One Keycloak client per harness: `lore-mcp-full` is Claude Code's,
other harnesses use their own `lore-mcp-full_<harness>` (e.g. `_kimi`) — a
borrowed client attributes actions in the graph to the wrong agent. The session
hook (`.claude/hooks/session-start-register.ps1`) reads the same entry, so the
secret lives in one place. `.mcp.json.example` is only for a deliberate project
scope; local dev against `http://localhost:9100` needs just `LORE_BACKEND_URL`
and `LORE_SEER_ROLE=admin`.

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
