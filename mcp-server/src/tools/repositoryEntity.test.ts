import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// Реестр репозиториев через MCP (решение владелицы 22.11.2026: «а что я, пусть доделывает MCP»).
//
// Повод: сверка 22.11.2026 показала 13 репозиториев Forgejo, которых в реестре LORE нет вовсе, четыре без проекта
// и ни одной связи «использует». Записать это было нечем — вершины и рёбра создавал только инструмент переноса,
// то есть реестр чинился раз в миграцию. Эти проверки держат дверь на месте: тип repository у entity_upsert и
// связи project/component/uses/mirror у entity_link.
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
const tools = collect(registerLoreWrite);
const byName = Object.fromEntries(tools.map(t => [t.name, t]));

async function run(name: string, args: Record<string, unknown>): Promise<Call[]> {
  calls.length = 0;
  await byName[name].handler(args);
  return calls.map(c => ({ ...c }));
}

describe('реестр репозиториев: дверь записи через MCP', () => {
  const URL = 'https://git.example.org/ORG/repo';

  it('entity_upsert type=repository шлёт адрес ключом на /lore/repository', async () => {
    const c = await run('entity_upsert', { type: 'repository', id: URL, fields: { default_branch: 'main' } });
    expect(c).toHaveLength(1);
    expect(c[0].path).toBe('/lore/repository');
    expect(c[0].body.url).toBe(URL);
    expect(c[0].body.default_branch).toBe('main');
  });

  it('связь «проект» уходит ребром проекта к репозиторию, с ролью', async () => {
    const c = await run('entity_link', {
      type: 'repository', id: URL, rel: 'project', target_id: 'NooriUta/UnlimitedLORE', fields: { role: 'primary' },
    });
    expect(c[0].path).toBe('/lore/repository/link');
    expect(c[0].body).toMatchObject({ url: URL, rel: 'project', target: 'NooriUta/UnlimitedLORE', role: 'primary', action: 'add' });
  });

  it('связь «использует» — между репозиториями, снятие передаётся действием', async () => {
    const c = await run('entity_link', {
      type: 'repository', id: URL, rel: 'uses', target_id: 'https://git.example.org/ORG/kit', action: 'remove',
    });
    expect(c[0].body).toMatchObject({ rel: 'uses', target: 'https://git.example.org/ORG/kit', action: 'remove' });
  });

  it('неизвестная связь — отказ со списком, а не тихий вызов', async () => {
    const r = await byName.entity_link.handler({ type: 'repository', id: URL, rel: 'tag', target_id: 'x' });
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('компонент и зеркало — тоже связи реестра', async () => {
    for (const [rel, target] of [['component', 'LORE_BACKEND'], ['mirror', 'https://github.com/NooriUta/UnlimitedLORE']]) {
      const c = await run('entity_link', { type: 'repository', id: URL, rel, target_id: target });
      expect(c[0].body).toMatchObject({ rel, target });
    }
  });
});
