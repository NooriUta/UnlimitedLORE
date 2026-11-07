import { describe, expect, it, vi } from 'vitest';

// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, A13 (06.11.2026): слаг проекта
// исторический: в реестре NooriUta/volva, а репозиторий живёт в AIDA/volva — агент
// передаёт настоящий путь репо, и тот давал тихий
// noop — сущность записана, а к проекту не привязана, и вызывающий узнаёт это
// через день по ленте. Переименовывать слаги нельзя; чинится подсказкой
// «ближайший слаг в реестре» прямо в ответе.

const REGISTRY = [
  { slug: 'NooriUta/volva' }, { slug: 'NooriUta/UnlimitedLORE' }, { slug: 'AIDA/miniLORE' }, { slug: 'AIDA/GLADSHEIM' },
];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async () => ({ ok: true, outcome: 'noop' })),
  loreGet: vi.fn(async (path: string) => (path.endsWith('/git_projects') ? { rows: REGISTRY } : { rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { nearestSlug, inlineProject } = await import('./loreWrite.js');

describe('неверный слаг проекта получает подсказку', () => {
  const slugs = REGISTRY.map(r => r.slug);

  it('то же имя репозитория у другого владельца', () => {
    // Реальное направление (реестр прода 06.11): настоящий путь репо → исторический слаг.
    expect(nearestSlug('AIDA/volva', slugs)).toBe('NooriUta/volva');
  });
  it('регистр', () => {
    expect(nearestSlug('nooriuta/unlimitedlore', slugs)).toBe('NooriUta/UnlimitedLORE');
  });
  it('опечатка', () => {
    expect(nearestSlug('AIDA/GLADSHEM', slugs)).toBe('AIDA/GLADSHEIM');
  });
  it('ничего похожего — подсказки нет, а не случайная', () => {
    expect(nearestSlug('Foo/Bar', slugs)).toBeNull();
  });

  it('inlineProject при noop называет ближайший слаг', async () => {
    const r = await inlineProject('question', 'Q-X', 'AIDA/volva');
    expect(r.project_linked).toBe(false);
    expect(r.did_you_mean).toBe('NooriUta/volva');
    expect(String(r.project_hint)).toContain('NooriUta/volva');
  });
});
