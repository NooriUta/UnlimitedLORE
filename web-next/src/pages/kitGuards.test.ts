// S4-00d — гварды на файлах для витрины /kit: она собрана из kit, а не из
// своих копий; v1 (корневой src/) не импортируется; локали web-next ru+en
// совпадают; CI гоняет axe на /kit отдельным шагом.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..');
const repo = resolve(src, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8');

describe('витрина /kit собрана из Seiðr-kit', () => {
  it('MD/HTML-элементы приходят из @seidr/kit/content', () => {
    const page = read(resolve(here, 'KitPage.tsx'));
    expect(page).toMatch(/from '@seidr\/kit\/content'/);
    for (const name of ['TipTapField', 'MartProse', 'SandboxedHtmlFrame']) expect(page).toContain(name);
  });

  it('своих копий TipTapField/MartProse/SandboxedHtmlFrame/sanitizeHtml в web-next нет', () => {
    const own = readdirSync(src, { recursive: true }) as string[];
    const copies = own.filter(f => /(?:^|[\\/])(TipTapField|MartProse|SandboxedHtmlFrame|sanitizeHtml|sandboxFrameTheme)\.tsx?$/.test(f));
    expect(copies).toEqual([]);
  });

  it('v1 (корневой src/) не импортируется', () => {
    const own = (readdirSync(src, { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f));
    const bad = own.filter(f => /from '(?:\.\.\/)+src\//.test(read(resolve(src, f))));
    expect(bad).toEqual([]);
  });
});

describe('локали web-next', () => {
  it('ru и en — одинаковый набор ключей, без пустых строк', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of [...Object.entries(ru), ...Object.entries(en)]) expect(String(v).trim(), k).not.toBe('');
  });
});

describe('CI: axe на /kit', () => {
  it('job web-next запускает axe-тест витрины отдельным шагом', () => {
    const ci = read(resolve(repo, '.github/workflows/frontend-ci.yml'));
    const job = ci.split(/^ {2}web-next:\s*$/m)[1] ?? '';
    const step = job.split(/- name: /).find(s => /KitPage\.test\.tsx/.test(s)) ?? '';
    expect(step, 'нет шага с axe-прогоном /kit').not.toBe('');
    expect(step).toMatch(/working-directory: web-next/);
    expect(step).toMatch(/vitest run src\/pages\/KitPage\.test\.tsx/);
  });
});
