import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ACTIVE_PROJECT, lorePost, loreGet, loreUpload } from '../backend.js';

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

// zod v4 dropped z.objectOutputType — z.infer<z.ZodObject<S>> is the direct
// replacement for a plain shape (no catchall needed by any call site here).
type ShapeOutput<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

// Factory for the common write-tool shape: validate against `schema`, POST the
// mapped body to `path`, wrap the result in json()/err(). Removes the repeated
// try/catch boilerplate that every straight-through tool used to inline. Tools
// with pre-processing (batch branches, computed ids, GET/upload, rel-dispatch
// link-collapse) stay explicit via server.tool().
function definePostTool<S extends z.ZodRawShape>(
  server: McpServer,
  def: {
    name: string;
    description: string;
    schema: S;
    path: string;
    body: (args: ShapeOutput<S>) => Record<string, unknown>;
  },
): void {
  // The SDK's server.tool overloads don't unify cleanly with a generic shape, so
  // the registration is cast. Per-call-site type safety comes from `def.body`
  // being checked against `S`; runtime validation is the zod `schema` itself.
  const handler = async (args: ShapeOutput<S>) => {
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
    name: 'status_set',
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
    name: 'task_new',
    description: 'Create a new task under a sprint (appends with the next order_index, opens an ' +
      'initial PLANNED history state). Optionally attaches the task to a sprint phase ' +
      '(IN_PHASE edge — the tasks_of_phase slice reads it). author/executor/reviewer_agent ' +
      '(ADR-LORE-014 §4) are free-text identities on the task vertex — reviewer must differ ' +
      'from executor before the task can move to done (hard gate, see status_set). ' +
      'Mutates the shared system_aida_lore.',
    schema: {
      sprint_id: z.string(),
      task_id: z.string().describe('short task id, unique within the sprint'),
      title: z.string(),
      note_md: z.string().optional().describe('optional Markdown note'),
      phase_uid: z.string().optional()
        .describe('optional phase to attach to, e.g. "SPRINT_X/PHASE_A" (must belong to the same sprint; create via sprint_phase_new first)'),
      author_agent: z.string().optional().describe('who owns/posed this task, e.g. "architect", "claude-full"'),
      executor_agent: z.string().optional().describe('who is expected to do the work'),
      reviewer_agent: z.string().optional().describe('who accepts it — must differ from executor_agent for the task to reach done'),
      task_type: z.string().optional().describe('ADR-LORE-015 classification (planning|design|dev|test|ops|research|analytics|docs|content); defaults to "dev" when omitted'),
      work_class: z.enum(['uc', 'jtd', 'enb']).optional().describe('ADR-LORE-022 WHY-axis (orthogonal to task_type): uc=realizes a use case (link it via uc_link rel="task"), jtd=helper job, enb=enabler; omit when unclassified — legal'),
    },
    path: '/lore/task',
    body: ({ sprint_id, task_id, title, note_md, phase_uid, author_agent, executor_agent, reviewer_agent, task_type, work_class }) => ({
          sprint_id, task_id, title,
          note_md: note_md ?? null, phase_uid: phase_uid ?? null,
          author_agent: author_agent ?? null, executor_agent: executor_agent ?? null,
          reviewer_agent: reviewer_agent ?? null, task_type: task_type ?? null,
          work_class: work_class ?? null,
        }),
  });

  definePostTool(server, {
    name: 'task_mv',
    description: 'Move a task to another sprint (ADR-LORE-013, cancel + recreate). Creates a fresh copy ' +
      'in target_sprint_id — same title/note_md/effort_days + TAGGED_WITH component links, initial ' +
      'PLANNED state — and cancels the source (it stays as a ❌ CANCELLED tombstone in the old sprint). ' +
      'NOT a PK re-key: the new task has its OWN fresh status history; the source keeps its history. ' +
      'task_id is reused when free in the target, else new_task_id, else a "<id>_N" suffix (returned as ' +
      'new_task_id + task_id_changed). IN_PHASE and inbound edges (PROMOTED_TO/LED_TO) stay on the source ' +
      '— re-link on the new task via task_link if needed. ' +
      'Mutates the shared system_aida_lore.',
    schema: {
      task_uid:         z.string().describe('full source task uid, e.g. "SPRINT_OLD/T05"'),
      target_sprint_id: z.string().describe('destination sprint, e.g. "SPRINT_NEW"'),
      new_task_id:      z.string().optional().describe('preferred task_id in the target (default: reuse source task_id; auto-suffixed on collision)'),
    },
    path: '/lore/task/move',
    body: ({ task_uid, target_sprint_id, new_task_id }) => ({ task_uid, target_sprint_id, new_task_id: new_task_id ?? null }),
  });

  definePostTool(server, {
    name: 'sprint_phase_new',
    description: 'Create a sprint phase (KnowPhase): PART_OF → sprint, initial PLANNED history state. ' +
      'phase_uid = "<sprint_id>/PHASE_<KEY>". Idempotent — an existing phase is returned ' +
      'unchanged (created=false). Attach tasks via task_new(phase_uid) or ' +
      'task_link(rel:"phase"). Mutates the shared system_aida_lore.',
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

  // ── task_link(rel) — collapses task_link_phase + task_link_component (2→1) ──
  server.tool(
    'task_link',
    'Link (or unlink) a KnowTask to another entity. rel="phase": IN_PHASE edge to a sprint phase ' +
      '(task and phase must belong to the same sprint; action="remove" without target_id detaches ' +
      'from ALL phases). rel="component": TAGGED_WITH edge to a LoreComponent, many-to-many. ' +
      'rel="file": EDITED_IN edge to a KnowFile (ADR-018) — a repo file REFERENCE (relative path ' +
      'only), lazily created on first link; requires project. Idempotent on add. Mutates system_aida_lore.',
    {
      task_uid:  z.string().describe('full task uid, e.g. "SPRINT_X/B1"'),
      rel:       z.enum(['phase', 'component', 'file']),
      target_id: z.string().optional().describe('phase_uid (rel="phase") | component_id (rel="component") | relative file path (rel="file", e.g. "backend/src/.../LoreSlices.java"); omit with rel="phase"+action="remove" to detach from all phases'),
      project:   z.string().optional().describe('rel="file" only: KnowGitProject slug the file belongs to, e.g. "NooriUta/UnlimitedLORE"'),
      summary_md: z.string().optional().describe('rel="file" only: optional short note on what the file does'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ task_uid, rel, target_id, project, summary_md, action }) => {
      try {
        const act = action ?? 'add';
        if (rel === 'phase') {
          return json(await lorePost('/lore/task/phase', { task_uid, phase_uid: target_id ?? null, action: act }));
        }
        if (rel === 'file') {
          if (!target_id) return err(new Error('target_id (file path) required for rel="file"'));
          if (!project) return err(new Error('project required for rel="file"'));
          return json(await lorePost('/lore/task/file', { task_uid, project, file_path: target_id, summary_md: summary_md ?? null, action: act }));
        }
        if (!target_id) return err(new Error('target_id required for rel="component"'));
        return json(await lorePost('/lore/task/component', { task_uid, component_id: target_id, action: act }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'sprint_new',
    description: 'Create a new KnowSprint vertex directly. Idempotent (upsert by sprint_id). ' +
      'Seeds an initial HAS_STATE history row. project (ADR-LORE-017, T16) optionally wires ' +
      'BELONGS_TO_PROJECT in the same call — omit to default to the session\'s ' +
      'LORE_ACTIVE_PROJECT, if set; pass sprint_link(rel:"project") later if you need to add ' +
      'more than one project. Mutates system_aida_lore.',
    schema: {
      sprint_id:  z.string().describe('unique sprint id, e.g. "SPRINT_SITE_EXTRACT"'),
      name:       z.string().describe('human-readable sprint name'),
      status:     LORE_STATUS.optional().default('todo'),
      plan_id:    z.string().optional().describe('optional plan this sprint belongs to'),
      priority:   z.string().optional().describe('e.g. "high", "critical"'),
      outcome_md: z.string().optional().describe('sprint goal / outcome in Markdown'),
      context_md: z.string().optional().describe('background context for the sprint — WHY it exists, key decisions, related sprints, links to docs. Shown in sprint detail panel.'),
      project:    z.string().optional().describe('git_project slug to wire via BELONGS_TO_PROJECT, e.g. "NooriUta/UnlimitedLORE" — omit to fall back to LORE_ACTIVE_PROJECT if set, omit both to leave unlinked'),
    },
    path: '/lore/sprint/create',
    body: ({ sprint_id, name, status, plan_id, priority, outcome_md, context_md, project }) => ({
          sprint_id, name,
          status: status ?? 'todo',
          plan_id: plan_id ?? null,
          priority: priority ?? null,
          outcome_md: outcome_md ?? null,
          context_md: context_md ?? null,
          git_project: project ?? ACTIVE_PROJECT ?? null,
        }),
  });

  // sprint_set: merges the old lore_update_sprint (metadata) + lore_update_sprint_refs
  // (pr_refs) into one tool per ADR-LORE-014 §2's single `sprint_set` entry — routes to
  // whichever backend endpoint the supplied fields imply. Passing BOTH metadata fields
  // and pr_numbers in one call hits both endpoints in sequence.
  server.tool(
    'sprint_set',
    'Update a KnowSprint: metadata fields (name/outcome_md/context_md/plan_id/effort_days — partial, ' +
      'only supplied fields written) and/or PR refs (pr_numbers — appended to the sprint\'s pr_refs ' +
      'string, existing ones skipped; pass pr_replace=true to discard existing pr_refs first instead of ' +
      'appending, e.g. to fix entries baked with the wrong repo). Does NOT change status — use status_set. ' +
      'Does NOT change priority/planned dates — use sprint_plan_set (SCD2 close-open). ' +
      'RULE: always fill context_md when you know WHY the sprint exists. Mutates system_aida_lore.',
    {
      sprint_id:   z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      name:        z.string().optional(),
      outcome_md:  z.string().optional().describe('sprint outcome / retrospective in Markdown'),
      context_md:  z.string().optional().describe('background context — WHY the sprint exists, key decisions, links to ADRs/docs, related sprints'),
      plan_id:     z.string().optional(),
      effort_days: z.number().optional().describe('actual effort in person-days, fractional to the hour (1 day = 8h, e.g. 0.125)'),
      pr_numbers:  z.array(z.number().int()).optional().describe('PR numbers to append to pr_refs, e.g. [420, 421]'),
      pr_git_project: z.string().optional().describe('GitHub project slug for PR links, e.g. "NooriUta/aida-documentation" (default: NooriUta/AIDA). Ignored if pr_repo_url is set.'),
      pr_repo_url: z.string().optional().describe('full base URL for PR links, e.g. "https://github.com/NooriUta/UnlimitedLORE/pull" — takes precedence over pr_git_project'),
      pr_replace:  z.boolean().optional().describe('discard existing pr_refs before adding pr_numbers, instead of appending'),
    },
    async ({ sprint_id, name, outcome_md, context_md, plan_id, effort_days, pr_numbers, pr_git_project, pr_repo_url, pr_replace }) => {
      try {
        const results: Record<string, unknown> = {};
        const hasMeta = name !== undefined || outcome_md !== undefined || context_md !== undefined
          || plan_id !== undefined || effort_days !== undefined;
        if (hasMeta) {
          results.metadata = await lorePost('/lore/sprint/update', {
            sprint_id,
            name: name ?? null, outcome_md: outcome_md ?? null,
            context_md: context_md ?? null, plan_id: plan_id ?? null,
            effort_days: effort_days ?? null,
          });
        }
        if (pr_numbers && pr_numbers.length > 0) {
          results.pr_refs = await lorePost('/lore/sprint/refs', {
            sprint_id, pr_numbers,
            git_project: pr_git_project ?? null, repo_url: pr_repo_url ?? null,
            replace: pr_replace ?? false,
          });
        }
        if (!hasMeta && !(pr_numbers && pr_numbers.length > 0)) {
          return err(new Error('provide at least one metadata field or pr_numbers'));
        }
        return json({ sprint_id, ...results });
      } catch (e) { return err(e); }
    },
  );


  // ── ADR-LORE-022: продуктовый слой Feature → UC (ACCEPTED 2026-07-17) ──
  // RBAC D10: пишут architect/pm (+full); клиентские профили зеркалируют.
  definePostTool(server, {
    name: 'feature_new',
    description: 'Create or update a KnowFeature (product capability, ADR-LORE-022). Upserts by feature_id. ' +
      'status: proposed|active|dropped — "shipped" is COMPUTED (D4: all UCs shipped), the endpoint rejects it. ' +
      'Decompose into UCs via uc_new(feature_id). Feature→Release edge does NOT exist by design (D8 — derived). ' +
      'Mutates system_aida_lore.',
    schema: {
      feature_id:   z.string().describe('e.g. "FEAT-GITCYCLE"'),
      title:        z.string().optional(),
      body_md:      z.string().optional().describe('ценность + критерий готовности'),
      context_md:   z.string().optional().describe('БОЛЬШОЙ контекст (D13, как у спринта): зачем фича, ссылки на ADR/спринты'),
      status:       z.enum(['proposed', 'active', 'dropped']).optional(),
      component_id: z.string().optional(),
    },
    path: '/lore/feature',
    body: ({ feature_id, title, body_md, context_md, status, component_id }) => ({
      feature_id, title: title ?? null, body_md: body_md ?? null, context_md: context_md ?? null,
      status: status ?? null, component_id: component_id ?? null,
    }),
  });

  definePostTool(server, {
    name: 'uc_new',
    description: 'Create or update a KnowUseCase (unit of user value, ADR-LORE-022). Upserts by uc_id; ' +
      'feature_id keeps the DECOMPOSES_INTO edge in sync (response carries feature_linked:false when the ' +
      'feature is missing — not a silent no-op). scenario_md/acceptance_md are separate fields; actors are ' +
      'KnowActor VERTICES (D12, can be several) — attach via uc_link rel="actor", never a free-text string. ' +
      'UC shipped ⇔ its uc-tasks are done (advisory). Mutates system_aida_lore.',
    schema: {
      uc_id:         z.string().describe('e.g. "UC-GIT-MERGE"'),
      title:         z.string().optional().describe('сценарий одной строкой'),
      scenario_md:   z.string().optional()
        .describe('Cockburn template (ADR-LORE-027 §1) — section headings are a machine-read convention: ' +
          '"### Триггер", "### Предусловия", "### Основной сценарий" (numbered 1..N), "### Расширения" ' +
          '(items "2a. …"/"3b. …" — the number MUST reference an existing step), "### Вариации", ' +
          '"### Минимальные гарантии", "### Гарантии успеха", "### Диаграмма" (```mermaid``` renders natively). ' +
          'Images: upload via asset_up and paste the returned md snippet.'),
      acceptance_md: z.string().optional()
        .describe('критерий приёмки; fully-dressed wants "### Проверки" (numbered) + "### Покрытие расширений" ' +
          '(each Na from the scenario named), casual — just a numbered list of checks (ADR-LORE-027 §3)'),
      status:        z.enum(['proposed', 'active', 'shipped', 'dropped']).optional(),
      feature_id:    z.string().optional().describe('родитель — держит DECOMPOSES_INTO в синхроне'),
      goal_level:    z.enum(['cloud', 'kite', 'sea-level', 'subfunction']).optional()
        .describe('Cockburn goal level, one scale for the whole layer: ☁ cloud / 🪁 kite = feature altitude, ' +
          '🌊 sea-level (user goal) / 🐟 subfunction = UC altitude'),
      rigor:         z.enum(['casual', 'fully-dressed']).optional()
        .describe('writing weight (ADR-LORE-027-D1) — omit to derive from goal_level ' +
          '(subfunction → casual, everything else → fully-dressed); passing it explicitly always wins'),
      priority:      z.enum(['high', 'normal', 'low']).optional(),
    },
    path: '/lore/uc',
    body: ({ uc_id, title, scenario_md, acceptance_md, status, feature_id, goal_level, rigor, priority }) => ({
      uc_id, title: title ?? null, scenario_md: scenario_md ?? null,
      acceptance_md: acceptance_md ?? null, status: status ?? null, feature_id: feature_id ?? null,
      goal_level: goal_level ?? null, rigor: rigor ?? null, priority: priority ?? null,
    }),
  });

  // ADR-LORE-032 §2 (D5): боли и выгоды — ВЕРШИНЫ, не проза. Только так fit
  // VP-канвы считается рёбрами, боль переиспользуется несколькими фичами, и
  // «самая горячая боль» + дубль усилий становятся видимы (аналитика ADR-030).
  definePostTool(server, {
    name: 'pain_new',
    description: 'Create or update a KnowPain — a customer pain as a graph vertex (ADR-LORE-032 §2). ' +
      'Upsert by pain_id. Wire it up: feature_link(rel="pain") = the feature CLAIMS to address it, ' +
      'uc_link(rel="relieves") = a use case ACTUALLY relieves it, uc_link on the actor side tells whose pain ' +
      'it is. A pain with claims but no reliever is exactly what the hygiene slice reports. ' +
      'Reuse the same pain across features — that is the point of it being a vertex.',
    schema: {
      pain_id:  z.string().describe('e.g. "PAIN-LORE-RAW-TOKEN" (PAIN-<PROJ>-<slug>)'),
      title:    z.string().optional().describe('боль одной строкой, языком клиента'),
      body_md:  z.string().optional().describe('подробности: когда возникает, чем сейчас обходят'),
      severity: z.enum(['high', 'normal', 'low']).optional(),
    },
    path: '/lore/pain',
    body: ({ pain_id, title, body_md, severity }) => ({
      pain_id, title: title ?? null, body_md: body_md ?? null, severity: severity ?? null,
    }),
  });

  definePostTool(server, {
    name: 'gain_new',
    description: 'Create or update a KnowGain — a customer gain as a graph vertex (ADR-LORE-032 §2). ' +
      'metric_md is what makes the gain COUNT: a gain without a measurable metric never closes the VP fit, ' +
      'and the response says so. Wire it up: feature_link(rel="gain") = the feature PROMISES it, ' +
      'uc_link(rel="delivers") = a use case ACTUALLY creates it.',
    schema: {
      gain_id:   z.string().describe('e.g. "GAIN-LORE-LINKED-RELEASES" (GAIN-<PROJ>-<slug>)'),
      title:     z.string().optional().describe('выгода одной строкой'),
      body_md:   z.string().optional(),
      metric_md: z.string().optional().describe('ЧЕМ МЕРЯЕМ — без метрики выгода не засчитывается в fit'),
    },
    path: '/lore/gain',
    body: ({ gain_id, title, body_md, metric_md }) => ({
      gain_id, title: title ?? null, body_md: body_md ?? null, metric_md: metric_md ?? null,
    }),
  });

  definePostTool(server, {
    name: 'feature_link',
    description: 'Link (or unlink) a KnowFeature. rel="pain": ADDRESSES — the feature claims to address a pain; ' +
      'rel="gain": PROMISES — it promises a gain (relieving/delivering is the UCs\' job, see uc_link ' +
      'rel="relieves"/"delivers"). rel="milestone": TARGETS_MILESTONE — the strategic goal the feature refines ' +
      '(KAOS reading: milestone = goal, feature = refinement, UCs = operationalisations). rel="component": ' +
      'BELONGS_TO. linked:false in the response = edge NOT created (target missing) — never a silent no-op.',
    schema: {
      feature_id: z.string(),
      rel:        z.enum(['pain', 'gain', 'milestone', 'component']),
      target_id:  z.string().describe('pain_id | gain_id | milestone_id | component_id, matching rel'),
      action:     z.enum(['add', 'remove']).default('add'),
    },
    path: '/lore/feature/link',
    body: ({ feature_id, rel, target_id, action }) => ({ feature_id, rel, target_id, action: action ?? 'add' }),
  });

  server.tool(
    'uc_link',
    'Link (or unlink) a KnowUseCase. rel="task": REALIZES edge (KnowTask→UC), target_id=full task_uid — ' +
      'REQUIRED discipline for tasks with work_class=uc (advisory, D3). rel="adr"/"decision": TRACED_TO ' +
      'edge (UC→justification) — OPTIONAL by design (D9). rel="actor": HAS_ACTOR edge (MULTI, D12) to a ' +
      'KnowActor (create via actor_new first). rel="includes"/"extends": UC→UC graph relations (D13): ' +
      'includes = mandatory sub-scenario, extends = variant. rel="relieves"/"delivers" (ADR-LORE-032 §2): ' +
      'the UC actually relieves a KnowPain / delivers a KnowGain — these edges are what CLOSE the VP fit ' +
      'the feature only claimed via feature_link(pain|gain). linked:false in the response = edge NOT created ' +
      '(target missing) — never a silent no-op. Mutates system_aida_lore.',
    {
      uc_id:     z.string().describe('e.g. "UC-GIT-MERGE"'),
      rel:       z.enum(['task', 'adr', 'decision', 'actor', 'includes', 'extends', 'relieves', 'delivers']),
      target_id: z.string().describe('task_uid (rel=task) | adr_id | decision_id | actor_id | uc_id (includes/extends) | pain_id (relieves) | gain_id (delivers)'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ uc_id, rel, target_id, action }) => {
      try {
        return json(await lorePost('/lore/uc/link', { uc_id, rel, target_id, action: action ?? 'add' }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'actor_new',
    description: 'Create or update a KnowActor — проектируемая роль приложения (D12): human-role | system | ' +
      'agent. Upserts by actor_id. Один актор ссылается многими UC (HAS_ACTOR via uc_link rel="actor") — ' +
      'реестр ролей и карта «сценарии роли» живут на этой вершине. Mutates system_aida_lore.',
    schema: {
      actor_id: z.string().describe('e.g. "ACT-ADMIN", "ACT-AGENT-SESSION"'),
      name:     z.string().optional().describe('человекочитаемое имя роли, e.g. "Администратор LORE"'),
      kind:     z.enum(['human-role', 'system', 'agent']).optional(),
      body_md:  z.string().optional().describe('кто это, права, ожидания'),
    },
    path: '/lore/actor',
    body: ({ actor_id, name, kind, body_md }) => ({
      actor_id, name: name ?? null, kind: kind ?? null, body_md: body_md ?? null,
    }),
  });

  // sprint_plan_set (MCPSYNC-01): закрывает единственную содержательную дыру
  // сверки REST↔MCP 2026-07-17 — /lore/sprint/plan (приоритет + плановые даты +
  // track_id, SCD2 close-open) был недостижим из агентов; sprint_set честно
  // писал об этом в описании. Свой инструмент, а не поле в sprint_set: у /plan
  // другой SCD2-контракт (открывает новую ревизию), смешивать с partial-update
  // метаданных значило бы прятать это различие.
  server.tool(
    'sprint_plan_set',
    'Set SCD2 plan fields of a KnowSprint: priority, planned_start_date/planned_end_date (YYYY-MM-DD), ' +
      'track_id. Opens a NEW hist revision (close-open), carrying everything else forward. ' +
      'At least one field required. Does NOT change status — use status_set. Mutates system_aida_lore.',
    {
      sprint_id:          z.string().describe('e.g. "SPRINT_LORE_ADMIN_PANEL"'),
      priority:           z.string().optional().describe('e.g. "high" | "normal" | "low" (dict priority)'),
      planned_start_date: z.string().optional().describe('YYYY-MM-DD'),
      planned_end_date:   z.string().optional().describe('YYYY-MM-DD'),
      track_id:           z.string().optional(),
    },
    async ({ sprint_id, priority, planned_start_date, planned_end_date, track_id }) => {
      try {
        return json(await lorePost('/lore/sprint/plan', {
          sprint_id,
          priority: priority ?? null,
          planned_start_date: planned_start_date ?? null,
          planned_end_date: planned_end_date ?? null,
          track_id: track_id ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  // ── sprint_link(rel) — collapses sprint_link_project/dep/component/milestone (4→1) ──
  server.tool(
    'sprint_link',
    'Link (or unlink) a KnowSprint to another entity. rel="project": BELONGS_TO_PROJECT edge, target_id ' +
      '= git_project slug (a sprint can belong to multiple projects). rel="dep": DEPENDS_ON edge to ' +
      'ANOTHER sprint (target_id = the sprint depended on; this sprint_id depends on target_id); kind = ' +
      'hard (blocks deploy) | soft (coordination) | gate (go/no-go) | informs (awareness); server rejects ' +
      'edges that would create a cycle. rel="component": BELONGS_TO edge, target_id = component_id — ' +
      'overrides the fuzzy sprint_id-LIKE-%component_key% match. rel="milestone": TARGETS_MILESTONE edge, ' +
      'target_id = milestone_id — the sole way to assign a sprint to a milestone. ' +
      'Idempotent on add. Mutates system_aida_lore.',
    {
      sprint_id: z.string().describe('e.g. "SPRINT_HOUND_ROWSET_V2"'),
      rel:       z.enum(['project', 'dep', 'component', 'milestone']),
      target_id: z.string().describe('git_project slug (rel="project"), depended-on sprint_id (rel="dep"), component_id (rel="component"), or milestone_id (rel="milestone")'),
      kind:      z.enum(['hard', 'soft', 'gate', 'informs']).optional().default('soft').describe('rel="dep" only'),
      reason:    z.string().optional().describe('rel="dep" only: brief reason for the dependency'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ sprint_id, rel, target_id, kind, reason, action }) => {
      try {
        const act = action ?? 'add';
        if (rel === 'project') {
          return json(await lorePost('/lore/sprint/project', { sprint_id, git_project: target_id, action: act }));
        }
        if (rel === 'dep') {
          return json(await lorePost('/lore/sprint/dep', {
            from_sprint: sprint_id, to_sprint: target_id, kind: kind ?? 'soft', reason: reason ?? null, action: act,
          }));
        }
        if (rel === 'component') {
          return json(await lorePost('/lore/sprint/component', { sprint_id, component_id: target_id, action: act }));
        }
        return json(await lorePost('/lore/milestone/sprint', { sprint_id, milestone_id: target_id, action: act }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'milestone_new',
    description: 'Create a KnowMilestone (upsert by milestone_id) — was previously ONLY reachable via raw HTTP ' +
      'or the UI form, no MCP tool existed. Partial calls are safe: unset label/week/date_display/' +
      'priority are left untouched (LH-44). goal_md is written to the open KnowMilestoneHist row ' +
      '(created on first fill). To attach sprints, use sprint_link(rel:"milestone") — this tool only ' +
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
    name: 'milestone_set',
    description: 'Amend an EXISTING KnowMilestone — same endpoint as milestone_new, signature tailored ' +
      'for partial updates (mirror of adr_set/spec_set). Omitted fields are left ' +
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
    name: 'status_set_batch',
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
    name: 'adr_new',
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
      supersedes_ids:   z.array(z.string()).optional().describe('adr_id(s) this ADR supersedes — creates SUPERSEDES edges FROM this adr TO each listed one, replaces the full set. Pair with status="SUPERSEDED" on the OLD adr_id (separate adr_new call) to mark it retired.'),
      tags:             z.array(z.string()).optional().describe('free-text tags — upserts KnowTag + TAGGED_WITH edges, replaces the full set'),
      file_path:        z.string().optional().describe('source .md path relative to docs root, e.g. "engine/specs/adr/ADR-HND-022.md"'),
      checkpoint:       z.boolean().optional().describe('LH-02: true = a body edit opens a NEW hist version (SCD2 close-open, previous edition preserved) instead of amending in place'),
    },
    path: '/lore/adr',
    body: ({ adr_id, name, status, date_created, component_id, component_ids, context_md, decision_md, consequences_md, depends_on_ids, supersedes_ids, tags, file_path, checkpoint }) => ({
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, component_ids: component_ids ?? null,
          context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
          depends_on_ids: depends_on_ids ?? null, supersedes_ids: supersedes_ids ?? null,
          tags: tags ?? null, file_path: file_path ?? null, checkpoint: checkpoint ?? null,
        }),
  });

  definePostTool(server, {
    name: 'adr_set',
    description: 'Amend an EXISTING KnowADR — thin wrapper over the same endpoint as adr_new, ' +
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
      checkpoint:       z.boolean().optional().describe('LH-02: true = amend opens a NEW hist version (SCD2 close-open, previous edition preserved) instead of in-place'),
    },
    path: '/lore/adr',
    body: ({ adr_id, name, status, date_created, component_id, component_ids, context_md, decision_md, consequences_md, depends_on_ids, supersedes_ids, tags, file_path, checkpoint }) => ({
          adr_id, name,
          status: status ?? null, date_created: date_created ?? null,
          component_id: component_id ?? null, component_ids: component_ids ?? null,
          context_md: context_md ?? null,
          decision_md: decision_md ?? null, consequences_md: consequences_md ?? null,
          depends_on_ids: depends_on_ids ?? null, supersedes_ids: supersedes_ids ?? null,
          tags: tags ?? null, file_path: file_path ?? null, checkpoint: checkpoint ?? null,
        }),
  });

  // ── adr_link(rel) — collapses 6 adr_link_* tools into one (rel picks the edge type) ──
  server.tool(
    'adr_link',
    'Link (or unlink) a KnowADR to another entity, one edge at a time (full-replace alternatives — ' +
      'component_ids/depends_on_ids/supersedes_ids/tags on adr_new/adr_set — recreate the WHOLE set; use ' +
      'this for a single incremental add/remove). rel="sprint": IMPLEMENTED_IN edge, target_id=sprint_id ' +
      '(feeds the adr slice implemented_in_ids). rel="release": IMPLEMENTED_IN_RELEASE edge, ' +
      'target_id=release_id — pass git_project for multi-repo safety (release_uid = ' +
      '"{git_project}#{release_id}"). rel="component": BELONGS_TO edge, target_id=component_id. ' +
      'rel="depends_on": DEPENDS_ON edge, target_id=the ADR this one depends on. rel="supersedes": ' +
      'SUPERSEDES edge, target_id=the OLDER ADR this one supersedes (pair with status="SUPERSEDED" on ' +
      'the old adr_id via a separate adr_set call). rel="tag": TAGGED_WITH edge (upserts the KnowTag ' +
      'vertex if new), target_id=tag_id. rel="project": BELONGS_TO_PROJECT edge (MULTI), target_id=git ' +
      'project slug (must be registered via project_new — response carries linked:false on silent no-op). ' +
      'Idempotent on add. Mutates system_aida_lore.',
    {
      adr_id:      z.string().describe('e.g. "ADR-HND-022"'),
      rel:         z.enum(['sprint', 'release', 'component', 'depends_on', 'supersedes', 'tag', 'project']),
      target_id:   z.string().describe('sprint_id / release_id / component_id / dep_adr_id / superseded_adr_id / tag_id, matching rel'),
      git_project: z.string().optional().describe('rel="release" only: GitHub project slug, e.g. "NooriUta/AIDA"'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ adr_id, rel, target_id, git_project, action }) => {
      try {
        const act = action ?? 'add';
        switch (rel) {
          case 'sprint':
            return json(await lorePost('/lore/adr/link', { adr_id, sprint_id: target_id, action: act }));
          case 'release':
            return json(await lorePost('/lore/adr/link', { adr_id, release_id: target_id, git_project: git_project ?? null, action: act }));
          case 'component':
            return json(await lorePost('/lore/adr/component', { adr_id, component_id: target_id, action: act }));
          case 'depends_on':
            return json(await lorePost('/lore/adr/depends_on', { adr_id, dep_adr_id: target_id, action: act }));
          case 'supersedes':
            return json(await lorePost('/lore/adr/supersedes', { adr_id, superseded_adr_id: target_id, action: act }));
          case 'tag':
            return json(await lorePost('/lore/adr/tag', { adr_id, tag_id: target_id, action: act }));
          case 'project':
            return json(await lorePost('/lore/adr/project', { adr_id, project: target_id, action: act }));
        }
      } catch (e) { return err(e); }
    },
  );

  // ── runbook_link(rel) — rename only, single edge type today ──
  definePostTool(server, {
    name: 'runbook_link',
    description: 'Link (or unlink) a KnowRunbook to the KnowADR it references via a REFERENCES_ADR edge (feeds the ' +
      '"runbooks"/"runbook_by_id" slices\' adr_ids field). A runbook mentioning an ADR only as a text-only ' +
      '[[ADR-ID]] wiki link inside content_md has NO real graph edge — this creates one. Idempotent on add. ' +
      'rel is always "adr" today (kept for symmetry with other *_link tools).',
    schema: {
      runbook_id: z.string().describe('e.g. "RUNBOOK-INFISICAL-LOCAL-SETUP"'),
      rel:        z.literal('adr').optional().default('adr'),
      adr_id:     z.string().describe('e.g. "ADR-MT-011"'),
      action:     z.enum(['add', 'remove']).optional().default('add'),
    },
    path: '/lore/runbook/adr',
    body: ({ runbook_id, adr_id, action }) => ({ runbook_id, adr_id, action: action ?? 'add' }),
  });

  definePostTool(server, {
    name: 'adr_rename',
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
    name: 'adr_del',
    description: 'PERMANENTLY delete a KnowADR: cascades edges first (ArcadeDB cannot DELETE VERTEX with edges), ' +
      'then its KnowADRHist rows, then the vertex. Irreversible — prefer status="DEPRECATED"/' +
      '"SUPERSEDED" via adr_set for anything that was ever real; delete is for test ' +
      'artifacts and mistaken creations only.',
    schema: { adr_id: z.string() },
    path: '/lore/adr/delete',
    body: ({ adr_id }) => ({ adr_id }),
  });

  definePostTool(server, {
    name: 'decision_new',
    description: 'Create or update a KnowDecision (logged decision/verdict). Idempotent — upserts by decision_id. ' +
      'Use for recording key decisions made during a sprint or design session. ADR-019: a decision is a CHILD of ' +
      'an ADR — pass adr_id to link it (DECIDED_IN), component_id/tags for the "rule" filters. Stays vertex-only ' +
      '(no history) — consistent with the flat KnowDecision model.',
    schema: {
      decision_id:  z.string().describe('unique id, e.g. "D-2026-047"'),
      title:        z.string(),
      body_md:      z.string().optional().describe('full decision text in Markdown'),
      date_created: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      refs_raw:     z.string().optional().describe('free-text references, e.g. "#420, ADR-HND-021"'),
      component_id: z.string().optional().describe('ADR-019: component this decision belongs to (filter axis)'),
      adr_id:       z.string().optional().describe('ADR-019: parent ADR — creates a DECIDED_IN edge to it'),
      tags:         z.array(z.string()).optional().describe('ADR-019: free tags (KnowTag), e.g. ["stale-versions"]'),
    },
    path: '/lore/decision',
    body: ({ decision_id, title, body_md, date_created, refs_raw, component_id, adr_id, tags }) => ({
          decision_id, title,
          body_md: body_md ?? null, date_created: date_created ?? null,
          refs_raw: refs_raw ?? null,
          component_id: component_id ?? null, adr_id: adr_id ?? null, tags: tags ?? null,
        }),
  });

  server.tool(
    'decision_link',
    'Link a KnowDecision (T43). rel="component": attach a component (MULTI, BELONGS_TO — add/remove); ' +
      'rel="project": attach a git project (MULTI, BELONGS_TO_PROJECT — add/remove). The parent-ADR link ' +
      '(DECIDED_IN) is set via decision_new(adr_id), not here. Idempotent. Mutates system_aida_lore.',
    {
      decision_id: z.string(),
      rel:         z.enum(['component', 'project']),
      target_id:   z.string().describe('component_id (rel="component") or git_project slug (rel="project")'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ decision_id, rel, target_id, action }) => {
      try {
        const act = action ?? 'add';
        if (rel === 'component') return json(await lorePost('/lore/decision/component', { decision_id, component_id: target_id, action: act }));
        return json(await lorePost('/lore/decision/project', { decision_id, project: target_id, action: act }));
      } catch (e) { return err(e); }
    },
  );

  // ── Open questions (KnowQuestion, ADR-020/021) ────────────────────────────
  definePostTool(server, {
    name: 'question_new',
    description: 'Create or update a KnowQuestion — an OPEN QUESTION (ADR-020/021), the "what have we not answered yet" ' +
      'register. Upserts by question_id, vertex-only (no history). status="deferred" REQUIRES a trigger; ' +
      'status="closed" is set automatically when a decision answers it (question_link rel="answers"), never here. ' +
      'RBAC: architect + analyst + pm + full.',
    schema: {
      question_id:  z.string().describe('e.g. "Q-M1", "OQ7", "Q-MT3"'),
      title:        z.string().optional().describe('the question itself'),
      body_md:      z.string().optional().describe('context, options, closing criterion'),
      status:       z.enum(['open', 'deferred', 'dropped']).optional().describe('open|deferred|dropped (closed is set via answers link)'),
      trigger:      z.string().optional().describe('REQUIRED when status="deferred": reactivation condition (may be a date)'),
      component_id: z.string().optional(),
      due_date:     z.string().optional().describe('YYYY-MM-DD — the answer deadline (drives overdue)'),
      priority:     z.enum(['blocker', 'high', 'normal', 'low']).optional(),
      owner:        z.string().optional().describe('who owns getting the answer'),
      raised_by:    z.string().optional(),
    },
    path: '/lore/question',
    body: (a) => ({
      question_id: a.question_id, title: a.title ?? null, body_md: a.body_md ?? null,
      status: a.status ?? null, trigger: a.trigger ?? null, component_id: a.component_id ?? null,
      due_date: a.due_date ?? null, priority: a.priority ?? null, owner: a.owner ?? null, raised_by: a.raised_by ?? null,
    }),
  });

  definePostTool(server, {
    name: 'question_set',
    description: 'Update fields of an existing KnowQuestion (partial — omitted fields untouched). Same path as ' +
      'question_new. Use to change status/priority/due_date/owner. status="deferred" still requires a trigger; ' +
      'do NOT set status="closed" here (link an answering decision instead).',
    schema: {
      question_id:  z.string(),
      title:        z.string().optional(),
      body_md:      z.string().optional(),
      status:       z.enum(['open', 'deferred', 'dropped']).optional(),
      trigger:      z.string().optional(),
      component_id: z.string().optional(),
      due_date:     z.string().optional(),
      priority:     z.enum(['blocker', 'high', 'normal', 'low']).optional(),
      owner:        z.string().optional(),
      raised_by:    z.string().optional(),
    },
    path: '/lore/question',
    body: (a) => ({
      question_id: a.question_id, title: a.title ?? null, body_md: a.body_md ?? null,
      status: a.status ?? null, trigger: a.trigger ?? null, component_id: a.component_id ?? null,
      due_date: a.due_date ?? null, priority: a.priority ?? null, owner: a.owner ?? null, raised_by: a.raised_by ?? null,
    }),
  });

  server.tool(
    'question_link',
    'Link a KnowQuestion (ADR-020/021). rel="answers": a decision closes it (creates ANSWERS + auto-sets status=closed); ' +
      'rel="raised_in": where it was raised (needs target_type adr|sprint|task); rel="gates": it blocks a task (GATES — ' +
      'the gate that keeps the register self-cleaning); rel="component": attach a component (MULTI, BELONGS_TO — add/remove); ' +
      'rel="project": attach a git project (MULTI, BELONGS_TO_PROJECT — add/remove). Idempotent. Mutates system_aida_lore.',
    {
      question_id: z.string(),
      rel:         z.enum(['answers', 'raised_in', 'gates', 'component', 'project']),
      target_id:   z.string().describe('per rel: decision_id | adr/sprint/task id | task_uid | component_id | git_project slug'),
      target_type: z.enum(['adr', 'sprint', 'task']).optional().describe('rel="raised_in" only'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ question_id, rel, target_id, target_type, action }) => {
      try {
        const act = action ?? 'add';
        if (rel === 'answers')   return json(await lorePost('/lore/question/answers', { decision_id: target_id, question_id, action: act }));
        if (rel === 'gates')     return json(await lorePost('/lore/question/gates', { question_id, task_uid: target_id, action: act }));
        if (rel === 'component') return json(await lorePost('/lore/question/component', { question_id, component_id: target_id, action: act }));
        if (rel === 'project')   return json(await lorePost('/lore/question/project', { question_id, project: target_id, action: act }));
        if (!target_type) return err(new Error('target_type (adr|sprint|task) required for rel="raised_in"'));
        return json(await lorePost('/lore/question/raised_in', { question_id, target_type, target_id, action: act }));
      } catch (e) { return err(e); }
    },
  );

  // ── Release management ──────────────────────────────────────────────────

  // release_mv: not in ADR-LORE-014 §2's table (its "project" category is the NEW
  // project_new/KnowGitProject tool, a different thing) — this fixes a misattributed
  // git_project on an EXISTING PR or release, so it's grouped under release_* instead.
  // Flagged in MIGRATION.md as a naming gap in the ADR text, not guessed silently.
  definePostTool(server, {
    name: 'release_mv',
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
    name: 'release_new',
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
    name: 'release_set',
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

  // ── release_link(rel) — collapses release_link_sprint + release_link_pr (2→1) ──
  server.tool(
    'release_link',
    'Attach sprints and/or PRs to a release. rel="sprint": creates IMPLEMENTED_IN_RELEASE edges ' +
      '(KnowSprint → KnowRelease) — use when a sprint is done and shipped in a specific release. ' +
      'rel="pr": upserts KnowPR vertices and creates SHIPPED_IN edges (KnowPR → KnowRelease). ' +
      'MULTI-REPO: always pass git_project — release_uid = "{git_project}#{release_id}". ' +
      'For removing links use release_unlink.',
    {
      release_id:  z.string().describe('target release version, e.g. "v1.6.11"'),
      rel:         z.enum(['sprint', 'pr']),
      ids:         z.array(z.union([z.string(), z.number().int()])).describe('sprint_ids (rel="sprint") or PR numbers (rel="pr")'),
      git_project: z.string().describe('GitHub project slug, e.g. "NooriUta/AIDA"'),
    },
    async ({ release_id, rel, ids, git_project }) => {
      try {
        if (rel === 'sprint') {
          return json(await lorePost('/lore/release/link', { release_id, sprint_ids: ids, pr_numbers: [], git_project }));
        }
        return json(await lorePost('/lore/release/link', { release_id, sprint_ids: [], pr_numbers: ids, git_project }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'release_unlink',
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
    'spec_new',
    'Create or update a specification document (KnowSpec + SCD2 hist). Idempotent — upserts by ' +
      'spec_id. Body fields (content_md/version/summary) are written to the OPEN KnowSpecHist row ' +
      '(created when missing) — the row spec_by_id actually reads. Partial calls are SAFE: omitted ' +
      'fields are left untouched, never wiped. Mutates system_aida_lore.',
    {
      spec_id:      z.string().describe('unique spec id, e.g. "SPEC-AUTH-001"'),
      title:        z.string(),
      version:      z.string().optional().describe('e.g. "1.0.0"'),
      // Правило (v1.0.50): поле-владелец ОБЯЗАНО ехать ребром, иначе связи нет.
      // Паспорт компонента читает out('DOCUMENTED_IN'), а не поле — раньше
      // писалось только поле и спека не появлялась на компоненте (107 вершин).
      // Теперь backend сам держит ребро в синхроне при каждом upsert.
      component_id: z.string().optional().describe(
        'owning component, e.g. "AUTH". Backend keeps the DOCUMENTED_IN edge (component → spec) in sync ' +
        'with this field — the component passport reads the EDGE, not the field, so passing component_id ' +
        'is what actually puts the spec on its component. Omit = leave as is; "" = detach.'),
      content_md:   z.string().optional().describe('spec body in Markdown'),
      summary:      z.string().optional().describe('short abstract shown in lists'),
      file_path:    z.string().optional().describe('source file path relative to docs root'),
      checkpoint:   z.boolean().optional().describe('LH-02: true = body edit opens a NEW hist version (SCD2 close-open, previous edition preserved) instead of amending in place'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/spec', p)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    'spec_set',
    'Amend an EXISTING KnowSpec — same endpoint as spec_new, signature tailored for ' +
      'partial updates (mirror of adr_set). title required by the backend on every write; ' +
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
      checkpoint:   z.boolean().optional().describe('LH-02: true = body amend opens a NEW hist version (SCD2 close-open, previous edition preserved) instead of in-place'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/spec', p)); }
      catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'spec_del',
    description: 'Permanently delete a KnowSpec vertex by spec_id. Mutates system_aida_lore.',
    schema: { spec_id: z.string() },
    path: '/lore/spec/delete',
    body: ({ spec_id }) => ({ spec_id }),
  });

  server.tool(
    'tech_set',
    '(SPRINT_TECH_REGISTRY) Register or update one technology entry (version + release date + ' +
      'license + source + our own release + usage) for a component — e.g. "ArcadeDB 26.6.1" under YGG. ' +
      'Prevents re-verifying facts already checked this session (the recurring pain this sprint exists ' +
      'for). Stored as one KnowSpec per (component, tech) via the existing spec-upsert path — spec_id ' +
      '"SPEC-TECH-<COMPONENT>-<TECH>", title=tech_name, version=tech version, content_md=a small ' +
      'bullet list of release_date/our_release/license/usage/source_url/checked_at. Idempotent — ' +
      'upserts by that id. Read back via query_slice(slice="tech_registry", params={component: ' +
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
    'qg_new',
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
    'runbook_new',
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
    'doc_new',
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
        'leave the current parent untouched. For reparenting without touching content, use doc_link(rel:"parent") instead.'),
      sort_order: z.number().int().optional().describe(
        'Position among sibling pages under the same parent (used for tree ordering and prev/next navigation).'),
    },
    async (p) => {
      try { return json(await lorePost('/lore/doc', p)); }
      catch (e) { return err(e); }
    },
  );

  // ── doc_link(rel) — collapses doc_link_parent/component/sprint (3→1) ──
  server.tool(
    'doc_link',
    'Link (or unlink) a KnowDoc to another entity. rel="parent": DOC_CHILD_OF edge (DeepWiki-style page ' +
      'tree) — a doc has at most one parent, action="add" always replaces any existing parent edge first ' +
      '(so moving a page is one call); action="remove" detaches to top level (target_id not needed). ' +
      'rel="component": BELONGS_TO edge, target_id=component_id. rel="sprint": IMPLEMENTED_IN edge, ' +
      'target_id=sprint_id. Idempotent on add. Mutates system_aida_lore.',
    {
      doc_id:    z.string().describe('e.g. "guide_onboarding"'),
      rel:       z.enum(['parent', 'component', 'sprint']),
      target_id: z.string().optional().describe('parent_doc_id / component_id / sprint_id, matching rel — optional only for rel="parent"+action="remove"'),
      action:    z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ doc_id, rel, target_id, action }) => {
      try {
        const act = action ?? 'add';
        if (rel === 'parent') {
          return json(await lorePost('/lore/doc/parent', { doc_id, parent_doc_id: target_id ?? null, action: act }));
        }
        if (!target_id) return err(new Error(`target_id required for rel="${rel}"`));
        if (rel === 'component') {
          return json(await lorePost('/lore/doc/component', { doc_id, component_id: target_id, action: act }));
        }
        return json(await lorePost('/lore/doc/sprint', { doc_id, sprint_id: target_id, action: act }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'doc_del',
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
    'task_set',
    'Edit one task OR a batch of tasks (title, note_md, effort_days, author/executor/reviewer_agent). ' +
      'Updates the vertex and its open history row. Only supplied fields are touched — omit a field to ' +
      'leave it unchanged. reviewer_agent must differ from executor_agent before the task can move to ' +
      'done (ADR-LORE-014 §4 hard gate, enforced in status_set, not here). ' +
      'Mutates the shared system_aida_lore.\n\n' +
      'Single: pass task_uid + title (+ optional note_md, effort_days, author/executor/reviewer_agent).\n' +
      'Batch:  pass tasks=[{task_uid, title, ...}, ...] — all processed in one call, ' +
      'errors collected per-item without aborting the rest.',
    {
      task_uid:       z.string().optional().describe('single-mode: full task uid, e.g. "SPRINT_X/SH-1"'),
      title:          z.string().optional().describe('single-mode: new title'),
      note_md:        z.string().optional().describe('single-mode: Markdown note (replaces existing)'),
      effort_days:    z.number().optional().describe('single-mode: estimated effort in person-days, fractional to the hour (1 day = 8h, e.g. 0.125)'),
      author_agent:   z.string().optional().describe('single-mode: who owns/posed this task'),
      executor_agent: z.string().optional().describe('single-mode: who is expected to do the work'),
      reviewer_agent: z.string().optional().describe('single-mode: who accepts it — must differ from executor_agent'),
      task_type:      z.string().optional().describe('single-mode: ADR-LORE-015 classification (planning|design|dev|test|ops|research|analytics|docs|content)'),
      work_class:     z.enum(['uc', 'jtd', 'enb']).optional().describe('single-mode: ADR-LORE-022 WHY-axis, orthogonal to task_type'),
      tasks: z.array(z.object({
        task_uid:       z.string(),
        title:          z.string(),
        note_md:        z.string().optional(),
        effort_days:    z.number().optional(),
        author_agent:   z.string().optional(),
        executor_agent: z.string().optional(),
        reviewer_agent: z.string().optional(),
        task_type:      z.string().optional(),
        work_class:     z.enum(['uc', 'jtd', 'enb']).optional(),
      })).optional().describe('batch-mode: array of {task_uid, title, note_md?, effort_days?, author_agent?, executor_agent?, reviewer_agent?, task_type?}'),
    },
    async ({ task_uid, title, note_md, effort_days, author_agent, executor_agent, reviewer_agent, task_type, work_class, tasks }) => {
      try {
        if (tasks && tasks.length > 0) {
          return json(await lorePost('/lore/task/edit/batch',
            tasks.map(t => ({
              task_uid: t.task_uid, title: t.title, note_md: t.note_md ?? null, effort_days: t.effort_days ?? null,
              author_agent: t.author_agent ?? null, executor_agent: t.executor_agent ?? null, reviewer_agent: t.reviewer_agent ?? null,
              task_type: t.task_type ?? null, work_class: t.work_class ?? null,
            }))));
        }
        if (!task_uid || !title) return err(new Error('provide either tasks[] (batch) or task_uid+title (single)'));
        return json(await lorePost('/lore/task/edit', {
          task_uid, title, note_md: note_md ?? null, effort_days: effort_days ?? null,
          author_agent: author_agent ?? null, executor_agent: executor_agent ?? null, reviewer_agent: reviewer_agent ?? null,
          task_type: task_type ?? null, work_class: work_class ?? null,
        }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'component_new',
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
    name: 'qg_job_new',
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
    name: 'rec_new',
    description: 'Upsert a QGRecommendation vertex and wire a PRODUCED edge from the parent QGJobTask. ' +
      'Call after qg_job_new when you want to suggest a remediation action. ' +
      'Status starts as "pending" until the user confirms via rec_promote. ' +
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
    'qg_run_log',
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
    name: 'rec_promote',
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
      task_type: z.string().optional().describe('KnowTask.task_type override — defaults to "research" (ADR-LORE-015: Analyst owns research) when omitted'),
    },
    path: '/lore/qg/promote',
    body: ({ rec_id, sprint_id, task_uid, title, note_md, task_type }) => ({
          rec_id, sprint_id: sprint_id ?? null,
          task_uid: task_uid ?? null, title: title ?? null, note_md: note_md ?? null,
          task_type: task_type ?? null,
        }),
  });

  definePostTool(server, {
    name: 'component_set',
    description: 'Update metadata fields on an existing LoreComponent vertex (partial update — only supplied fields written). ' +
      'Covers full_name, area, team, game_icon, owner, parent_id. ' +
      'Use to rename, re-assign owner/team, fix icon slug, or reparent a component. ' +
      'Does NOT create a new component — use component_new for that.',
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
  // Sub-namespaced per ADR-LORE-014 §2's own table (bragi_pub_new, bragi_channel_set, …)
  // rather than flattened bragi_new/bragi_set — BRAGI covers 9+ distinct sub-entities,
  // and a flat verb-only name would collide across all of them.
  definePostTool(server, {
    name: 'bragi_rubric_set',
    description: 'BragiRubric: create/amend a rubric — the fixed classifier list assigned to publications ' +
      '(bragi_pub_new) and keywords (bragi_keyword_set) via rubric_id (upsert by rubric_id, ' +
      'partial-safe). This is a single, editorially-curated list, not a freeform tag — check query_slice ' +
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
    name: 'bragi_channel_set',
    description: 'BragiChannel: create/amend a distribution channel (e.g. CH-TG, CH-SITE) — upsert by channel_id, ' +
      'partial-safe (omitted fields left untouched). Gap found 2026-07-03: there was no write path for ' +
      'this type — CH-TG\'s seeded url_handle ("t.me/seidr") was stale, no tool existed to fix it. ' +
      '`rules_md` (VAL-00, added 2026-07-03) holds the platform\'s structural limits/style rules as free-text ' +
      'markdown — VAL-01\'s validator engine reads it to check drafts before publish (e.g. TG caption/post/poll ' +
      'char limits, VC footer-link policy, Habr code-block rules). Check query_slice "bragi_channels" for ' +
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

  // ── Project (KnowGitProject, T15) ─────────────────────────────────────────
  // First real write path for KnowGitProject — previously only ever created via a
  // direct ArcadeDB INSERT (no MCP tool, no REST endpoint). sprint_link(rel:"project"),
  // release_new, and release_mv all assume the target vertex already exists and
  // silently no-op (ok:true, no edge/vertex written) otherwise. RBAC: pm+architect+full
  // only (ADR-LORE-014 §3 amendment) — see agent-profiles/pm.json and architect.json.
  definePostTool(server, {
    name: 'project_new',
    description: 'Create or update a KnowGitProject vertex (upsert by slug, partial-safe — omitted ' +
      'fields left untouched). Register a repo BEFORE sprint_link(rel:"project"), release_new, or ' +
      'release_mv reference it — those all silently no-op if the git_project slug has no matching ' +
      'vertex yet. RBAC: pm + architect + full only.',
    schema: {
      slug: z.string().describe('e.g. "NooriUta/UnlimitedLORE" (GitHub) or "AIDA/aida-root@forgejo" (Forgejo)'),
      name: z.string().optional().describe('human-readable project name, e.g. "UnlimitedLORE"'),
      // ADR-LORE-018: hosting entries (origin + mirrors). URL is composed at read
      // time from the template, so a repo move is a one-record fix, not a rewrite.
      hosts: z.array(z.object({
        remote: z.string().describe('remote name, e.g. "origin" | "github"'),
        role: z.enum(['primary', 'mirror']),
        base_url: z.string().describe('e.g. "http://localhost:3030/AIDA/UnlimitedLORE"'),
        file_url_template: z.string().describe('e.g. "{base}/src/branch/{branch}/{path}" (Forgejo) | "{base}/blob/{branch}/{path}" (GitHub)'),
        pr_url_template: z.string().describe('e.g. "{base}/pulls/{n}" (Forgejo) | "{base}/pull/{n}" (GitHub)'),
        default_branch: z.string().optional(),
      })).optional().describe('origin + mirrors; stored as JSON, URL composed on read'),
      default_branch: z.string().optional().describe('repo default branch, e.g. "develop"'),
    },
    path: '/lore/project',
    body: ({ slug, name, hosts, default_branch }) => ({
      slug,
      name: name ?? null,
      hosts: hosts ? JSON.stringify(hosts) : null,
      default_branch: default_branch ?? null,
    }),
  });

  // ── ADR-LORE-012: dictionary entries (KnowDictEntry) ─────────────────────
  definePostTool(server, {
    name: 'dict_set',
    description: 'KnowDictEntry (ADR-LORE-012): create/amend one dictionary value as a graph vertex — upsert by ' +
      '(dict_type, code), partial-safe for metadata (label/color/icon/sort_order left untouched when omitted; ' +
      'is_active defaults true, is_extensible false on create). Single canon read by frontend (useDictionary), ' +
      'backend and MCP via query_slice "dictionary". dict_type e.g. "sprint_status"|"task_status"|"adr_status"|' +
      '"priority"|"artifact_kind"|"area"|"agent_role"|"task_type"|"bragi_channel"|"tag". color prefers a CSS token like "var(--suc)". ' +
      'Check query_slice "dictionary" (optionally dict_type=...) before adding. Mutates the shared system_aida_lore.',
    schema: {
      dict_type:     z.string().describe('domain, e.g. "sprint_status", "priority", "area", "agent_role"'),
      code:          z.string().describe('stable key, e.g. "done", "P0", "PROPOSED", "runbook"'),
      label_ru:      z.string().optional(),
      label_en:      z.string().optional(),
      color:         z.string().optional().describe('CSS token preferred, e.g. "var(--suc)"'),
      icon:          z.string().optional().describe('game-icons slug, e.g. "divided-spiral"'),
      sort_order:    z.number().int().optional().describe('display order within the domain'),
      is_active:     z.boolean().optional().describe('soft-delete flag; default true'),
      is_extensible: z.boolean().optional().describe('true = admins may add values via UI; default false'),
    },
    path: '/lore/dict/entry',
    body: ({ dict_type, code, label_ru, label_en, color, icon, sort_order, is_active, is_extensible }) =>
      ({ dict_type, code, label_ru, label_en, color, icon, sort_order, is_active, is_extensible }),
  });

  server.tool(
    'bragi_search',
    'Searches BragiKeyword by a case-insensitive substring of phrase, returning keyword_id/phrase/cluster for ' +
      'matches (max 20). Use this to resolve a keyword_id from a phrase BEFORE calling bragi_keyword_set, ' +
      'bragi_link(rel:"rubric"), or the keyword_ids param on bragi_pub_new — those all require an already-known id.',
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
    name: 'bragi_pub_new',
    description: 'BragiPublication: create/amend a content publication (upsert by publication_id, partial-safe). ' +
      'The main-text master version that groups per-channel variants (see bragi_variant_new). ' +
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
    name: 'bragi_variant_new',
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

  // bragi_asset_up / bragi_asset_attach: ADR-LORE-014 §2's table names these
  // doc_asset_up/doc_asset_attach under the "doc" category, but they operate on
  // BragiAsset (paths /lore/bragi/asset/upload, /lore/bragi/asset), not KnowDoc —
  // renamed to match what they actually touch; flagged as an ADR-text inconsistency
  // to fix separately (not a code bug), see MIGRATION.md.
  // ADR-LORE-031 (PL-22): generic-ассет для MD-поля ЛЮБОЙ сущности. В отличие от
  // bragi_asset_up (плоский bragi/{uuid}, отдельный attach-вызов), здесь ключ —
  // контент-адрес {entity_type}/{entity_id}/{sha256-16}.{ext}, а вершина KnowAsset
  // и ребро ATTACHED_TO создаются тем же запросом: ассет-сирота невозможен.
  server.tool(
    'asset_up',
    'Upload a base64-encoded image and attach it to an existing LORE entity in one call (ADR-LORE-031). ' +
      'Key is content-addressed ({entity_type}/{entity_id}/{sha256-16}.{ext}) — re-uploading identical bytes ' +
      'dedupes to the same key. The response carries `md` — a ready ![alt](url) snippet to paste into the ' +
      'entity\'s *_md body (MartProse renders it). Fails 404 if the entity does not exist (nothing is written), ' +
      '400 on non-image mime, 409 when md_images_enabled=false in admin settings.',
    {
      entity_type: z.enum(['adr', 'sprint', 'task', 'feature', 'uc', 'actor', 'component',
        'spec', 'doc', 'runbook', 'question', 'decision', 'milestone']),
      entity_id: z.string().describe('key of the target entity, e.g. "ADR-LORE-031" or "SPRINT_X/T-1"'),
      filename: z.string().describe('original filename, e.g. "vp-canvas.svg" — extension comes from mime, not from here'),
      base64_data: z.string().describe('raw file bytes, base64-encoded (no data: URI prefix)'),
      content_type: z.string().describe('image/png | image/jpeg | image/webp | image/gif | image/svg+xml'),
      alt: z.string().optional().describe('alt-текст — попадает в готовый md-сниппет'),
    },
    async ({ entity_type, entity_id, filename, base64_data, content_type, alt }) => {
      try {
        return json(await loreUpload('/lore/asset/upload', filename, base64_data, content_type,
          { entity_type, entity_id, ...(alt ? { alt } : {}) }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    'bragi_asset_up',
    'Uploads a base64-encoded image file to BRAGI\'s S3-backed asset store (MinIO), returning a same-origin ' +
      'file_url ("/lore/bragi/asset/file/..."). This is the ONLY way to get a real, browser-loadable file_url — ' +
      'there is no separate "presign" step. Call this FIRST, then pass its file_url into bragi_asset_attach ' +
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
    name: 'bragi_asset_attach',
    description: 'BragiAsset: create/amend an image/media asset (upsert by asset_id, partial-safe) and optionally attach it ' +
      'via HAS_ASSET to an existing BragiPublication (cover) or BragiVariant (per-channel image) — pass exactly ' +
      'one of attach_to_publication_id/attach_to_variant_id, not both. file_url should come from bragi_asset_up ' +
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
    name: 'bragi_keyword_set',
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
    name: 'bragi_page_set',
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
    name: 'bragi_campaign_new',
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
    name: 'metric_log',
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
    'metric_get',
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
    name: 'bragi_integration_new',
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
    name: 'insight_new',
    description: 'BragiInsight: create/amend a data-driven conclusion (upsert by insight_id, partial-safe). ' +
      'evidence_ref is a freeform pointer to the supporting measurement/date-range (MetricSnapshot rows ' +
      'don\'t carry graph edges, so this is text, not an edge). Use insight_link to connect it to a ' +
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
    name: 'insight_link',
    description: 'Wire a LED_TO edge from an existing BragiInsight to a Forseti KnowTask or KnowADR — records that this ' +
      'insight drove a concrete follow-up. Idempotent. rel picks the target type (task|adr) — kept as ' +
      '"rel" for naming symmetry with the other *_link tools (was "target_type").',
    schema: {
      insight_id: z.string(),
      rel:        z.enum(['task', 'adr']),
      target_id:  z.string().describe('task_uid if rel="task", adr_id if rel="adr"'),
    },
    path: '/lore/bragi/insight/link',
    body: ({ insight_id, rel, target_id }) => ({ insight_id, target_type: rel, target_id }),
  });

  // ── bragi_link(rel) — collapses bragi_link_rubric + bragi_link_forseti (2→1) ──
  // Flagged as the messiest collapse in ADR-LORE-014 §2 (Explore-agent research,
  // 2026-07-14): the two source tools each carry their OWN polymorphic entity_type
  // axis independent of the edge type. Resolved by making `rel` the edge/purpose
  // and keeping entity_type/target_type as rel-conditional side params rather than
  // trying to force one flat parameter shape across both.
  server.tool(
    'bragi_link',
    'Link (or unlink) a BragiPublication/BragiVariant/BragiKeyword to another entity. rel="rubric": assigns ' +
      '(replaces) ONE rubric via IN_RUBRIC — entity_type: publication|keyword, target_id=rubric_id. ' +
      'rel="produced_by": PRODUCED_BY edge into the Forseti work graph — entity_type: publication|variant, ' +
      'target_type: task|sprint, target_id=task_uid or sprint_id. rel="shipped_in": SHIPPED_IN edge — ' +
      'entity_type: publication|variant, target_id=release_id/tag, pass git_project for multi-repo release ' +
      'safety (release_uid = "{git_project}#{target_id}"). Idempotent on add. Mutates system_aida_lore.',
    {
      rel:         z.enum(['rubric', 'produced_by', 'shipped_in']),
      entity_type: z.enum(['publication', 'keyword', 'variant']).describe('rel="rubric": publication|keyword. rel="produced_by"/"shipped_in": publication|variant'),
      entity_id:   z.string().describe('publication_id / keyword_id / variant_id, matching entity_type'),
      target_type: z.enum(['task', 'sprint']).optional().describe('rel="produced_by" only: which kind of target_id'),
      target_id:   z.string().describe('rubric_id (rel="rubric") / task_uid or sprint_id (rel="produced_by") / release_id (rel="shipped_in")'),
      git_project: z.string().optional().describe('rel="shipped_in" only: GitHub project slug for release_uid resolution, e.g. "NooriUta/UnlimitedLORE"'),
      action:      z.enum(['add', 'remove']).optional().default('add'),
    },
    async ({ rel, entity_type, entity_id, target_type, target_id, git_project, action }) => {
      try {
        const act = action ?? 'add';
        if (rel === 'rubric') {
          return json(await lorePost('/lore/bragi/rubric/link', { entity_type, entity_id, rubric_id: target_id }));
        }
        const edge_type = rel === 'produced_by' ? 'PRODUCED_BY' : 'SHIPPED_IN';
        const resolvedTargetType = rel === 'produced_by' ? (target_type ?? 'task') : 'release';
        return json(await lorePost('/lore/bragi/link', {
          entity_type, entity_id, edge_type, target_type: resolvedTargetType, target_id,
          git_project: git_project ?? null, action: act,
        }));
      } catch (e) { return err(e); }
    },
  );

  definePostTool(server, {
    name: 'bragi_sync',
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
