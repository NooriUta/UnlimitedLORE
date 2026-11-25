import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// SPRINT_LORE_KNOW_REGISTRY/SKILL-01/02 — вид skill:* на текущем MCP (SPEC-SKILLS-TAGS-062 §5–§7):
// skill_new / skill_set / skill_link и их обобщённые двойники entity_upsert type=skill / entity_link
// type=skill ходят одними путями (/lore/skill, /lore/skill/link) и одними телами; гарды — у бэкенда.

type Call = { path: string; body: Record<string, unknown> };
const calls: Call[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => {
    calls.push({ path, body });
    return { ok: true };
  }),
  loreGet: vi.fn(async () => ({ hits: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');
const { LEGACY_CRUD_TOOLS } = await import('./entity.js');

const tools = collect(registerLoreWrite);
const byName = Object.fromEntries(tools.map(t => [t.name, t]));

async function run(name: string, args: Record<string, unknown>): Promise<Call[]> {
  calls.length = 0;
  await byName[name].handler(args);
  return calls.map(c => ({ ...c }));
}

const P = 'NooriUta/UnlimitedLORE';

describe('skill_new / skill_set', () => {
  it('skill_new шлёт /lore/skill, extends → extends_ids', async () => {
    const c = await run('skill_new', {
      skill_id: 'skill:qg-triage', title: 't', body_md: 'b', projects: [P], roles: ['full'], extends: ['skill:base'],
    });
    expect(c.map(x => x.path)).toEqual(['/lore/skill']);
    expect(c[0].body).toMatchObject({ skill_id: 'skill:qg-triage', projects: [P], roles: ['full'], extends_ids: ['skill:base'] });
    expect(c[0].body).not.toHaveProperty('extends');
  });

  it('skill_set — тот же путь (upsert)', async () => {
    const c = await run('skill_set', { skill_id: 'skill:qg-triage', status: 'active' });
    expect(c).toEqual([{ path: '/lore/skill', body: { skill_id: 'skill:qg-triage', status: 'active' } }]);
  });

  it('entity_upsert type=skill — паритет со skill_new', async () => {
    const c = await run('entity_upsert', {
      type: 'skill', id: 'skill:qg-triage', fields: { title: 't', body_md: 'b', projects: [P], roles: ['full'], extends: ['skill:base'] },
    });
    expect(c.map(x => x.path)).toEqual(['/lore/skill']);
    expect(c[0].body).toEqual({ skill_id: 'skill:qg-triage', title: 't', body_md: 'b', projects: [P], roles: ['full'], extends_ids: ['skill:base'] });
  });

  it('entity_upsert type=skill называет поле, которого у навыка нет', async () => {
    const r = await byName.entity_upsert.handler({ type: 'skill', id: 'skill:x', fields: { title: 't', colour: 'red' } });
    expect(JSON.stringify(r)).toContain('colour');
  });
});

describe('skill_link / entity_link type=skill', () => {
  for (const rel of ['role', 'project', 'extends', 'owner'] as const) {
    it(`rel=${rel} → /lore/skill/link`, async () => {
      const a = await run('skill_link', { skill_id: 'skill:a', rel, target_id: 'X', action: 'remove' });
      const b = await run('entity_link', { type: 'skill', id: 'skill:a', rel, target_id: 'X', action: 'remove' });
      const want = { path: '/lore/skill/link', body: { skill_id: 'skill:a', rel, target_id: 'X', action: 'remove' } };
      expect(a).toEqual([want]);
      expect(b).toEqual([want]);
    });
  }

  it('чужой rel для type=skill — отказ со списком', async () => {
    const r = await byName.entity_link.handler({ type: 'skill', id: 'skill:a', rel: 'component', target_id: 'X' });
    expect(JSON.stringify(r)).toContain('role, project, extends, owner');
  });
});

describe('поверхность по умолчанию', () => {
  it('skill_new/skill_set/skill_link — заменены entity_* (скрыты у full по умолчанию)', () => {
    for (const t of ['skill_new', 'skill_set', 'skill_link']) expect(LEGACY_CRUD_TOOLS).toContain(t);
  });
});
