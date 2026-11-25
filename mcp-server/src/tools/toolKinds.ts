// SPRINT_LORE_EXT_ISSUES_W2/ISS-06-LINK-FALSE-SUCCESS, решение D-2026-LORE-MCP-LINK-NOOP-IS-ERROR:
// каждый инструмент MCP помечен — read (чтение, пустая выдача не ошибка) или cud (создание, правка,
// удаление, связь, статус: «ничего не изменилось» → isError, см. cudOutcome.ts).
// Пометка решает, идёт ли инструмент через обёртку noopAsError (strictTool.ts). Новый инструмент
// без пометки краснит сторож cudNoop.test.ts — выбрать read или cud нужно осознанно.
export type ToolKind = 'read' | 'cud';

const READ = [
  'bench_list_slices', 'bench_query_slice', 'bench_status',
  'bragi_search', 'changed', 'claude_rules_diff', 'claude_rules_pull',
  'find', 'forgejo_branch_protection', 'forgejo_ci_status', 'forgejo_pr_status',
  'graph', 'graph_path', 'harness_list', 'list_slices', 'lore_version',
  'machine_acl', 'metric_get', 'project_export', 'quality_check', 'query_slice',
  'run_block', 'search', 'search_similar', 'task_shape', 'uc_quality', 'whoami',
] as const;

const CUD = [
  'actor_link', 'actor_new', 'adr_del', 'adr_link', 'adr_new', 'adr_rename', 'adr_set',
  'agent_session_log', 'asset_up',
  'bragi_asset_attach', 'bragi_asset_up', 'bragi_campaign_new', 'bragi_channel_set', 'bragi_integration_new',
  'bragi_keyword_set', 'bragi_link', 'bragi_page_set', 'bragi_pub_new', 'bragi_rubric_set', 'bragi_sync',
  'bragi_variant_new',
  'claude_rules_push',
  'component_del', 'component_new', 'component_set',
  'decision_link', 'decision_new', 'decision_set', 'dict_set',
  'doc_del', 'doc_link', 'doc_new',
  'entity_delete', 'entity_link', 'entity_move', 'entity_upsert',
  'feature_link', 'feature_new', 'forgejo_pr_merge', 'forgejo_pr_new',
  'gain_new', 'insight_link', 'insight_new', 'job_new',
  'machine_access_set', 'machine_new', 'machine_owner_set', 'metric_log',
  'milestone_link', 'milestone_new', 'milestone_set', 'milestone_sprints',
  'pain_new', 'product_link', 'project_actor_new', 'project_new', 'project_role_set',
  'qg_job_new', 'qg_new', 'qg_run_log',
  'question_link', 'question_new', 'question_set',
  'rec_new', 'rec_promote',
  'release_link', 'release_mv', 'release_new', 'release_set', 'release_unlink',
  'runbook_link', 'runbook_new',
  'spec_del', 'spec_link', 'spec_new', 'spec_set',
  'sprint_link', 'sprint_new', 'sprint_phase_new', 'sprint_plan_set', 'sprint_set',
  'status_set', 'status_set_batch',
  'task_link', 'task_mv', 'task_new', 'task_set',
  'tech_set', 'uc_link', 'uc_new', 'vp_link',
] as const;

export const TOOL_KIND: Readonly<Record<string, ToolKind>> = Object.freeze({
  ...Object.fromEntries(READ.map((n) => [n, 'read' as const])),
  ...Object.fromEntries(CUD.map((n) => [n, 'cud' as const])),
});

export function toolKind(name: string): ToolKind | undefined {
  return TOOL_KIND[name];
}
