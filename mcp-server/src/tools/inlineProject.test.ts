import { beforeEach, describe, expect, it, vi } from 'vitest';

// AL-113: проект прямо в создающем вызове — тем же путём, что *_link(rel:"project").

const sent: { path: string; body: Record<string, unknown> }[] = [];
let linkAnswer: Record<string, unknown> = { ok: true };

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => {
    sent.push({ path, body });
    return path.endsWith('/project') || path.endsWith('/link') ? linkAnswer : { ok: true };
  }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { inlineProject } = await import('./loreWrite.js');

describe('AL-113: проект в создающем вызове', () => {
  beforeEach(() => { sent.length = 0; linkAnswer = { ok: true }; });

  it('явный project ставит ребро тем же путём, что adr_link', async () => {
    const r = await inlineProject('adr', 'ADR-X', 'org/a');
    expect(sent).toEqual([{ path: '/lore/adr/project', body: { adr_id: 'ADR-X', project: 'org/a', action: 'add' } }]);
    expect(r).toMatchObject({ project: 'org/a', project_source: 'param', project_linked: true });
  });

  it('спека — через spec/link с rel=project и mode=add (не replace: проектов бывает несколько)', async () => {
    await inlineProject('spec', 'SPEC-X', 'org/a');
    expect(sent[0]).toEqual({ path: '/lore/spec/link', body: { spec_id: 'SPEC-X', target_id: 'org/a', rel: 'project', mode: 'add' } });
  });

  // AL-113 хвост: сценарий (uc_new) и корень-фича (feature_new — тот же KnowUseCase)
  // принимали проект только вторым вызовом uc_link — теперь одним, тем же путём.
  it('сценарий/фича — через uc/link с rel=project и action=add', async () => {
    await inlineProject('uc', 'UC-X', 'org/a');
    expect(sent[0]).toEqual({ path: '/lore/uc/link', body: { uc_id: 'UC-X', rel: 'project', target_id: 'org/a', action: 'add' } });
  });

  it('без project и без LORE_ACTIVE_PROJECT рёбра не трогаются и в ответе ничего не добавляется', async () => {
    expect(await inlineProject('doc', 'd1')).toEqual({});
    expect(sent).toEqual([]);
  });

  it('незарегистрированный слаг — project_linked:false, а не тихий успех', async () => {
    linkAnswer = { ok: true, linked: false, hint: 'project not registered' };
    const r = await inlineProject('question', 'Q-1', 'nobody/none');
    expect(r.project_linked).toBe(false);
  });

  it('ребро уже было (outcome=unchanged при linked:false) — это успех, а не провал', async () => {
    linkAnswer = { ok: true, linked: false, outcome: 'unchanged' };
    expect((await inlineProject('adr', 'ADR-X', 'org/a')).project_linked).toBe(true);
  });

  it('outcome=noop — провал, даже если старый ключ linked отсутствует', async () => {
    linkAnswer = { ok: true, outcome: 'noop', reason: 'проект не найден' };
    expect((await inlineProject('runbook', 'RB-1', 'org/x')).project_linked).toBe(false);
  });

  it('сбой ребра не роняет уже записанную сущность — ошибка в ответе', async () => {
    const { lorePost } = await import('../backend.js');
    (lorePost as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new Error('POST → 400'));
    const r = await inlineProject('runbook', 'RB-1', 'org/a');
    expect(r).toMatchObject({ project_linked: false, project_error: 'POST → 400' });
  });
});
