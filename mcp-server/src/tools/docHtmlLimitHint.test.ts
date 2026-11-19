import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// Случай (19.11.2026): подсказка doc_new.content_html обещала «100 KB max», а
// лимита нет — LoreDocResource размер не проверяет, обрезка до 100 000 символов
// есть только при импорте файлов с диска (KnowDocParser). Ложный лимит заставлял
// агентов резать или не переносить большие HTML-отчёты.
//
// Правило: описание поля говорит правду — ограничения размера нет, HTML рисуется
// в песочнице, для новых доков предпочтителен Markdown.

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async () => ({ ok: true })),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

describe('doc_new: подсказка content_html не обещает несуществующий лимит', () => {
  const tools = collect(registerLoreWrite);
  const docNew = tools.find(t => t.name === 'doc_new')!;
  const field = (docNew.schema as Record<string, { description?: string }>).content_html;

  it('поле content_html есть и описано (положительный контроль)', () => {
    expect(field).toBeDefined();
    expect(field.description).toBeTruthy();
  });

  it('нет ложного «100 KB max», сказано, что лимита нет', () => {
    const d = field.description!;
    expect(d).not.toMatch(/100\s*KB/i);
    expect(d).toMatch(/no size limit/i);
  });

  it('говорит про песочницу и отсылает к Markdown-полям', () => {
    const d = field.description!;
    expect(d).toMatch(/sandbox/i);
    expect(d).toContain('content_md_ru');
    expect(d).toContain('content_md_en');
  });
});
