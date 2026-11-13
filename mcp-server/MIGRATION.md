# aida-lore MCP tool rename — migration guide (ADR-LORE-014 §1-2, T02)

Every `lore_*`/`bench_*`-prefixed tool except `bench_*` (untouched — see ADR) was renamed to
`<category>_<verb>` per ADR-LORE-014 §2, and ~22 `lore_link_*`/`lore_unlink_*` tools collapsed
into 8 `<category>_link(rel, ...)` tools (one per category, `rel` picks the edge type).

If you have code, docs, skills, or memory referencing an old name, look it up below and update it.
Historical text documenting past decisions (old ADR/note_md bodies) does not need updating — only
live call sites.

## Simple renames (same signature, name only)

| Old name | New name |
|---|---|
| `lore_list_slices` | `list_slices` |
| `lore_query_slice` | `query_slice` |
| `lore_set_status` | `status_set` |
| `lore_batch_set_status` | `status_set_batch` |
| `lore_create_task` | `task_new` |
| `lore_move_task` | `task_mv` |
| `lore_edit_task` | `task_set` |
| `lore_create_phase` | `sprint_phase_new` |
| `lore_create_sprint` | `sprint_new` |
| `lore_create_milestone` | `milestone_new` |
| `lore_update_milestone` | `milestone_set` |
| `lore_create_adr` | `adr_new` |
| `lore_update_adr` | `adr_set` |
| `lore_rename_adr` | `adr_rename` |
| `lore_delete_adr` | `adr_del` |
| `lore_create_decision` | `decision_new` |
| `lore_create_release` | `release_new` |
| `lore_update_release` | `release_set` |
| `lore_create_spec` | `spec_new` |
| `lore_update_spec` | `spec_set` |
| `lore_delete_spec` | `spec_del` |
| `lore_upsert_tech` | `tech_set` |
| `lore_create_quality_gate` | `qg_new` |
| `lore_create_qg_job_task` | `qg_job_new` |
| `lore_record_qg_run` | `qg_run_log` |
| `lore_create_recommendation` | `rec_new` |
| `lore_promote_recommendation` | `rec_promote` |
| `lore_create_runbook` | `runbook_new` |
| `lore_create_doc` | `doc_new` |
| `lore_delete_doc` | `doc_del` |
| `lore_create_component` | `component_new` |
| `lore_update_component` | `component_set` |
| `lore_upsert_dict_entry` | `dict_set` |
| `lore_record_metric` | `metric_log` |
| `lore_query_metric` | `metric_get` |
| `lore_create_insight` | `insight_new` |
| `lore_upsert_rubric` | `bragi_rubric_set` |
| `lore_upsert_channel` | `bragi_channel_set` |
| `lore_create_publication` | `bragi_pub_new` |
| `lore_create_variant` | `bragi_variant_new` |
| `lore_upsert_keyword` | `bragi_keyword_set` |
| `lore_find_keyword` | `bragi_search` |
| `lore_upsert_page` | `bragi_page_set` |
| `lore_create_campaign` | `bragi_campaign_new` |
| `lore_create_integration` | `bragi_integration_new` |
| `lore_sync_integration` | `bragi_sync` |

## Renamed with a naming-gap fix (not literally in ADR-014 §2's table)

| Old name | New name | Why |
|---|---|---|
| `lore_upload_asset` | `bragi_asset_up` | Operates on `BragiAsset` (`/lore/bragi/asset/upload`), but the ADR table names it `doc_asset_up` under category `doc`. That's a mismatch in the ADR text, not a code decision — renamed to match what it actually touches. |
| `lore_attach_asset` | `bragi_asset_attach` | Same as above (`doc_asset_attach` → `bragi_asset_attach`). |
| `lore_move_to_project` | `release_mv` | Not in the ADR's table at all — `project` there means the new `project_new`/KnowGitProject tool (T15), a different thing. This fixes a misattributed `git_project` on an existing PR or release, so it's grouped under `release_*` instead. |

## Signature changes (not just a rename)

- **`sprint_set`** merges the old `lore_update_sprint` (metadata: name/outcome_md/context_md/plan_id/effort_days)
  and `lore_update_sprint_refs` (pr_refs: pr_numbers/git_project→`pr_git_project`/repo_url→`pr_repo_url`/replace→`pr_replace`)
  into one tool. Pass metadata fields and/or `pr_numbers` in the same call; each group routes to its own backend
  endpoint internally.
- **`rec_promote`** gained an optional `task_type` param (defaults to `research` — ADR-LORE-015's Analyst-owns-research
  default — when the caller doesn't override it). Added as part of T13, not T02, but lands in the same tool.

## Link-collapse (`rel` parameter picks the edge type)

| New tool | `rel` values | Old tools it replaces |
|---|---|---|
| `adr_link` | `sprint`, `release`, `component`, `depends_on`, `supersedes`, `tag` | `lore_link_adr_sprint`, `lore_link_adr_release`, `lore_link_adr_component`, `lore_link_adr_depends_on`, `lore_link_adr_supersedes`, `lore_link_adr_tag` |
| `sprint_link` | `project`, `dep`, `component`, `milestone` | `lore_link_sprint_project`, `lore_link_sprint_dep`, `lore_link_sprint_component`, `lore_link_sprint_milestone` |
| `task_link` | `phase`, `component` | `lore_link_task_phase`, `lore_link_task_component` |
| `doc_link` | `parent`, `component`, `sprint` | `lore_link_doc_parent`, `lore_link_doc_component`, `lore_link_doc_sprint` |
| `release_link` | `sprint`, `pr` | `lore_link_release`, `lore_link_release_pr` (`lore_unlink_release` stays separate → `release_unlink`, already batch-shaped with no `action` toggle) |
| `bragi_link` | `rubric`, `produced_by`, `shipped_in` | `lore_link_rubric`, `lore_link_bragi_forseti` — the messiest collapse: each old tool had its own `entity_type` axis independent of the edge type; resolved by making `rel` the edge/purpose and keeping `entity_type`/`target_type`/`git_project` as `rel`-conditional side params. |
| `runbook_link` | `adr` (only value today) | `lore_link_runbook_adr` — kept for naming symmetry, not a real collapse yet |
| `insight_link` | `task`, `adr` | `lore_link_insight` (param renamed `target_type`→`rel`) |

Every `*_link` tool's `target_id` param carries whatever id the old tool's distinct target param held
(e.g. `adr_link(rel:"sprint", target_id: <sprint_id>)` replaces `lore_link_adr_sprint(sprint_id: ...)`).
`action` (`add`/`remove`) is unchanged everywhere.

## Entity consolidation (`entity_*`, SPRINT_LORE_MCP_V2/MCPV2-3, 13.11.2026)

The default full surface shrinks by tool COUNT: 59 per-entity CRUD variations collapse into 4 generic
tools. The dispatcher reuses the same backend paths and payload shapes — no new network behavior; field
validation stays server-side exactly as it was for the per-entity tools.

| New tool | Replaces (hidden by default) |
|---|---|
| `entity_upsert(type, id?, fields)` | `adr_new`, `adr_set`, `spec_new`, `spec_set`, `task_new`, `sprint_new`, `sprint_phase_new`, `release_new`, `milestone_new`, `milestone_set`, `decision_new`, `question_new`, `question_set`, `component_new`, `doc_new`, `uc_new`, `feature_new`, `pain_new`, `gain_new`, `job_new`, `runbook_new`, `insight_new`, `actor_new`, `project_actor_new`, `project_new`, `dict_set`, `tech_set`, `bragi_pub_new`, `bragi_variant_new`, `bragi_keyword_set`, `bragi_page_set`, `bragi_campaign_new`, `bragi_rubric_set`, `bragi_channel_set`, `bragi_integration_new` |
| `entity_link(type, id, rel, target_id?, action?, fields?)` | `adr_link`, `sprint_link`, `task_link`, `doc_link`, `runbook_link`, `insight_link`, `release_link`, `release_unlink`, `vp_link`, `feature_link`, `uc_link`, `actor_link`, `decision_link`, `question_link`, `product_link`, `milestone_link`, `spec_link` |
| `entity_delete(type, id)` | `adr_del`, `spec_del`, `doc_del`, `component_del` |
| `entity_move(type, id, target)` | `task_mv`, `release_mv` (+ `pr` moves) |

`type` is an enum (an unknown value is a 400 with the full list); `fields` is a free-form record whose
payload shapes are exactly those of the replaced tools (see their descriptions / this file's tables).
Per-type notes:

- **Composite ids**: `task` takes the uid `"SPRINT_X/T05"` as `id`; `dict`, `phase`, `tech` take their id
  parts in `fields` (`dict_type+code`, `sprint_id+phase_key`, `component_id+tech_name+version`) — omit `id`.
- **Project guard** (parity with the old `*_new` orphan guard, now covering amends too): for `adr`, `doc`,
  `spec`, `runbook`, `question`, `uc`, `feature`, `tech` a project is REQUIRED — pass `fields.project` or set
  `LORE_ACTIVE_PROJECT`; the BELONGS_TO_PROJECT edge is wired inline after the write. `decision` waives the
  guard when `fields.adr_id` is set. Tightening vs the old `*_set` tools (which had no guard): an amend via
  `entity_upsert` needs a project; `LORE_MCP_LEGACY=1` restores the old surface if you must amend project-less.
- **`dict`**: `fields.human_approval` travels as the `X-Lore-Human-Approval` header, not the body.
- **`question`**: `fields.status="closed"` is refused with guidance — close via `entity_link type=question rel=answers`.
- **`entity_link` extras** ride in `fields`: `git_project` (adr/release, bragi `shipped_in`), `kind`+`reason`
  (sprint `dep`), `project`+`summary_md` (task `file`/`pr`), `actor_role` (uc `actor`), `target_type`
  (question `raised_in`, bragi `produced_by`), `role`+`kind` (product), `mode` (spec — `add|remove|replace`,
  default `replace`; `action` is NOT accepted for spec). `target_id` accepts an array for `type=release`
  (the old `release_link`/`release_unlink` were batch). `type=insight` is add-only.
- Deliberately NOT consolidated (stay always-on): `status_set`, `status_set_batch`, `sprint_set`,
  `sprint_plan_set`, `task_set`, `release_set`, `component_set`, `decision_set`, `milestone_sprints`,
  `adr_rename`, `qg_*`, `rec_*`, `agent_session_log`, `machine_*`, `project_role_set`, `metric_*`,
  `asset_up`, `bragi_asset_*`, `bragi_sync` — narrow/bespoke shapes (batch, append, SCD2 status, RBAC,
  machines, uploads).

### LORE_MCP_LEGACY and profiles (exact semantics)

- `LORE_MCP_LEGACY=1` → the full old surface + `entity_*` (escape hatch for stale callers).
- Active profile ≠ `full` (`LORE_MCP_PROFILE` env or the token's `agent_scope`) → the old names stay
  available within the profile (the `agent-profiles/*.json` files reference them — a developer-profile
  session still sees `task_*`); `entity_*` shows only if the profile itself allows writes it covers.
- Default (full, no axes) → covered old names are hidden; work goes through `entity_*`.

**Finding (13.11.2026): `entity_*` is deliberately NOT listed in `agent-profiles/*.json`.** The backend
matrix test (`AgentProfilesMatchMatrixTest`) checks every profile promise against `tool-paths.json`: one
`entity_upsert` entry carries the union of ~36 backend paths across all covered families, and every
non-full profile is denied several of them (e.g. developer → `/lore/sprint/create`, `/lore/dict/entry`,
`/lore/bragi/*`, `/lore/component/create`; verified empirically — 51 violations when added to
`developer.json`). Per-type granularity now lives on the BACKEND (`AgentScopeFilter` by path families and
subpaths), not in the MCP tool name; the profile files keep the old per-entity names, which remain the
profiled surface. The default full surface is what shrinks (105 → 50 tools; 110 → 55 with the forgejo
bridge on).
