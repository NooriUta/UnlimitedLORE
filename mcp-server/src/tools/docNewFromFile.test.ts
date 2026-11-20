import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// doc_new: тело документа из локального файла (решение владелицы 19.11.2026, вариант «а»).
// Поля content_html_file / content_md_ru_file / content_md_en_file — абсолютные пути на машине
// MCP-сервера; читаются только из корней LORE_MCP_FILE_ROOTS, в режиме по адресу хоста — отказ.

const sent: { path: string; body: Record<string, unknown> }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: Record<string, unknown>) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));
const { registerLoreWrite } = await import('./loreWrite.js');
const { MAX_BODY_FILE_BYTES } = await import('./bodyFile.js');

const base = mkdtempSync(join(tmpdir(), 'doc-new-file-'));
const root = join(base, 'root');
const outside = join(base, 'outside');
mkdirSync(root);
mkdirSync(outside);

const tools = collect(registerLoreWrite);
const docNew = tools.find(t => t.name === 'doc_new')!;
const upsert = tools.find(t => t.name === 'entity_upsert')!;
type Res = { isError?: boolean; content: { text: string }[] };
const call = (a: Record<string, unknown>) => docNew.handler({ doc_id: 'd1', title: 't', project: 'P/R', ...a }) as Promise<Res>;
const text = (r: Res) => r.content.map(c => c.text).join('\n');

const savedEnv = { roots: process.env.LORE_MCP_FILE_ROOTS, transport: process.env.LORE_MCP_TRANSPORT };
beforeEach(() => {
  sent.length = 0;
  process.env.LORE_MCP_FILE_ROOTS = root;
  delete process.env.LORE_MCP_TRANSPORT;
});
afterEach(() => {
  if (savedEnv.roots === undefined) delete process.env.LORE_MCP_FILE_ROOTS; else process.env.LORE_MCP_FILE_ROOTS = savedEnv.roots;
  if (savedEnv.transport === undefined) delete process.env.LORE_MCP_TRANSPORT; else process.env.LORE_MCP_TRANSPORT = savedEnv.transport;
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('doc_new: тело из файла', () => {
  it('файл читается в UTF-8 и уходит в своё поле, путь — нет', async () => {
    const f = join(root, 'body.md');
    writeFileSync(f, '﻿# Заголовок\nтело ✓', 'utf8');
    const r = await call({ content_md_ru_file: f });
    expect(r.isError, text(r)).toBeFalsy();
    // вторым вызовом идёт ребро проекта (inlineProject) — сверяем запись самого дока
    expect(sent.filter(s => s.path === '/lore/doc')).toHaveLength(1);
    expect(sent[0].path).toBe('/lore/doc');
    expect(sent[0].body.content_md_ru).toBe('# Заголовок\nтело ✓');
    expect(sent[0].body).not.toHaveProperty('content_md_ru_file');
  });

  it('все три поля из файлов', async () => {
    writeFileSync(join(root, 'a.html'), '<p>h</p>');
    writeFileSync(join(root, 'b.md'), 'en');
    writeFileSync(join(root, 'c.md'), 'ru');
    const r = await call({
      content_html_file: join(root, 'a.html'),
      content_md_en_file: join(root, 'b.md'),
      content_md_ru_file: join(root, 'c.md'),
    });
    expect(r.isError, text(r)).toBeFalsy();
    expect(sent[0].body).toMatchObject({ content_html: '<p>h</p>', content_md_en: 'en', content_md_ru: 'ru' });
  });

  it('путь вне корня — отказ, бэкенд не вызван', async () => {
    const f = join(outside, 'x.md');
    writeFileSync(f, 'x');
    const r = await call({ content_md_ru_file: f });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/LORE_MCP_FILE_ROOTS/);
    expect(sent).toHaveLength(0);
  });

  it('обход через .. — отказ', async () => {
    writeFileSync(join(outside, 'y.md'), 'y');
    const r = await call({ content_md_ru_file: join(root, '..', 'outside', 'y.md') });
    expect(r.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('симлинк за корень — отказ', async () => {
    writeFileSync(join(outside, 'secret.md'), 'secret');
    // junction на Windows не требует прав администратора; на POSIX тип игнорируется — обычный симлинк каталога.
    symlinkSync(outside, join(root, 'link'), 'junction');
    const r = await call({ content_md_ru_file: join(root, 'link', 'secret.md') });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/LORE_MCP_FILE_ROOTS/);
    expect(sent).toHaveLength(0);
  });

  it('поле и *_file вместе — отказ с именами обоих', async () => {
    const f = join(root, 'both.md');
    writeFileSync(f, 'b');
    const r = await call({ content_md_ru: 'inline', content_md_ru_file: f });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('content_md_ru');
    expect(text(r)).toContain('content_md_ru_file');
    expect(sent).toHaveLength(0);
  });

  it('файл больше 20 МБ — отказ', async () => {
    expect(MAX_BODY_FILE_BYTES).toBe(20 * 1024 * 1024);
    const f = join(root, 'big.md');
    writeFileSync(f, Buffer.alloc(MAX_BODY_FILE_BYTES + 1, 0x61));
    const r = await call({ content_md_en_file: f });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/20 МБ/);
    expect(sent).toHaveLength(0);
  });

  it('относительный путь — отказ', async () => {
    const r = await call({ content_md_ru_file: 'body.md' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/абсолютн/);
  });

  it('не UTF-8 — отказ, а не кракозябры', async () => {
    const f = join(root, 'cp1251.md');
    writeFileSync(f, Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]));
    const r = await call({ content_md_ru_file: f });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/UTF-8/);
  });

  it('режим по адресу хоста — отказ, файл не читается', async () => {
    process.env.LORE_MCP_TRANSPORT = 'http';
    const f = join(root, 'h.md');
    writeFileSync(f, 'h');
    const r = await call({ content_md_ru_file: f });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('в режиме по адресу хоста файл клиента недоступен');
    expect(sent).toHaveLength(0);
  });

  it('содержимое файла не попадает в журнал (ни при успехе, ни при отказе)', async () => {
    const SECRET = 'SECRET-BODY-7f3a91';
    const ok = join(root, 'log-ok.md');
    writeFileSync(ok, SECRET);
    const big = join(root, 'log-big.md');
    writeFileSync(big, SECRET + 'a'.repeat(MAX_BODY_FILE_BYTES));
    const lines: string[] = [];
    const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    const spies = [
      vi.spyOn(console, 'error').mockImplementation(grab),
      vi.spyOn(console, 'log').mockImplementation(grab),
      vi.spyOn(console, 'warn').mockImplementation(grab),
      vi.spyOn(console, 'info').mockImplementation(grab),
      vi.spyOn(console, 'debug').mockImplementation(grab),
      vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { lines.push(String(c)); return true; }) as never),
    ];
    try {
      const r1 = await call({ content_md_ru_file: ok });
      const r2 = await call({ content_md_ru_file: big });
      const r3 = await call({ content_md_ru: 'x', content_md_ru_file: ok });
      expect(r1.isError).toBeFalsy();
      expect(sent[0].body.content_md_ru).toBe(SECRET);  // положительный контроль: содержимое прочитано
      for (const r of [r2, r3]) expect(text(r)).not.toContain(SECRET);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(lines.join('\n')).not.toContain(SECRET);
  });
});

describe('entity_upsert type=doc: те же *_file, без молчаливой потери', () => {
  it('fields.content_md_ru_file читается и уходит содержимым', async () => {
    const f = join(root, 'eu.md');
    writeFileSync(f, 'из файла');
    const r = await upsert.handler({ type: 'doc', id: 'd2', fields: { project: 'P/R', content_md_ru_file: f } }) as Res;
    expect(r.isError, text(r)).toBeFalsy();
    expect(sent[0].body.content_md_ru).toBe('из файла');
    expect(sent[0].body).not.toHaveProperty('content_md_ru_file');
  });

  it('путь вне корня — отказ', async () => {
    const f = join(outside, 'eu.md');
    writeFileSync(f, 'x');
    const r = await upsert.handler({ type: 'doc', id: 'd2', fields: { project: 'P/R', content_md_ru_file: f } }) as Res;
    expect(r.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe('описание схемы правдиво', () => {
  it('у каждого *_file сказано про абсолютный путь, корни и режим по адресу хоста', () => {
    for (const k of ['content_html_file', 'content_md_ru_file', 'content_md_en_file']) {
      const d = String((docNew.schema[k] as { description?: string }).description ?? '');
      expect(d, k).toMatch(/absolute/i);
      expect(d, k).toContain('LORE_MCP_FILE_ROOTS');
      expect(d, k).toMatch(/LORE_MCP_TRANSPORT=http/);
    }
  });
});
