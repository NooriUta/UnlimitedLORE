import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-06 — «Правила CLAUDE: дифф с файлом».
 * Файл живёт на машине, LORE его не видит — поэтому дифф считает MCP рядом с файлом:
 * claude_rules_diff читает файл, берёт док и отвечает, совпадают ли они и чем расходятся.
 */

let fileBody: string | Error = '';
let docRows: unknown[] = [];

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => { if (fileBody instanceof Error) throw fileBody; return fileBody; }),
  writeFile: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
}));
vi.mock('../backend.js', () => ({
  lorePost: vi.fn(async () => ({ ok: true })),
  loreSlice: vi.fn(async () => docRows),
}));

const { registerClaudeRules, lineDiff } = await import('./claudeRules.js');

type Handler = (a: Record<string, unknown>) => Promise<{ isError?: boolean; content: { text: string }[] }>;
function tool(name: string): Handler {
  const tools: Record<string, Handler> = {};
  registerClaudeRules({ tool: (...a: unknown[]) => { tools[a[0] as string] = a[a.length - 1] as Handler; } } as unknown as McpServer);
  return tools[name];
}

describe('claude_rules_diff', () => {
  beforeEach(() => { fileBody = ''; docRows = []; });

  it('совпадение — in_sync и пустой дифф', async () => {
    fileBody = '# A\nстрока\n';
    docRows = [{ doc_id: 'claude_rules_x', content_md_ru: '# A\nстрока\n' }];
    const r = await tool('claude_rules_diff')({ path: 'C:/x/CLAUDE.md', doc_id: 'claude_rules_x' });
    const out = JSON.parse(r.content[0].text);
    expect(r.isError).toBeFalsy();
    expect(out.in_sync).toBe(true);
    expect(out.added).toBe(0);
    expect(out.removed).toBe(0);
    expect(out.diff).toEqual([]);
  });

  it('расхождение — строки файла с +, строки дока с -, счётчики', async () => {
    fileBody = '# A\nновая\nобщая\n';
    docRows = [{ doc_id: 'claude_rules_x', content_md_ru: '# A\nстарая\nобщая\n' }];
    const out = JSON.parse((await tool('claude_rules_diff')({ path: 'p', doc_id: 'claude_rules_x' })).content[0].text);
    expect(out.in_sync).toBe(false);
    expect(out.added).toBe(1);
    expect(out.removed).toBe(1);
    expect(out.diff).toContain('+новая');
    expect(out.diff).toContain('-старая');
    expect(out.diff).not.toContain(' общая');
  });

  it('CRLF против LF — не расхождение', async () => {
    fileBody = '# A\r\nстрока\r\n';
    docRows = [{ doc_id: 'd', content_md_ru: '# A\nстрока\n' }];
    const out = JSON.parse((await tool('claude_rules_diff')({ path: 'p', doc_id: 'd' })).content[0].text);
    expect(out.in_sync).toBe(true);
  });

  it('дока нет — ошибка, а не «совпадает» и не «всё добавлено»', async () => {
    fileBody = '# A\n';
    const r = await tool('claude_rules_diff')({ path: 'p', doc_id: 'nope' });
    expect(r.isError).toBe(true);
  });

  it('файла нет — ошибка', async () => {
    fileBody = new Error('ENOENT');
    docRows = [{ doc_id: 'd', content_md_ru: '# A\n' }];
    const r = await tool('claude_rules_diff')({ path: 'p', doc_id: 'd' });
    expect(r.isError).toBe(true);
  });
});

describe('lineDiff', () => {
  it('сохраняет порядок и отдаёт только изменённые строки', () => {
    expect(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual(['-b', '+x']);
    expect(lineDiff([], ['a'])).toEqual(['+a']);
    expect(lineDiff(['a'], [])).toEqual(['-a']);
  });
});
