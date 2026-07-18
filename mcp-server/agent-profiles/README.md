# aida-lore agent profiles (ADR-LORE-014 §3)

8 [OpenCode agent](https://opencode.ai/docs/agents) permission profiles for the `aida-lore` MCP
server's tools. `full` is the `primary` mode profile (Claude / backfill sessions) with unrestricted
`"*": "allow"`. The other 7 are `subagent` mode, each a `"*": "deny"` catch-all plus an allow-list of
the tool-name-prefix categories that role owns (permission keys are glob patterns matched against
the MCP tool name — see [MIGRATION.md](./MIGRATION.md) for the current tool name list).

Read tools (`list_slices`, `query_slice`) are allowed on every profile — reading the graph never
needs restricting, only writes do.

| Profile | Owns |
|---|---|
| `full` | everything (primary) |
| `architect` | `adr_*`, `component_*`, `tech_*`, `spec_*`, `runbook_*`, `doc_*`, `decision_*`, `question_*`, `project_new`, `status_set`, `feature_*`, `uc_*`, `pain_*`, `gain_*`, `job_*`, `vp_*` |
| `marketer` | `bragi_*`, `task_*`, `insight_*`, `rec_*`, `doc_*`, `status_set` |
| `developer` | `task_*`, `release_*`, `tech_*`, `spec_*`, `runbook_*`, `doc_*`, `adr_new`, `status_set` |
| `tester` | `qg_*`, `task_*`, `status_set`, `status_set_batch` |
| `pm` | `sprint_*`, `task_*`, `milestone_*`, `project_new`, `status_set`, `status_set_batch`, `feature_*`, `uc_*`, `pain_*`, `gain_*`, `job_*`, `vp_*` |
| `analyst` | `metric_*`, `insight_*`, `rec_*`, `task_set`, `status_set` |
| `product-analyst` | `pain_*`, `gain_*`, `job_*`, `vp_*`, `feature_link`, `uc_link`, `uc_quality`, `metric_*`, `insight_*`, `rec_*`, `question_*`, `task_set`, `status_set` |

`project_new` (T15) is deliberately restricted to `pm` + `architect` + `full` only — registering a
git project is a management/architecture decision, not an operational one (ADR-LORE-015 §4 finding,
amended in ADR-LORE-014 §3 once the write path was discovered to not exist at all).

The single hard SDLC gate (ADR-LORE-014 §4) — a task can't reach `done` if `reviewer_agent` is empty
or equals `executor_agent` — is enforced by the backend on `status_set`, not by these profiles. The
profiles are an RBAC convention on top of that; they don't replace it.

## Wiring a profile into OpenCode

Point an agent's config at one of these files (or copy its `permission` block into your own
`opencode.json`/agent definition) — see [opencode.ai/docs/agents](https://opencode.ai/docs/agents)
and [opencode.ai/docs/config](https://opencode.ai/docs/config) for the full config shape. Each file
here is already a complete, valid agent-config fragment (`mode` + `permission`), so the simplest
wiring is to reference the file directly from your OpenCode agent registry.
