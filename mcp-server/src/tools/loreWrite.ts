import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lorePost } from '../backend.js';

const json = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${(e as Error).message ?? String(e)}` }],
  isError: true,
});

export function registerLoreWrite(server: McpServer): void {
  // SCD2 status transition (closes the open history row, opens a new one, edges,
  // denormalizes status onto the vertex). Writes to the shared system_aida_lore.
  server.tool(
    'lore_set_status',
    'Set the status of a LORE entity (SCD2 transition). Mutates the shared ' +
      'system_aida_lore — use deliberately. Returns the new revision.',
    {
      entity_type: z.enum(['plan_item', 'sprint', 'task', 'checkpoint']),
      id: z.string().describe('entity id (e.g. sprint_id, task_uid, item_id, checkpoint_id)'),
      status: z.enum(['todo', 'active', 'partial', 'done', 'blocked', 'high', 'cancelled']),
    },
    async ({ entity_type, id, status }) => {
      try {
        return json(await lorePost('/lore/status', { entity_type, id, status }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_create_task',
    'Create a new task under a sprint (appends with the next order_index, opens an ' +
      'initial PLANNED history state). Mutates the shared system_aida_lore.',
    {
      sprint_id: z.string(),
      task_id: z.string().describe('short task id, unique within the sprint'),
      title: z.string(),
      note_md: z.string().optional().describe('optional Markdown note'),
    },
    async ({ sprint_id, task_id, title, note_md }) => {
      try {
        return json(await lorePost('/lore/task', { sprint_id, task_id, title, note_md: note_md ?? null }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    'lore_edit_task',
    'Edit a task title and/or note (updates the vertex and its open history row). ' +
      'Mutates the shared system_aida_lore.',
    {
      task_uid: z.string().describe('full task uid, e.g. "<sprint_id>/<task_id>"'),
      title: z.string(),
      note_md: z.string().optional(),
    },
    async ({ task_uid, title, note_md }) => {
      try {
        return json(await lorePost('/lore/task/edit', { task_uid, title, note_md: note_md ?? null }));
      } catch (e) {
        return err(e);
      }
    },
  );
}
