import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lorePost, loreGet, loreUpload } from '../backend.js';

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

// Factory for the common write-tool shape: validate against `schema`, POST the
// mapped body to `path`, wrap the result in json()/err(). Removes the repeated
// try/catch boilerplate that every straight-through tool used to inline. Tools
// with pre-processing (batch branches, computed ids, GET/upload) stay explicit.
function definePostTool<S extends z.ZodRawShape>(
  server: McpServer,
  def: {
    name: string;
    description: string;
    schema: S;
    path: string;
    body: (args: z.objectOutputType<S, z.ZodTypeAny>) => Record<string, unknown>;
  },
): void {
  // The SDK's server.tool overloads don't unify cleanly with a generic shape, so
  // the registration is cast. Per-call-site type safety comes from `def.body`
  // being checked against `S`; runtime validation is the zod `schema` itself.
  const handler = async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
    try {
      return json(await lorePost(def.path, def.body(args)));
    } catch (e) {
      return err(e);
    }
  };
  (server.tool as (...a: unknown[]) => unknown)(def.name, def.description, def.schema, handler);
}

// Full set of statuses accepted by the backend. Canonical source of truth:
// shared/lore-statuses.json (planStatuses). Drift is caught in CI by
// `npm run check:statuses` (scripts/check-lore-statuses.mjs) — update the JSON
// first, then mirror here.
const LORE_STATUS = z.enum([
  'todo', 'planned', 'active', 'partial', 'done',
  'blocked', 'high', 'cancelled', 'backlog', 'design', 'ready_for_deploy',
]);

export function registerLoreWrite(server: McpServer): void {
  // SCD2 status transition (closes the open history row, opens a new one, edges,
  // denormalizes status onto the vertex). Writes to the shared system_aida_lore.
  definePostTool(server, {
    name: 'lore_set_status',
    description: 'Set the status of a LORE entity (SCD2 transition). Mutates the shared ' +
      'system_aida_lore — use deliberately. Returns the new revision.',
    schema: {
      entity_type: z.enum(['sprint', 'task', 'checkpoint', 'phase']),
      id: z.string().describe('entity id (e.g. sprint_id, task_uid, phase_uid "SPRINT_X/PHASE_A")'),
      status: LORE_STATUS,
    },
    path: '/lore/status',
    body: ({ entity_type, id, status }) => ({ entity_type, id, status }),
  });

  definePostTool(server, {
    name: 'lore_create_task',
    description: 'Create a new task under a sprint (appends with the next order_index, opens an ' +
      'initial PLANNED history state). Optionally attaches the task to a sprint phase ' +
      '(IN_PHASE edge — the tasks_of_phase slice reads it). Mutates the shared system_aida_lore.',
    schema: {
      sprint_id: z.string(),
      task_id: z.string().describe('short task id, unique within the sprint'),
      title: z.string(),
      note_md: z.string().optional().describe('optional Markdown note'),
      phase_uid: z.string().optional()
        .describe('optional phase to attach to, e.g. "SPRINT_X/PHASE_A" (must belong to the same sprint; create via lore_create_phase first)'),
    },
    path: '/lore/task',
    body: ({ sprint_id, task_id, title, note_md, phase_uid }) => ({
          sprint_id, task_id, title,
          note_md: note_md ?? null, phase_uid: phase_uid ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_create_phase',
    description: 'Create a sprint phase (KnowPhase): PART_OF → sprint, initial PLANNED history state. ' +
      'phase_uid = "<sprint_id>/PHASE_<KEY>". Idempotent — an existing phase is returned ' +
      'unchanged (created=false). Attach tasks via lore_create_task(phase_uid) or ' +
      'lore_link_task_phase. Mutates the shared system_aida_lore.',
    schema: {
      sprint_id: z.string().describe('e.g. "SPRINT_GEOID_STRUCTURAL_ID"'),
      phase_key: z.string().describe('short phase key, e.g. "A", "B", "1" → phase_uid "SPRINT_X/PHASE_A", display "Фаза A"'),
      name: z.string().optional().describe('optional human-readable phase name'),
      order_index: z.number().int().optional().describe('explicit position; default = max existing + 1'),
    },
    path: '/lore/phase',
    body: ({ sprint_id, phase_key, name, order_index }) => ({
          sprint_id, phase_key,
          name: name ?? null, order_index: order_index ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_task_phase',
    description: 'Link (or unlink) a task to a sprint phase via an IN_PHASE edge. Task and phase must ' +
      'belong to the same sprint. Idempotent on add. action="remove" detaches (omit ' +
      'phase_uid with remove to detach the task from ALL phases). Mutates system_aida_lore.',
    schema: {
      task_uid: z.string().describe('full task uid, e.g. "SPRINT_X/B1"'),
      phase_uid: z.string().optional().describe('phase uid, e.g. "SPRINT_X/PHASE_B"; required for add'),
      action: z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/task/phase',
    body: ({ task_uid, phase_uid, action }) => ({
          task_uid, phase_uid: phase_uid ?? null, action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_create_sprint',
    description: 'Create a new KnowSprint vertex directly. Idempotent (upsert by sprint_id). ' +
      'Seeds an initial HAS_STATE history row. Mutates system_aida_lore.',
    schema: {
      sprint_id:  z.string().describe('unique sprint id, e.g. "SPRINT_SITE_EXTRACT"'),
      name:       z.string().describe('human-readable sprint name'),
      status:     LORE_STATUS.optional().default('todo'),
      plan_id:    z.string().optional().describe('optional plan this sprint belongs to'),
      priority:   z.string().optional().describe('e.g. "high", "critical"'),
      outcome_md: z.string().optional().describe('sprint goal / outcome in Markdown'),
      context_md: z.string().optional().describe('background context for the sprint — WHY it exists, key decisions, related sprints, links to docs. Shown in sprint detail panel.'),
    },
    path: '/lore/sprint/create',
    body: ({ sprint_id, name, status, plan_id, priority, outcome_md, context_md }) => ({
          sprint_id, name,
          status: status ?? 'todo',
          plan_id: plan_id ?? null,
          priority: priority ?? null,
          outcome_md: outcome_md ?? null,
          context_md: context_md ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_update_sprint',
    description: 'Update metadata fields on a KnowSprint vertex (partial update — only supplied fields written). ' +
      'Covers name, outcome_md, context_md, plan_id, effort_days. ' +
      'Does NOT change status — use lore_set_status for that. ' +
      'Does NOT change priority — priority lives on the SCD2-tracked KnowSprintHist row, not this ' +
      'vertex-only endpoint; there is currently no MCP tool wired to it (backend: POST /lore/sprint/plan). ' +
      'RULE: always fill context_md when you know WHY the sprint exists, key decisions, or related sprints.',
    schema: {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      name:        z.string().optional(),
      outcome_md:  z.string().optional().describe('sprint outcome / retrospective in Markdown'),
      context_md:  z.string().optional().describe('background context — WHY the sprint exists, key decisions, links to ADRs/docs, related sprints. Fill whenever you have this information.'),
      plan_id:     z.string().optional(),
      effort_days: z.number().optional().describe('actual effort in person-days, fractional to the hour (1 day = 8h, e.g. 0.125)'),
    },
    path: '/lore/sprint/update',
    body: ({ sprint_id, name, outcome_md, context_md, plan_id, effort_days }) => ({
          sprint_id,
          name: name ?? null, outcome_md: outcome_md ?? null,
          context_md: context_md ?? null,
          plan_id: plan_id ?? null,
          effort_days: effort_days ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_sprint_project',
    description: 'Link (or unlink) a KnowSprint to a KnowGitProject via BELONGS_TO_PROJECT edge. ' +
      'A sprint can belong to multiple projects (e.g. a cross-repo sprint). ' +
      'Idempotent on add. Use action="remove" to unlink. ' +
      'Known slugs: "NooriUta/AIDA", "NooriUta/seidr-site", "NooriUta/aida-documentation", "NooriUta/AIDA-TestPlayGround".',
    schema: {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      git_project: z.string().describe('project slug, e.g. "NooriUta/AIDA"'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/sprint/project',
    body: ({ sprint_id, git_project, action }) => ({
          sprint_id, git_project, action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_link_sprint_dep',
    description: 'Link (or unlink) two KnowSprint vertices via a DEPENDS_ON edge (from_sprint depends on to_sprint). ' +
      'Idempotent on add. Cycle-guard on server rejects edges that would create a cycle. ' +
      'kind: hard (blocks deployment), soft (coordination), gate (go/no-go), informs (awareness). ' +
      'Use action="remove" to delete the dependency.',
    schema: {
      from_sprint: z.string().describe('the sprint that depends on another, e.g. "SPRINT_FE_REDESIGN"'),
      to_sprint:   z.string().describe('the sprint being depended on, e.g. "SPRINT_INFRA_V3"'),
      kind:        z.enum(['hard', 'soft', 'gate', 'informs']).optional().default('soft'),
      reason:      z.string().optional().describe('brief reason for the dependency'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/sprint/dep',
    body: ({ from_sprint, to_sprint, kind, reason, action }) => ({
          from_sprint, to_sprint,
          kind: kind ?? 'soft',
          reason: reason ?? null,
          action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_link_sprint_component',
    description: 'Link (or unlink) a KnowSprint to a LoreComponent via a BELONGS_TO edge. ' +
      'An explicit link OVERRIDES the fuzzy naming-convention match (sprint_id LIKE %component_key%) ' +
      'in the component_sprints slice and the sprint-detail module badges. ' +
      'Idempotent on add. Use action="remove" to unlink.',
    schema: {
      sprint_id:    z.string().describe('the sprint, e.g. "SPRINT_LORE_WRITE_TOOLS"'),
      component_id: z.string().describe('the component, e.g. "OMILORE", "FORSETI", "FORSETI_MCP"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/sprint/component',
    body: ({ sprint_id, component_id, action }) => ({
          sprint_id, component_id, action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_link_task_component',
    description: 'Tag (or untag) a KnowTask with a LoreComponent via a TAGGED_WITH edge. ' +
      'Many-to-many: a task can be linked to 0..N components. ' +
      'Idempotent on add. Use action="remove" to remove the tag.',
    schema: {
      task_uid:     z.string().describe('the task uid, e.g. "SPRINT_LORE_WRITE_TOOLS/T01"'),
      component_id: z.string().describe('the component, e.g. "OMILORE", "FORSETI"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/task/component',
    body: ({ task_uid, component_id, action }) => ({
          task_uid, component_id, action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_create_milestone',
    description: 'Create a KnowMilestone (upsert by milestone_id) — was previously ONLY reachable via raw HTTP ' +
      'or the UI form, no MCP tool existed. Partial calls are safe: unset label/week/date_display/' +
      'priority are left untouched (LH-44). goal_md is written to the open KnowMilestoneHist row ' +
      '(created on first fill). To attach sprints, use lore_link_sprint_milestone — this tool only ' +
      'creates the milestone itself.',
    schema: {
      milestone_id: z.string().describe('e.g. "M4"'),
      label:        z.string().optional().describe('short display label'),
      week:         z.number().int().optional().describe('plan week number (relative to W0)'),
      date_display: z.string().optional().describe('human-readable date/range, e.g. "Aug W2"'),
      goal_md:      z.string().optional().describe('milestone goal in Markdown — written to the open history row'),
      priority:     z.string().optional().describe('e.g. "high", "critical"'),
    },
    path: '/lore/milestone',
    body: ({ milestone_id, label, week, date_display, goal_md, priority }) => ({
          milestone_id,
          label: label ?? null, week: week ?? null, date_display: date_display ?? null,
          goal_md: goal_md ?? null, priority: priority ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_update_milestone',
    description: 'Amend an EXISTING KnowMilestone — same endpoint as lore_create_milestone, signature tailored ' +
      'for partial updates (mirror of lore_update_adr/lore_update_spec). Omitted fields are left ' +
      'untouched, never wiped — e.g. pass only goal_md to fix the goal text without resending ' +
      'label/week/date_display/priority.',
    schema: {
      milestone_id: z.string().describe('existing milestone to amend, e.g. "M4"'),
      label:        z.string().optional().describe('omit to leave untouched'),
      week:         z.number().int().optional().describe('omit to leave untouched'),
      date_display: z.string().optional().describe('omit to leave untouched'),
      goal_md:      z.string().optional().describe('omit to leave the existing goal text untouched'),
      priority:     z.string().optional().describe('omit to leave untouched'),
    },
    path: '/lore/milestone',
    body: ({ milestone_id, label, week, date_display, goal_md, priority }) => ({
          milestone_id,
          label: label ?? null, week: week ?? null, date_display: date_display ?? null,
          goal_md: goal_md ?? null, priority: priority ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_sprint_milestone',
    description: 'Link (or unlink) a KnowSprint to a KnowMilestone via a TARGETS_MILESTONE edge — ' +
      'the sole way to assign a sprint to a milestone (a separate planned_milestone_id field used to ' +
      'exist alongside this edge; it drifted out of sync on 62+ sprints and was retired). ' +
      'Idempotent on add. Use action="remove" to unlink. Returns {ok, sprint_id, milestone_id, action}.',
    schema: {
      sprint_id:    z.string().describe('sprint id, e.g. "SPRINT_LORE_QG_INTEGRATION"'),
      milestone_id: z.string().describe('milestone id, e.g. "M3"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/milestone/sprint',
    body: ({ sprint_id, milestone_id, action }) => ({
          sprint_id, milestone_id, action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_batch_set_status',
    description: 'Set the same status on multiple LORE entities in one call. ' +
      'Each item goes through the full SCD2 transition (closes old hist row, opens new one). ' +
      'Errors are collected per-item without aborting the rest. ' +
      'Returns {ok, updated, errors[]}.',
    schema: {
      entity_type: z.enum(['sprint', 'task', 'checkpoint', 'phase']),
      ids:         z.array(z.string()).describe('list of entity ids'),
      status:      LORE_STATUS,
    },
    path: '/lore/status/batch',
    body: ({ entity_type, ids, status }) => ({ entity_type, ids, status }),
  });

  definePostTool(server, {
    name: 'lore_create_adr',
    description: 'Create or update a KnowADR (Architecture Decision Record). Idempotent — upserts by adr_id. ' +
      'Default status is PROPOSED. Supports context_md / decision_md / consequences_md sections. ' +
      'depends_on_ids/supersedes_ids/component_ids/tags each REPLACE the full edge set on every call ' +
      '(diff against current, not additive) — omit a param to leave that edge set untouched.',
    schema: {
      adr_id:           z.string().describe('e.g. "ADR-HND-022"'),
      name:             z.string().describe('short title'),
      status:           z.enum(['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED']).optional(),
      date_created:     z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      component_id:     z.string().optional().describe('e.g. "HND" for Hound — single legacy field, ignored if component_ids is set'),
      component_ids:    z.array(z.string()).optional().describe('multiple components, e.g. ["HND", "SHT"] — wins over component_id'),
      context_md:       z.string().optional(),
      decision_md:      z.string().optional(),
      consequences_md:  z.string().optional(),
      depends_on_ids:   z.array(z.string()).optional().describe('other adr_id this ADR depends on — creates DEPENDS_ON edges, replaces the full set'),
      supersedes_ids:   z.array(z.string()).optional().describe('adr_id(s) this ADR supersedes — creates SUPERSEDES edges FROM this adr TO each listed one, replaces the full set. Pair with status="SUPERSEDED" on the OLD adr_id (separate lore_create_adr call) to mark it retired.'),
      tags:             z.array(z.string()).optional().describe('free-text tags — upserts KnowTag + TAGGED_WITH edges, replaces the full set'),
      file_path:        z.string().optional().describe('source .md path relative to docs root, e.g. "engine/specs/adr/ADR-HND-022.md"'),
    },
    path: '/lore/adr',
    body: ({ adr_id, name, status, date_created, component_id, component_ids, context_md, decision_md, consequences_md, depends_on_ids, supersedes_ids, tags, file_path }) => ({
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, component_ids: component_ids ?? null,
          context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
          depends_on_ids: depends_on_ids ?? null, supersedes_ids: supersedes_ids ?? null,
          tags: tags ?? null, file_path: file_path ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_update_adr',
    description: 'Amend an EXISTING KnowADR — thin wrapper over the same endpoint as lore_create_adr, ' +
      'tailored for partial updates. name is still required (backend always writes it), everything ' +
      'else is safe to omit: unset context_md/decision_md/consequences_md/date_created/component_id/status ' +
      'are left UNTOUCHED (never wiped or reset to today). Use this to amend a single ADR section — ' +
      'e.g. only decision_md to fix a typo, or only status to mark SUPERSEDED — without resending the ' +
      'whole body. depends_on_ids/supersedes_ids/component_ids/tags still REPLACE the full edge set when passed.',
    schema: {
      adr_id:           z.string().describe('existing ADR to amend, e.g. "ADR-HND-022"'),
      name:             z.string().describe('current/updated title — required by the backend on every write'),
      status:           z.enum(['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED']).optional(),
      date_created:     z.string().optional().describe('YYYY-MM-DD — omit to leave the existing date untouched'),
      component_id:     z.string().optional().describe('single legacy field — omit to leave untouched, ignored if component_ids is set'),
      component_ids:    z.array(z.string()).optional().describe('multiple components — replaces the full set, omit to leave untouched'),
      context_md:       z.string().optional().describe('omit to leave the existing section untouched'),
      decision_md:      z.string().optional().describe('omit to leave the existing section untouched'),
      consequences_md:  z.string().optional().describe('omit to leave the existing section untouched'),
      depends_on_ids:   z.array(z.string()).optional().describe('replaces the full DEPENDS_ON edge set, omit to leave untouched'),
      supersedes_ids:   z.array(z.string()).optional().describe('replaces the full SUPERSEDES edge set, omit to leave untouched. Pair with status="SUPERSEDED" on the OLD adr_id (separate call) to mark it retired.'),
      tags:             z.array(z.string()).optional().describe('replaces the full tag set, omit to leave untouched'),
      file_path:        z.string().optional().describe('source .md path relative to docs root — omit to leave untouched'),
    },
    path: '/lore/adr',
    body: ({ adr_id, name, status, date_created, component_id, component_ids, context_md, decision_md, consequences_md, depends_on_ids, supersedes_ids, tags, file_path }) => ({
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, component_ids: component_ids ?? null,
          context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
          depends_on_ids: depends_on_ids ?? null, supersedes_ids: supersedes_ids ?? null,
          tags: tags ?? null, file_path: file_path ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_adr_sprint',
    description: 'Link (or unlink) a KnowADR to the KnowSprint that implements it via an IMPLEMENTED_IN edge. ' +
      'Feeds the adr slice implemented_in_ids field. Idempotent on add. Use action="remove" to unlink.',
    schema: {
      adr_id:    z.string().describe('e.g. "ADR-HND-022"'),
      sprint_id: z.string().describe('implementing sprint, e.g. "SPRINT_GEOID_STRUCTURAL_ID"'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/adr/link',
    body: ({ adr_id, sprint_id, action }) => ({ adr_id, sprint_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_runbook_adr',
    description: 'Link (or unlink) a KnowRunbook to the KnowADR it references via a REFERENCES_ADR edge (feeds the ' +
      '"runbooks"/"runbook_by_id" slices\' adr_ids field). A runbook mentioning an ADR only as a text-only ' +
      '[[ADR-ID]] wiki link inside content_md has NO real graph edge — this creates one. Idempotent on add. ' +
      'Use action="remove" to unlink.',
    schema: {
      runbook_id: z.string().describe('e.g. "RUNBOOK-INFISICAL-LOCAL-SETUP"'),
      adr_id:     z.string().describe('e.g. "ADR-MT-011"'),
      action:     z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/runbook/adr',
    body: ({ runbook_id, adr_id, action }) => ({ runbook_id, adr_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_adr_release',
    description: 'Link (or unlink) a KnowADR to the KnowRelease it shipped in via an IMPLEMENTED_IN_RELEASE edge. ' +
      'Feeds the adr slice release_ids field. Pass git_project for multi-repo safety ' +
      '(matches release_uid = "{git_project}#{release_id}"; without it matches bare release_id). ' +
      'Idempotent on add. Use action="remove" to unlink.',
    schema: {
      adr_id:      z.string().describe('e.g. "ADR-HND-022"'),
      release_id:  z.string().describe('e.g. "v1.0.24"'),
      git_project: z.string().optional().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/adr/link',
    body: ({ adr_id, release_id, git_project, action }) => ({
          adr_id, release_id, git_project: git_project ?? null, action: action ?? 'add',
        }),
  });

  definePostTool(server, {
    name: 'lore_link_adr_component',
    description: 'Link (or unlink) a KnowADR to a LoreComponent via a BELONGS_TO edge, one at a time. ' +
      'For adding/removing a single component without touching the rest — lore_create_adr\'s ' +
      'component_ids is full-replace (deletes and recreates the whole set), which is risky for ' +
      'incremental edits. Idempotent on add. Use action="remove" to unlink.',
    schema: {
      adr_id:       z.string().describe('e.g. "ADR-HND-022"'),
      component_id: z.string().describe('e.g. "HOUND"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/adr/component',
    body: ({ adr_id, component_id, action }) => ({ adr_id, component_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_adr_depends_on',
    description: 'Link (or unlink) a KnowADR→KnowADR DEPENDS_ON edge, one at a time. For adding/removing a single ' +
      'dependency without touching the rest — lore_create_adr\'s depends_on_ids is full-replace. ' +
      'Idempotent on add. Use action="remove" to unlink.',
    schema: {
      adr_id:     z.string().describe('the dependent ADR, e.g. "ADR-HND-022"'),
      dep_adr_id: z.string().describe('the ADR it depends on, e.g. "ADR-HND-GEOID-IDENTITY"'),
      action:     z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/adr/depends_on',
    body: ({ adr_id, dep_adr_id, action }) => ({ adr_id, dep_adr_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_adr_supersedes',
    description: 'Link (or unlink) a KnowADR→KnowADR SUPERSEDES edge, one at a time. For adding/removing a single ' +
      'supersession without touching the rest — lore_create_adr\'s supersedes_ids is full-replace. ' +
      'Idempotent on add. Use action="remove" to unlink.',
    schema: {
      adr_id:            z.string().describe('the newer ADR, e.g. "ADR-HND-GEOID-IDENTITY"'),
      superseded_adr_id: z.string().describe('the older ADR it supersedes, e.g. "ADR-HND-GEOID-V1"'),
      action:            z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/adr/supersedes',
    body: ({ adr_id, superseded_adr_id, action }) => ({ adr_id, superseded_adr_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_adr_tag',
    description: 'Link (or unlink) a KnowADR to a freeform tag via a TAGGED_WITH edge, one at a time (upserts the ' +
      'KnowTag vertex if it does not exist yet). For adding/removing a single tag without touching the ' +
      'rest — lore_create_adr\'s tags is full-replace. Idempotent on add. Use action="remove" to unlink.',
    schema: {
      adr_id: z.string().describe('e.g. "ADR-HND-022"'),
      tag_id: z.string().describe('e.g. "scd2"'),
      action: z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/adr/tag',
    body: ({ adr_id, tag_id, action }) => ({ adr_id, tag_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_rename_adr',
    description: 'Rename an existing KnowADR to a new adr_id IN PLACE — all edges (DEPENDS_ON/SUPERSEDES/' +
      'BELONGS_TO/TAGGED_WITH/IMPLEMENTED_IN*/HAS_STATE) hang off the vertex and survive untouched; ' +
      'no orphan, no tombstone. Fails if new_adr_id already exists. ' +
      'Remember callers referencing the old id by string (docs, .md files) are NOT updated.',
    schema: {
      adr_id:     z.string().describe('current id, e.g. "ADR-HND-022"'),
      new_adr_id: z.string().describe('new id, e.g. "ADR-HND-SCD2-MIGRATIONS"'),
    },
    path: '/lore/adr/rename',
    body: ({ adr_id, new_adr_id }) => ({ adr_id, new_adr_id }),
  });

  definePostTool(server, {
    name: 'lore_delete_adr',
    description: 'PERMANENTLY delete a KnowADR: cascades edges first (ArcadeDB cannot DELETE VERTEX with edges), ' +
      'then its KnowADRHist rows, then the vertex. Irreversible — prefer status="DEPRECATED"/' +
      '"SUPERSEDED" via lore_update_adr for anything that was ever real; delete is for test ' +
      'artifacts and mistaken creations only.',
    schema: { adr_id: z.string() },
    path: '/lore/adr/delete',
    body: ({ adr_id }) => ({ adr_id }),
  });

  definePostTool(server, {
    name: 'lore_create_decision',
    description: 'Create or update a KnowDecision (logged decision/verdict). Idempotent — upserts by decision_id. ' +
      'Use for recording key decisions made during a sprint or design session.',
    schema: {
      decision_id:  z.string().describe('unique id, e.g. "D-2026-047"'),
      title:        z.string(),
      body_md:      z.string().optional().describe('full decision text in Markdown'),
      date_created: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      refs_raw:     z.string().optional().describe('free-text references, e.g. "#420, ADR-HND-021"'),
    },
    path: '/lore/decision',
    body: ({ decision_id, title, body_md, date_created, refs_raw }) => ({
          decision_id, title,
          body_md: body_md ?? null, date_created: date_created ?? null,
          refs_raw: refs_raw ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_update_sprint_refs',
    description: 'Append PR numbers to a sprint\'s pr_refs field (stored on the open KnowSprintHist row ' +
      'as a markdown link string). Skips PRs already present. Pass replace=true to discard the ' +
      'existing pr_refs first instead of appending — use this to fix entries baked with the wrong ' +
      'git_project/repo_url (there is no per-entry edit otherwise). ' +
      'Returns the updated pr_refs string and count of newly added links.',
    schema: {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      pr_numbers:  z.array(z.number().int()).describe('PR numbers to append, e.g. [420, 421]'),
      git_project: z.string().optional()
        .describe('GitHub project slug, e.g. "NooriUta/aida-documentation" (default: NooriUta/AIDA). Ignored if repo_url is set.'),
      repo_url:    z.string().optional()
        .describe('Full base URL for PR links, e.g. "https://github.com/NooriUta/UnlimitedLORE/pull" — takes precedence over git_project.'),
      replace:     z.boolean().optional().describe('Discard existing pr_refs before adding these, instead of appending.'),
    },
    path: '/lore/sprint/refs',
    body: ({ sprint_id, pr_numbers, git_project, repo_url, replace }) => ({
          sprint_id, pr_numbers, git_project: git_project ?? null,
          repo_url: repo_url ?? null, replace: replace ?? false,
        }),
  });

  // ── Release management ──────────────────────────────────────────────────

  definePostTool(server, {
    name: 'lore_move_to_project',
    description: 'Correct the git_project on a PR or release that was accidentally assigned to the wrong repo. ' +
      'For PRs: updates git_project, pr_uid, and re-wires the BELONGS_TO_PROJECT edge. ' +
      'For releases: updates git_project field.',
    schema: {
      entity_type: z.enum(['pr', 'release']),
      id: z.string().describe(
        'For PR: pr_uid (e.g. "NooriUta/AIDA#420") or bare pr_number. ' +
        'For release: release_id (e.g. "v1.0.0") or release_uid (e.g. "NooriUta/AIDA#v1.0.0").'
      ),
      git_project: z.string().describe('correct project slug, e.g. "NooriUta/seidr-site"'),
    },
    path: '/lore/project/move',
    body: ({ entity_type, id, git_project }) => ({ entity_type, id, git_project }),
  });

  definePostTool(server, {
    name: 'lore_create_release',
    description: 'Create a new KnowRelease vertex in system_aida_lore. ' +
      'If is_current=true, the previous current release is automatically cleared. ' +
      'Returns the created release_id and timestamp.',
    schema: {
      release_id:     z.string().describe('release id, e.g. "v1.6.12"'),
      release_date:   z.string().optional().describe('YYYY-MM-DD; defaults to today'),
      git_tag:        z.string().optional(),
      type:           z.enum(['patch', 'minor', 'major']).optional(),
      description_md: z.string().optional().describe('changelog / release notes in Markdown'),
      is_current:     z.boolean().optional().default(false).describe('mark as current prod release'),
      week:           z.number().int().optional().describe('plan week number (relative to W0)'),
      git_project:    z.string().optional()
        .describe('GitHub project slug (default: NooriUta/AIDA)'),
    },
    path: '/lore/release',
    body: ({ release_id, release_date, git_tag, type, description_md, is_current, week, git_project }) => ({
          release_id, release_date: release_date ?? null,
          git_tag: git_tag ?? null, type: type ?? null,
          description_md: description_md ?? null,
          is_current: is_current ?? false, week: week ?? null,
          git_project: git_project ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_update_release',
    description: 'Update fields on an existing KnowRelease (partial update — only supplied fields are written). ' +
      'If is_current=true, clears the previous current release first. ' +
      'Useful for adding description_md / git_tag after the release is live.',
    schema: {
      release_id:     z.string().describe('existing release id, e.g. "v1.6.11"'),
      git_tag:        z.string().optional(),
      release_date:   z.string().optional().describe('YYYY-MM-DD'),
      description_md: z.string().optional().describe('changelog in Markdown'),
      is_current:     z.boolean().optional().describe('promote to current prod release'),
      git_project:    z.string().optional()
        .describe('GitHub project slug, e.g. "NooriUta/aida-documentation" (default: NooriUta/AIDA)'),
    },
    path: '/lore/release/update',
    body: ({ release_id, git_tag, release_date, description_md, is_current, git_project }) => ({
          release_id,
          git_tag: git_tag ?? null,
          release_date: release_date ?? null,
          description_md: description_md ?? null,
          is_current: is_current ?? null,
          git_project: git_project ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_release',
    description: 'Attach one or more SPRINTS to a release. ' +
      'Creates IMPLEMENTED_IN_RELEASE edges (KnowSprint → KnowRelease). ' +
      'Use when a sprint is done and shipped in a specific release. ' +
      'For linking PRs to a release use lore_link_release_pr instead.\n\n' +
      'MULTI-REPO: always pass git_project — release_uid = "{git_project}#{release_id}".',
    schema: {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      sprint_ids:  z.array(z.string()).describe('sprint ids to attach, e.g. ["SPRINT_HOUND_ROWSET_V2"]'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
    },
    path: '/lore/release/link',
    body: ({ release_id, sprint_ids, git_project }) => ({
          release_id, sprint_ids, pr_numbers: [], git_project,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_release_pr',
    description: 'Attach one or more PULL REQUESTS to a release. ' +
      'Upserts KnowPR vertices and creates SHIPPED_IN edges (KnowPR → KnowRelease). ' +
      'Use when you know which PRs were merged into a release. ' +
      'For linking sprints to a release use lore_link_release instead.\n\n' +
      'MULTI-REPO: always pass git_project — release_uid = "{git_project}#{release_id}".',
    schema: {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      pr_numbers:  z.array(z.number().int()).describe('PR numbers to attach, e.g. [401, 402]'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
    },
    path: '/lore/release/link',
    body: ({ release_id, pr_numbers, git_project }) => ({
          release_id, sprint_ids: [], pr_numbers, git_project,
        }),
  });

  definePostTool(server, {
    name: 'lore_unlink_release',
    description: 'Remove IMPLEMENTED_IN_RELEASE (sprint→release) or SHIPPED_IN (PR→release) edges. ' +
      'Use to correct accidental double-links.',
    schema: {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
      sprint_ids:  z.array(z.string()).optional().describe('sprint ids to unlink'),
      pr_numbers:  z.array(z.number().int()).optional().describe('PR numbers to unlink'),
    },
    path: '/lore/release/unlink',
    body: ({ release_id, git_project, sprint_ids, pr_numbers }) => ({
          release_id, git_project,
          sprint_ids: sprint_ids ?? [],
          pr_numbers: pr_numbers ?? [],
        }),
  });

  server.tool(
    'lore_create_spec',
    'Create or update a specification document (KnowSpec + SCD2 hist). Idempotent — upserts by ' +
      'spec_id. Body fields (content_md/version/summary) are written to the OPEN KnowSpecHist row ' +
      '(created when missing) — the row spec_by_id actually reads. Partial calls are SAFE: omitted ' +
      'fields are left untouched, never wiped. Mutates system_aida_lore.',
    {
      spec_id:      z.string().describe('unique spec id, e.g. "SPEC-AUTH-001"'),
      title:        z.string(),
      version:      z.string().optional().describe('e.g. "1.0.0"'),
      component_id: z.string().optional().describe('e.g. "AUTH"'),
      content_md:   z.string().optional().describe('spec body in Markdown'),
      summary:      z.string().optional().describe('short abstract shown in lists'),
      file_path:    z.string().optional().describe('source file path relative to docs root'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/spec', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_update_spec',
    'Amend an EXISTING KnowSpec — same endpoint as lore_create_spec, signature tailored for ' +
      'partial updates (mirror of lore_update_adr). title required by the backend on every write; ' +
      'everything else safe to omit — unset content_md/version/summary/component_id/file_path are ' +
      'left UNTOUCHED. Body fields land on the OPEN KnowSpecHist row (the one spec_by_id reads), ' +
      'not just the vertex. Use for version bumps and body amends without resending the whole spec.',
    {
      spec_id:      z.string().describe('existing spec to amend, e.g. "HOUND_GEOID_SPEC"'),
      title:        z.string().describe('current/updated title — required by the backend on every write'),
      version:      z.string().optional().describe('omit to leave untouched'),
      component_id: z.string().optional().describe('omit to leave untouched'),
      content_md:   z.string().optional().describe('omit to leave the existing body untouched'),
      summary:      z.string().optional().describe('omit to leave untouched'),
      file_path:    z.string().optional().describe('omit to leave untouched'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/spec', p)); }
      catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'lore_delete_spec',
    description: 'Permanently delete a KnowSpec vertex by spec_id. Mutates system_aida_lore.',
    schema: { spec_id: z.string() },
    path: '/lore/spec/delete',
    body: ({ spec_id }) => ({ spec_id }),
  });

  server.tool(
    'lore_upsert_tech',
    '(SPRINT_TECH_REGISTRY) Register or update one technology entry (version + release date + ' +
      'license + source + our own release + usage) for a component — e.g. "ArcadeDB 26.6.1" under YGG. ' +
      'Prevents re-verifying facts already checked this session (the recurring pain this sprint exists ' +
      'for). Stored as one KnowSpec per (component, tech) via the existing spec-upsert path — spec_id ' +
      '"SPEC-TECH-<COMPONENT>-<TECH>", title=tech_name, version=tech version, content_md=a small ' +
      'bullet list of release_date/our_release/license/usage/source_url/checked_at. Idempotent — ' +
      'upserts by that id. Read back via lore_query_slice(slice="tech_registry", params={component: ' +
      '"<ID>"}) (component optional — omit for the full registry). Mutates system_aida_lore.',
    {
      component_id: z.string().describe('e.g. "YGG", "SECURITY"'),
      tech_name:    z.string().describe('e.g. "ArcadeDB", "Vault", "Keycloak"'),
      version:      z.string().describe('e.g. "26.6.1"'),
      release_date: z.string().optional().describe('YYYY-MM-DD, when this version was released UPSTREAM (the tech\'s own release)'),
      our_release:  z.string().optional().describe('which of OUR releases pinned/shipped this version, e.g. "v1.6.21"'),
      license:      z.string().optional().describe('e.g. "Business Source License 1.1"'),
      usage:        z.string().optional().describe('free text — how/where this is actually used'),
      source_url:   z.string().optional().describe('where this was verified (LICENSE file, release notes, ...)'),
      checked_at:   z.string().optional().describe('YYYY-MM-DD this was last verified; defaults to today if omitted'),
    },
    async ({ component_id, tech_name, version, release_date, our_release, license, usage, source_url, checked_at }) => {
      try {
        const specId = `SPEC-TECH-${component_id.toUpperCase()}-${tech_name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
        const today = new Date().toISOString().slice(0, 10);
        const lines = [
          release_date && `- **Дата релиза:** ${release_date}`,
          our_release && `- **Наш релиз:** ${our_release}`,
          license && `- **Лицензия:** ${license}`,
          usage && `- **Использование:** ${usage}`,
          source_url && `- **Источник:** ${source_url}`,
          `- **Проверено:** ${checked_at ?? today}`,
        ].filter(Boolean);
        return json(await lorePost('/lore/spec', {
          spec_id: specId, title: tech_name, version, component_id,
          content_md: lines.join('\n'),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_quality_gate',
    'Create or update a QualityGate vertex. ' +
      'Idempotent — upserts by qg_id. Mutates system_aida_lore.',
    {
      qg_id:        z.string().describe('e.g. "QG-HOUND-listener-chain"'),
      name:         z.string(),
      description:  z.string().optional(),
      component_id: z.string().optional(),
      status:       z.string().optional().describe('e.g. "active", "draft", "deprecated"'),
      content_md:   z.string().optional().describe('gate body in Markdown'),
      sprint_id:    z.string().optional().describe('sprint this QG belongs to, e.g. "SPRINT_AUTH_REDESIGN"'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/quality-gate', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_runbook',
    'Create or update a KnowRunbook vertex. ' +
      'Idempotent — upserts by runbook_id. Mutates system_aida_lore.',
    {
      runbook_id:   z.string().describe('e.g. "RUNBOOK-ARCADEDB-BACKUP"'),
      name:         z.string(),
      area:         z.string().optional().describe('e.g. "recovery", "infra", "deploy", "ops", "auth", "db", "service"'),
      date_created: z.string().optional().describe('ISO date YYYY-MM-DD; defaults to today'),
      content_md:   z.string().optional().describe('runbook body in Markdown'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/runbook', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'lore_create_doc',
    'Create or update a KnowDoc vertex (documentation page or fragment). ' +
      'Idempotent — upserts by doc_id (only provided fields are set; omitted fields keep their ' +
      'existing value). Mutates system_aida_lore. ' +
      'Prefer content_md_en/content_md_ru (clean Markdown, rendered in-DOM with mermaid support) ' +
      'over content_html, which is a legacy field kept for pre-existing HTML-fragment docs.',
    {
      doc_id:         z.string().describe('unique id, e.g. "engine_specs_auth" (/ → _)'),
      title:          z.string().optional().describe('required on first creation; omit on a content-only update to leave the existing title unchanged'),
      kind:           z.string().optional().describe('e.g. "page", "fragment", "guide", "reference", "research", "product", "site", "prompt"'),
      has_ext_deps:   z.boolean().optional().describe('true when content_html references external CDN'),
      component_id:   z.string().optional(),
      file_path:      z.string().optional(),
      content_md_en:  z.string().optional().describe('English Markdown body (preferred over content_html)'),
      content_md_ru:  z.string().optional().describe('Russian Markdown body (preferred over content_html)'),
      content_html:   z.string().optional().describe('Legacy: HTML content (100 KB max), rendered sandboxed'),
      parent_doc_id:  z.string().optional().describe(
        'DeepWiki-style page tree: set this doc\'s parent page in the same call (replaces any existing ' +
        'parent — a doc has at most one). Pass "" (empty string) to detach/move to top level; omit to ' +
        'leave the current parent untouched. For reparenting without touching content, use lore_link_doc_parent instead.'),
      sort_order: z.number().int().optional().describe(
        'Position among sibling pages under the same parent (used for tree ordering and prev/next navigation).'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/doc', p)); }
      catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'lore_link_doc_parent',
    description: 'Set (or clear) a KnowDoc\'s parent page via a DOC_CHILD_OF edge, for building a DeepWiki-style page ' +
      'tree. A doc has at most one parent — action="add" always replaces any existing parent edge first ' +
      '(so moving a page to a different parent is one call). Use action="remove" to detach (move to top ' +
      'level). Idempotent on add.',
    schema: {
      doc_id:        z.string().describe('the child page, e.g. "deepwiki_1_1"'),
      parent_doc_id: z.string().optional().describe('the parent page, e.g. "deepwiki_1" — required unless action="remove"'),
      action:        z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/doc/parent',
    body: ({ doc_id, parent_doc_id, action }) => ({ doc_id, parent_doc_id: parent_doc_id ?? null, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_doc_component',
    description: 'Link (or unlink) a KnowDoc to a LoreComponent via a BELONGS_TO edge, same pattern as ' +
      'lore_link_adr_component. Idempotent on add. Use action="remove" to unlink.',
    schema: {
      doc_id:       z.string().describe('e.g. "guide_onboarding"'),
      component_id: z.string().describe('e.g. "HOUND"'),
      action:       z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/doc/component',
    body: ({ doc_id, component_id, action }) => ({ doc_id, component_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_link_doc_sprint',
    description: 'Link (or unlink) a KnowDoc to a KnowSprint via an IMPLEMENTED_IN edge, same pattern as ' +
      'lore_link_adr\'s sprint branch. Idempotent on add. Use action="remove" to unlink.',
    schema: {
      doc_id:    z.string().describe('e.g. "guide_onboarding"'),
      sprint_id: z.string().describe('e.g. "SPRINT_LORE_KNOWDOC_TREE"'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/doc/sprint',
    body: ({ doc_id, sprint_id, action }) => ({ doc_id, sprint_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'lore_delete_doc',
    description: 'PERMANENTLY delete a KnowDoc: cascades edges first (ArcadeDB cannot DELETE VERTEX with edges), ' +
      'then any KnowDocHist rows, then the vertex. Irreversible — for stale duplicates and empty ' +
      'placeholder docs only (e.g. legacy DOC-* entries superseded by a newer guide_*/product_*/ref_* ' +
      'doc with real content). Check content_html/content_md_en/content_md_ru are actually empty ' +
      '(via the doc_by_id slice) before deleting anything that might have real content.',
    schema: { doc_id: z.string() },
    path: '/lore/doc/delete',
    body: ({ doc_id }) => ({ doc_id }),
  });

  server.tool(
    'lore_edit_task',
    'Edit one task OR a batch of tasks (title, note_md, effort_days). Updates the vertex and its ' +
      'open history row. Mutates the shared system_aida_lore.\n\n' +
      'Single: pass task_uid + title (+ optional note_md, effort_days).\n' +
      'Batch:  pass tasks=[{task_uid, title, note_md?, effort_days?}, ...] — all processed in one call, ' +
      'errors collected per-item without aborting the rest.',
    {
      task_uid:    z.string().optional().describe('single-mode: full task uid, e.g. "SPRINT_X/SH-1"'),
      title:       z.string().optional().describe('single-mode: new title'),
      note_md:     z.string().optional().describe('single-mode: Markdown note (replaces existing)'),
      effort_days: z.number().optional().describe('single-mode: estimated effort in person-days, fractional to the hour (1 day = 8h, e.g. 0.125)'),
      tasks: z.array(z.object({
        task_uid:    z.string(),
        title:       z.string(),
        note_md:     z.string().optional(),
        effort_days: z.number().optional(),
      })).optional().describe('batch-mode: array of {task_uid, title, note_md?, effort_days?}'),
    },
    async ({ task_uid, title, note_md, effort_days, tasks }) => {
      try {
        if (tasks && tasks.length > 0) {
          return json(await lorePost('/lore/task/edit/batch',
            tasks.map(t => ({ task_uid: t.task_uid, title: t.title, note_md: t.note_md ?? null, effort_days: t.effort_days ?? null }))));
        }
        if (!task_uid || !title) return err(new Error('provide either tasks[] (batch) or task_uid+title (single)'));
        return json(await lorePost('/lore/task/edit', { task_uid, title, note_md: note_md ?? null, effort_days: effort_days ?? null }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'lore_create_component',
    description: 'Create a new LoreComponent vertex (upsert by component_id). ' +
      'Use for brand-new components not yet in the knowledge graph. ' +
      'Mutates the shared system_aida_lore.',
    schema: {
      component_id: z.string().describe('SHORT uppercase ID, e.g. OMILORE, MIMIR'),
      full_name:    z.string().optional().describe('Human-readable full name'),
      area:         z.string().optional().describe('Team area, e.g. platform, engine, frontend'),
      team:         z.string().optional().describe('Team slug'),
      game_icon:    z.string().optional().describe('game-icons.net slug, e.g. spell-book'),
      owner:        z.string().optional().describe('Owner login'),
      parent_id:    z.string().optional().describe('Parent component_id if this is a sub-component'),
    },
    path: '/lore/component/create',
    body: ({ component_id, full_name, area, team, game_icon, owner, parent_id }) => ({
          component_id, full_name, area, team, game_icon, owner, parent_id,
        }),
  });

  definePostTool(server, {
    name: 'lore_create_qg_job_task',
    description: 'Upsert a QGJobTask vertex and wire a YIELDED edge from the parent QualityGate. ' +
      'Call after running a QG slice when an invariant FAILS. ' +
      'severity: "blocker" | "major" | "minor". status: "open" (new failure) | "resolved" (pass after open). ' +
      'Sets status="resolved" on previously open tasks for the same qg_id+inv_id when a PASS is recorded.',
    schema: {
      job_id:   z.string().describe('unique run id, e.g. "QG-LINEAGE_INV-1_2026-06-30"'),
      qg_id:    z.string().describe('parent QualityGate id, e.g. "QG-LINEAGE"'),
      inv_id:   z.string().optional().describe('invariant id, e.g. "INV-1"'),
      run_date: z.string().optional().describe('YYYY-MM-DD; defaults to today'),
      severity: z.enum(['blocker', 'major', 'minor']).optional().default('major'),
      status:   z.enum(['open', 'resolved']).optional().default('open'),
      note_md:  z.string().optional().describe('failure details / evidence in Markdown'),
    },
    path: '/lore/qg/job-task',
    body: ({ job_id, qg_id, inv_id, run_date, severity, status, note_md }) => ({
          job_id, qg_id, inv_id: inv_id ?? null,
          run_date: run_date ?? new Date().toISOString().slice(0, 10),
          severity: severity ?? 'major', status: status ?? 'open',
          note_md: note_md ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_create_recommendation',
    description: 'Upsert a QGRecommendation vertex and wire a PRODUCED edge from the parent QGJobTask. ' +
      'Call after lore_create_qg_job_task when you want to suggest a remediation action. ' +
      'Status starts as "pending" until the user confirms via lore_promote_recommendation. ' +
      'Always fill priority, severity, effort_days, fix_cmd and how_to_verify — sparse recs are useless.',
    schema: {
      rec_id:        z.string().describe('unique id, e.g. "REC-QG-SECURITY-INV9-2026-06-30"'),
      job_id:        z.string().describe('parent QGJobTask job_id'),
      title:         z.string().describe('short action title — include QG id and INV id'),
      body_md:       z.string().optional().describe('## Проблема / ## Что сделать / ## Как проверить / ## Риск'),
      status:        z.enum(['pending', 'dismissed', 'promoted']).optional().default('pending'),
      priority:      z.enum(['P0', 'P1', 'P2']).optional().describe('P0=blocking, P1=this sprint, P2=backlog'),
      severity:      z.enum(['critical', 'high', 'medium', 'low']).optional(),
      effort_days:   z.number().optional().describe('estimated fix effort in days, e.g. 0.25'),
      tags:          z.string().optional().describe('comma-separated, e.g. "security,credentials"'),
      component_id:  z.string().optional().describe('LoreComponent component_id that owns the fix'),
      qg_id:         z.string().optional().describe('source QualityGate qg_id'),
      inv_id:        z.string().optional().describe('failed invariant id, e.g. "INV-9"'),
      fix_cmd:       z.string().optional().describe('one-liner bash command to apply the fix'),
      how_to_verify: z.string().optional().describe('bash command or check to confirm fix is done'),
    },
    path: '/lore/qg/recommendation',
    body: ({ rec_id, job_id, title, body_md, status, priority, severity, effort_days,
             tags, component_id, qg_id, inv_id, fix_cmd, how_to_verify }) => ({
          rec_id, job_id, title,
          body_md:       body_md       ?? null,
          status:        status        ?? 'pending',
          priority:      priority      ?? null,
          severity:      severity      ?? null,
          effort_days:   effort_days   ?? null,
          tags:          tags          ?? null,
          component_id:  component_id  ?? null,
          qg_id:         qg_id         ?? null,
          inv_id:        inv_id        ?? null,
          fix_cmd:       fix_cmd       ?? null,
          how_to_verify: how_to_verify ?? null,
        }),
  });

  server.tool(
    'lore_record_qg_run',
    'Record a completed QG routine run with metrics into LORE (ClRoutineRun + ClRoutineMetric). ' +
      'Call once at the end of each QG routine run. routine_name must match the QG slug pattern ' +
      '(e.g. "qg-auth", "qg-security-demo", "qg-lineage"). ' +
      'metrics[] is the list of measured values — include all key indicators so the Analytics QG tab can display them. ' +
      'Common metric keys: coverage_pct, build_result (1/0), slo_p95_ms, violations_count, tests_passed, tests_failed, arch_enforced_pct.',
    {
      routine_name: z.string().describe('QG routine slug, e.g. "qg-auth"'),
      run_date:     z.string().describe('ISO date YYYY-MM-DD'),
      status:       z.enum(['OK', 'WARN', 'FAIL', 'PARTIAL']).describe('Overall run result'),
      started_at:   z.string().optional().describe('ISO datetime when run started'),
      finished_at:  z.string().optional().describe('ISO datetime when run finished'),
      flags:        z.string().optional().describe('Comma-separated flag strings, e.g. "coverage_low,shuttle_down"'),
      run_id:       z.string().optional().describe('Explicit run ID; auto-generated as routine_name+run_date if omitted'),
      metrics: z.array(z.object({
        key:    z.string().describe('Metric key, e.g. "inv_2_safecall_count" (one per invariant)'),
        value:  z.number().describe('Numeric value (grep count / HTTP status / ms / ratio; -1 = SKIP/service down)'),
        unit:   z.string().optional().describe('Unit: "count" | "ratio" | "ms" | "bool" | "lines" | "pct"'),
        target: z.number().optional().describe('Target/threshold value'),
        status: z.enum(['PASS', 'WARN', 'FAIL', 'SKIP']).optional().describe('Per-metric status vs target'),
        source: z.string().optional().describe('Exact reproducer command + file:line evidence, e.g. "grep -n safeCall CompositeListener.java → lines 47,89 (=5, want 8)". Drives _qg_recommend.'),
      })).optional().describe('List of measured metrics for this run — one per invariant, with evidence in source'),
    },
    async ({ routine_name, run_date, status, started_at, finished_at, flags, run_id, metrics }) => {
      return json(await lorePost('/lore/qg/run', {
        routine_name, run_date, status,
        started_at:  started_at  ?? null,
        finished_at: finished_at ?? null,
        flags:       flags       ?? null,
        run_id:      run_id      ?? null,
        metrics:     metrics     ?? [],
      }));
    },
  );

  definePostTool(server, {
    name: 'lore_promote_recommendation',
    description: 'Confirm a QGRecommendation and promote it to a KnowTask. Default target is a rotating ' +
      'weekly housekeeping sprint derived from the ISO calendar week — "SPRINT_QG_HOUSEKEEPING_' +
      '<year>W<week>" (e.g. SPRINT_QG_HOUSEKEEPING_2026W27) — auto-created (active, on the Plan ' +
      'board) the first time it is used that week, so tasks don\'t pile up forever in one bucket. ' +
      'Pass sprint_id to override. Creates PROMOTED_TO edge (QGRecommendation → KnowTask) and ' +
      'marks rec as "promoted". Backend auto-assigns task_id (T01, T02…), reads body_md/priority/' +
      'severity/fix_cmd/how_to_verify/component_id from the recommendation and builds a rich ' +
      'note_md automatically. Omit title/note_md to let the backend enrich from rec fields. ' +
      'Use after the user explicitly says "да" / confirms the recommendation.',
    schema: {
      rec_id:    z.string().describe('QGRecommendation rec_id to promote'),
      sprint_id: z.string().optional().describe('target sprint; omit to use/auto-create this week\'s SPRINT_QG_HOUSEKEEPING_<ISO week>'),
      task_uid:  z.string().optional().describe('KnowTask uid; defaults to "<sprint_id>/T<NN>"'),
      title:     z.string().optional().describe('override task title (default: rec title)'),
      note_md:   z.string().optional().describe('override task description (default: auto-built from rec fields)'),
    },
    path: '/lore/qg/promote',
    body: ({ rec_id, sprint_id, task_uid, title, note_md }) => ({
          rec_id, sprint_id: sprint_id ?? null,
          task_uid: task_uid ?? null, title: title ?? null, note_md: note_md ?? null,
        }),
  });

  definePostTool(server, {
    name: 'lore_update_component',
    description: 'Update metadata fields on an existing LoreComponent vertex (partial update — only supplied fields written). ' +
      'Covers full_name, area, team, game_icon, owner, parent_id. ' +
      'Use to rename, re-assign owner/team, fix icon slug, or reparent a component. ' +
      'Does NOT create a new component — use lore_create_component for that.',
    schema: {
      component_id: z.string().describe('ID of the component to update, e.g. "FORSETI"'),
      full_name:    z.string().optional().describe('Human-readable full name'),
      area:         z.string().optional().describe('Team area, e.g. platform, engine, frontend'),
      team:         z.string().optional().describe('Team slug'),
      game_icon:    z.string().optional().describe('game-icons.net slug, e.g. spell-book'),
      owner:        z.string().optional().describe('Owner login'),
      parent_id:    z.string().optional().describe('Parent component_id if this is a sub-component'),
    },
    path: '/lore/component/update',
    body: ({ component_id, full_name, area, team, game_icon, owner, parent_id }) => ({
          component_id, full_name: full_name ?? null, area: area ?? null,
          team: team ?? null, game_icon: game_icon ?? null,
          owner: owner ?? null, parent_id: parent_id ?? null,
        }),
  });

  // ── BRAGI content archive (SPEC-BRAGI-ARCHIVE-001 v0.4) ──────────────────
  definePostTool(server, {
    name: 'lore_upsert_rubric',
    description: 'BragiRubric: create/amend a rubric — the fixed classifier list assigned to publications ' +
      '(lore_create_publication) and keywords (lore_upsert_keyword) via rubric_id (upsert by rubric_id, ' +
      'partial-safe). This is a single, editorially-curated list, not a freeform tag — check lore_query_slice ' +
      '"bragi_rubrics" before creating a new one to avoid near-duplicate rubrics. Mutates the shared system_aida_lore.',
    schema: {
      rubric_id:    z.string().describe('e.g. "RUB-GOV"'),
      name:         z.string().optional(),
      description:  z.string().optional(),
      order_index:  z.number().int().optional().describe('display order in pickers'),
    },
    path: '/lore/bragi/rubric',
    body: ({ rubric_id, name, description, order_index }) => ({ rubric_id, name, description, order_index }),
  });

  definePostTool(server, {
    name: 'lore_upsert_channel',
    description: 'BragiChannel: create/amend a distribution channel (e.g. CH-TG, CH-SITE) — upsert by channel_id, ' +
      'partial-safe (omitted fields left untouched). Gap found 2026-07-03: there was no write path for ' +
      'this type — CH-TG\'s seeded url_handle ("t.me/seidr") was stale, no tool existed to fix it. ' +
      '`rules_md` (VAL-00, added 2026-07-03) holds the platform\'s structural limits/style rules as free-text ' +
      'markdown — VAL-01\'s validator engine reads it to check drafts before publish (e.g. TG caption/post/poll ' +
      'char limits, VC footer-link policy, Habr code-block rules). Check lore_query_slice "bragi_channels" for ' +
      'existing channels before creating a new one. Mutates the shared system_aida_lore.',
    schema: {
      channel_id:   z.string().describe('e.g. "CH-TG", "CH-SITE"'),
      channel_type: z.string().optional().describe('e.g. "social", "owned", "platform"'),
      url_handle:   z.string().optional().describe('e.g. "t.me/SampleofOne", "seidrstudio.pro/blog"'),
      funnel_role:  z.string().optional().describe('e.g. "nurture", "conversion", "awareness", "authority"'),
      rules_md:     z.string().optional().describe('structural limits/style rules as markdown, e.g. "- caption: 1024\\n- post: 4096\\n- poll_option: 100"'),
    },
    path: '/lore/bragi/channel',
    body: ({ channel_id, channel_type, url_handle, funnel_role, rules_md }) => ({ channel_id, channel_type, url_handle, funnel_role, rules_md }),
  });

  definePostTool(server, {
    name: 'lore_link_rubric',
    description: 'Assigns (or replaces) ONE rubric on a BragiPublication or BragiKeyword via IN_RUBRIC, without re-supplying ' +
      'every other field of the target — unlike the rubric_id param on lore_create_publication/lore_upsert_keyword, ' +
      'this is a lightweight standalone call. Replaces any prior rubric on the target (single-assignment, not ' +
      'additive). Mutates the shared system_aida_lore.',
    schema: {
      entity_type: z.enum(['publication', 'keyword']),
      entity_id:   z.string().describe('publication_id or keyword_id, matching entity_type'),
      rubric_id:   z.string().describe('existing BragiRubric id'),
    },
    path: '/lore/bragi/rubric/link',
    body: ({ entity_type, entity_id, rubric_id }) => ({ entity_type, entity_id, rubric_id }),
  });

  definePostTool(server, {
    name: 'lore_link_bragi_forseti',
    description: 'Link (or unlink) a BragiPublication/BragiVariant into the Forseti work graph — PRODUCED_BY (which ' +
      'task/sprint made it) or SHIPPED_IN (which release carried it). Both edge types existed in the schema ' +
      'with no write path (EDIT-05, 2026-07-03) — publications lived disconnected from work/releases. For ' +
      'SHIPPED_IN, pass git_project for multi-repo release safety (matches release_uid = ' +
      '"{git_project}#{target_id}"; without it matches bare release_id). Idempotent on add. ' +
      'Use action="remove" to unlink. Mutates the shared system_aida_lore.',
    schema: {
      entity_type: z.enum(['publication', 'variant']),
      entity_id:   z.string().describe('publication_id or variant_id, matching entity_type'),
      edge_type:   z.enum(['PRODUCED_BY', 'SHIPPED_IN']),
      target_type: z.enum(['task', 'sprint', 'release']).describe('task|sprint for PRODUCED_BY, release for SHIPPED_IN'),
      target_id:   z.string().describe('task_uid, sprint_id, or release_id/tag matching target_type'),
      git_project: z.string().optional().describe('GitHub project slug for release_uid resolution, e.g. "NooriUta/UnlimitedLORE" (SHIPPED_IN only)'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/bragi/link',
    body: ({ entity_type, entity_id, edge_type, target_type, target_id, git_project, action }) => ({
          entity_type, entity_id, edge_type, target_type, target_id,
          git_project: git_project ?? null, action: action ?? 'add',
        }),
  });

  server.tool(
    'lore_find_keyword',
    'Searches BragiKeyword by a case-insensitive substring of phrase, returning keyword_id/phrase/cluster for ' +
      'matches (max 20). Use this to resolve a keyword_id from a phrase BEFORE calling lore_upsert_keyword, ' +
      'lore_link_rubric, or the keyword_ids param on lore_create_publication — those all require an already-known id.',
    {
      q: z.string().describe('substring to search for, e.g. "data governance"'),
    },
    async ({ q }) => {
      try {
        return json(await loreGet('/lore/bragi/keyword/search', { q }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'lore_create_publication',
    description: 'BragiPublication: create/amend a content publication (upsert by publication_id, partial-safe). ' +
      'The main-text master version that groups per-channel variants (see lore_create_variant). ' +
      'Pass keyword_ids to link TARGETS_KEY edges to existing BragiKeyword rows (idempotent, additive-only — ' +
      'does not unlink keys omitted on a re-call). rubric_id assigns ONE rubric via IN_RUBRIC — replaces any ' +
      'prior rubric on this publication (not additive, unlike keyword_ids). Mutates the shared system_aida_lore.',
    schema: {
      publication_id:  z.string().describe('e.g. "PUB-01"'),
      title:           z.string().optional(),
      topic:           z.string().optional(),
      main_text_md:    z.string().optional().describe('master-version body in Markdown'),
      type:            z.string().optional().describe('e.g. "article"'),
      status_general:  z.string().optional().describe('e.g. "draft" | "ready" | "published"'),
      keyword_ids:     z.array(z.string()).optional().describe('existing BragiKeyword ids to link via TARGETS_KEY'),
      rubric_id:       z.string().optional().describe('existing BragiRubric id — replaces prior rubric via IN_RUBRIC'),
      annotation_md:   z.string().optional().describe('permanent editorial meta (master source, replacement rule, release context) — NEVER rendered into a platform skin, editor-only'),
      todo_md:         z.string().optional().describe('transient markdown checklist, e.g. "- [ ] insert Telegraph URL\\n- [x] done item" — NEVER rendered into a platform skin, editor-only'),
    },
    path: '/lore/bragi/publication',
    body: ({ publication_id, title, topic, main_text_md, type, status_general, keyword_ids, rubric_id, annotation_md, todo_md }) => ({
          publication_id, title, topic, main_text_md, type, status_general, keyword_ids, rubric_id, annotation_md, todo_md,
        }),
  });

  definePostTool(server, {
    name: 'lore_create_variant',
    description: 'BragiVariant: create/amend a per-channel version of a publication (upsert by variant_id, partial-safe). ' +
      'Pass publication_id to wire HAS_VARIANT from the parent BragiPublication, channel_id to wire IN_CHANNEL ' +
      'to an existing BragiChannel, asset_id to attach an existing BragiAsset via HAS_ASSET — all idempotent, ' +
      'edges only added when the corresponding id is supplied. Mutates the shared system_aida_lore.',
    schema: {
      variant_id:     z.string().describe('e.g. "PUB-01-VC"'),
      publication_id: z.string().optional().describe('parent publication — wires HAS_VARIANT'),
      channel_id:     z.string().optional().describe('existing BragiChannel id — wires IN_CHANNEL'),
      text_md:        z.string().optional().describe('this variant\'s adapted text'),
      status:         z.string().optional().describe('e.g. "draft" | "ready" | "published" | "planned"'),
      url:            z.string().optional().describe('published URL, once live'),
      published_at:   z.string().optional().describe('YYYY-MM-DD'),
      asset_id:       z.string().optional().describe('existing BragiAsset id — wires HAS_ASSET'),
      annotation_md:  z.string().optional().describe('permanent editorial meta for this variant specifically — NEVER rendered into a platform skin, editor-only'),
      todo_md:        z.string().optional().describe('transient markdown checklist for this variant, e.g. "- [ ] ..." — NEVER rendered into a platform skin, editor-only'),
    },
    path: '/lore/bragi/variant',
    body: ({ variant_id, publication_id, channel_id, text_md, status, url, published_at, asset_id, annotation_md, todo_md }) => ({
          variant_id, publication_id, channel_id, text_md, status, url, published_at, asset_id, annotation_md, todo_md,
        }),
  });

  server.tool(
    'lore_upload_asset',
    'Uploads a base64-encoded image file to BRAGI\'s S3-backed asset store (MinIO), returning a same-origin ' +
      'file_url ("/lore/bragi/asset/file/..."). This is the ONLY way to get a real, browser-loadable file_url — ' +
      'there is no separate "presign" step. Call this FIRST, then pass its file_url into lore_attach_asset ' +
      'to create the BragiAsset row and wire it to a publication/variant. Does not touch the graph itself.',
    {
      filename:     z.string().describe('original filename, e.g. "cover.png" — extension is preserved'),
      base64_data:  z.string().describe('raw file bytes, base64-encoded (no data: URI prefix)'),
      content_type: z.string().optional().describe('e.g. "image/png" — defaults to application/octet-stream'),
    },
    async ({ filename, base64_data, content_type }) => {
      try {
        return json(await loreUpload('/lore/bragi/asset/upload', filename, base64_data, content_type));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'lore_attach_asset',
    description: 'BragiAsset: create/amend an image/media asset (upsert by asset_id, partial-safe) and optionally attach it ' +
      'via HAS_ASSET to an existing BragiPublication (cover) or BragiVariant (per-channel image) — pass exactly ' +
      'one of attach_to_publication_id/attach_to_variant_id, not both. file_url should come from lore_upload_asset ' +
      'if you have raw image bytes rather than an already-hosted URL. Mutates the shared system_aida_lore.',
    schema: {
      asset_id:                  z.string().describe('e.g. "AST-01"'),
      asset_type:                z.string().optional().describe('"cover" | "og-teaser" | "inline"'),
      file_url:                  z.string().optional(),
      alt:                       z.string().optional(),
      size_bytes:                z.number().int().optional(),
      attach_to_publication_id:  z.string().optional().describe('wires HAS_ASSET from this BragiPublication'),
      attach_to_variant_id:      z.string().optional().describe('wires HAS_ASSET from this BragiVariant'),
    },
    path: '/lore/bragi/asset',
    body: ({ asset_id, asset_type, file_url, alt, size_bytes, attach_to_publication_id, attach_to_variant_id }) => ({
          asset_id, asset_type, file_url, alt, size_bytes, attach_to_publication_id, attach_to_variant_id,
        }),
  });

  definePostTool(server, {
    name: 'lore_upsert_keyword',
    description: 'BragiKeyword: create/amend a semantic-core keyword (upsert by keyword_id, partial-safe). ' +
      'Pass page_id to wire TARGETS_PAGE to an existing BragiPage (idempotent, additive-only). rubric_id assigns ' +
      'ONE rubric via IN_RUBRIC — replaces any prior rubric on this keyword. Mutates the shared system_aida_lore.',
    schema: {
      keyword_id:    z.string().describe('e.g. "KW-01"'),
      phrase:        z.string().optional(),
      cluster:       z.string().optional(),
      freq_exact:    z.number().int().optional().describe('точная частота [!]'),
      freq_broad:    z.number().int().optional(),
      source:        z.string().optional().describe('e.g. "wordstat" | "yandex-serp"'),
      intent:        z.string().optional().describe('e.g. "инфо" | "комм" | "бренд"'),
      region_engine: z.string().optional().describe('region/search-engine, e.g. "yandex-ru"'),
      measured_at:   z.string().optional().describe('YYYY-MM-DD'),
      page_id:       z.string().optional().describe('existing BragiPage id — wires TARGETS_PAGE'),
      rubric_id:     z.string().optional().describe('existing BragiRubric id — replaces prior rubric via IN_RUBRIC'),
    },
    path: '/lore/bragi/keyword',
    body: ({ keyword_id, phrase, cluster, freq_exact, freq_broad, source, intent, region_engine, measured_at, page_id, rubric_id }) => ({
          keyword_id, phrase, cluster, freq_exact, freq_broad, source, intent, region_engine, measured_at, page_id, rubric_id,
        }),
  });

  definePostTool(server, {
    name: 'lore_upsert_page',
    description: 'BragiPage: create/amend a target landing/article page (upsert by page_id, partial-safe). ' +
      'Mutates the shared system_aida_lore.',
    schema: {
      page_id:      z.string().describe('e.g. "PG-LINEAGE"'),
      url:          z.string().optional(),
      title:        z.string().optional(),
      description:  z.string().optional(),
      page_type:    z.string().optional().describe('e.g. "landing" | "article" | "docs"'),
      deployed_at:  z.string().optional().describe('YYYY-MM-DD'),
    },
    path: '/lore/bragi/page',
    body: ({ page_id, url, title, description, page_type, deployed_at }) => ({
          page_id, url, title, description, page_type, deployed_at,
        }),
  });

  definePostTool(server, {
    name: 'lore_create_campaign',
    description: 'BragiCampaign: create/amend a UTM tracking campaign (upsert by campaign_id, partial-safe). ' +
      'Pass variant_id to wire FOR_VARIANT to an existing BragiVariant (idempotent). ' +
      'Mutates the shared system_aida_lore.',
    schema: {
      campaign_id: z.string().describe('e.g. "CMP-01"'),
      utm_source:  z.string().optional(),
      utm_medium:  z.string().optional(),
      utm_campaign: z.string().optional(),
      target_url:  z.string().optional(),
      period:      z.string().optional().describe('freeform date range, e.g. "2026-07"'),
      variant_id:  z.string().optional().describe('existing BragiVariant id — wires FOR_VARIANT'),
    },
    path: '/lore/bragi/campaign',
    body: ({ campaign_id, utm_source, utm_medium, utm_campaign, target_url, period, variant_id }) => ({
          campaign_id, utm_source, utm_medium, utm_campaign, target_url, period, variant_id,
        }),
  });

  definePostTool(server, {
    name: 'lore_record_metric',
    description: 'MetricSnapshot: append one measurement to the BRAGI TIMESERIES store (native ArcadeDB time-series, ' +
      'not a graph vertex — no edges, referenced by object_type+object_id tags). ts accepts ISO-8601 ' +
      '(e.g. "2026-07-02T09:00:00Z") or epoch millis; omit for now(). This is append-only — there is no ' +
      'delete/amend path (TIMESERIES sealed storage). Mutates the shared system_aida_lore.',
    schema: {
      object_type: z.string().describe('e.g. "publication" | "variant" | "keyword" | "competitor" | "channel"'),
      object_id:   z.string().describe('id of the referenced BRAGI entity'),
      metric:      z.string().describe('e.g. "views" | "clicks" | "demo_conv" | "position" | "ai_share"'),
      value:       z.number(),
      ts:          z.string().optional().describe('ISO-8601 or epoch millis; defaults to now'),
      source:      z.string().optional().describe('e.g. "yandex-metrika" | "keys-so" | "tg-stats"'),
      segment:     z.string().optional(),
    },
    path: '/lore/bragi/metric',
    body: ({ object_type, object_id, metric, value, ts, source, segment }) => ({
          object_type, object_id, metric, value, ts, source, segment,
        }),
  });

  server.tool(
    'lore_query_metric',
    'Read BRAGI MetricSnapshot points with optional filters (object_type/object_id/metric, from/to as epoch ' +
      'millis) and optional server-side aggregation (agg: avg|sum|min|max|count, grouped by object_type+' +
      'object_id+metric). Without agg, returns up to `limit` raw points ordered newest-first. Always excludes ' +
      'the object_type="probe" schema-verification artifact.',
    {
      object_type: z.string().optional(),
      object_id:   z.string().optional(),
      metric:      z.string().optional(),
      from:        z.string().optional().describe('epoch millis, inclusive'),
      to:          z.string().optional().describe('epoch millis, inclusive'),
      agg:         z.enum(['avg', 'sum', 'min', 'max', 'count']).optional(),
      limit:       z.number().int().optional().describe('max raw points when agg is not set (default 200, capped at 1000)'),
    },
    async ({ object_type, object_id, metric, from, to, agg, limit }) => {
      try {
        const params: Record<string, string> = {};
        if (object_type) params.object_type = object_type;
        if (object_id) params.object_id = object_id;
        if (metric) params.metric = metric;
        if (from) params.from = from;
        if (to) params.to = to;
        if (agg) params.agg = agg;
        if (limit !== undefined) params.limit = String(limit);
        return json(await loreGet('/lore/bragi/metric/query', params));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'lore_create_integration',
    description: 'BragiIntegration: create/amend a read/write connector (upsert by integration_id, partial-safe). ' +
      '⚠️ secret_ref MUST be a reference, not a value — "env:METRIKA_TOKEN", "vault:seidr-telegraph", ' +
      '"oauth:gsc"; the backend rejects anything else. Never pass an actual token/API key. ' +
      'Mutates the shared system_aida_lore.',
    schema: {
      integration_id: z.string().describe('e.g. "INT-METRIKA"'),
      service:        z.string().optional().describe('e.g. "Яндекс.Метрика 110154828"'),
      purpose:        z.string().optional().describe('"read" | "write" | "read/write"'),
      endpoint:       z.string().optional(),
      scope:          z.string().optional(),
      secret_ref:     z.string().optional().describe('reference only, e.g. "env:METRIKA_TOKEN" — never a raw secret'),
      status:         z.string().optional().describe('e.g. "active" | "needs_admin"'),
      last_called_at: z.string().optional(),
    },
    path: '/lore/bragi/integration',
    body: ({ integration_id, service, purpose, endpoint, scope, secret_ref, status, last_called_at }) => ({
          integration_id, service, purpose, endpoint, scope, secret_ref, status, last_called_at,
        }),
  });

  definePostTool(server, {
    name: 'lore_create_insight',
    description: 'BragiInsight: create/amend a data-driven conclusion (upsert by insight_id, partial-safe). ' +
      'evidence_ref is a freeform pointer to the supporting measurement/date-range (MetricSnapshot rows ' +
      'don\'t carry graph edges, so this is text, not an edge). Use lore_link_insight to connect it to a ' +
      'Forseti task/ADR. Mutates the shared system_aida_lore.',
    schema: {
      insight_id:    z.string().describe('e.g. "INS-01"'),
      statement_md:  z.string().optional(),
      insight_date:  z.string().optional().describe('YYYY-MM-DD'),
      evidence_ref:  z.string().optional().describe('freeform pointer to supporting metrics/source'),
    },
    path: '/lore/bragi/insight',
    body: ({ insight_id, statement_md, insight_date, evidence_ref }) => ({
          insight_id, statement_md, insight_date, evidence_ref,
        }),
  });

  definePostTool(server, {
    name: 'lore_link_insight',
    description: 'Wire a LED_TO edge from an existing BragiInsight to a Forseti KnowTask or KnowADR — records that this ' +
      'insight drove a concrete follow-up. Idempotent.',
    schema: {
      insight_id:  z.string(),
      target_type: z.enum(['task', 'adr']),
      target_id:   z.string().describe('task_uid if target_type="task", adr_id if target_type="adr"'),
    },
    path: '/lore/bragi/insight/link',
    body: ({ insight_id, target_type, target_id }) => ({ insight_id, target_type, target_id }),
  });

  definePostTool(server, {
    name: 'lore_sync_integration',
    description: 'BragiIntegration manual sync (scaffold — no real cron): given an integration_id and a batch of ' +
      'ALREADY-FETCHED metrics, writes them to MetricSnapshot and bumps the integration\'s last_called_at. ' +
      'This does NOT call any third-party API itself — the caller (a real connector, or a human pasting ' +
      'numbers from a dashboard) is responsible for fetching from Яндекс.Метрика/Keys.so/GSC/Telegram and ' +
      'mapping source fields to metric names before calling this. Fails 404 if integration_id is unknown.',
    schema: {
      integration_id: z.string().describe('existing BragiIntegration id, e.g. "INT-METRIKA"'),
      metrics: z.array(z.object({
        object_type: z.string(),
        object_id:   z.string(),
        metric:      z.string(),
        value:       z.number(),
        ts:          z.string().optional().describe('ISO-8601 or epoch millis; defaults to now'),
        segment:     z.string().optional(),
      })).describe('batch of points to write'),
    },
    path: '/lore/bragi/integration/sync',
    body: ({ integration_id, metrics }) => ({ integration_id, metrics }),
  });

}
