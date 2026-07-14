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
