// SPRINT_LORE_MD_ARCHIVE/MDA-03 — project_export: архив проекта с сервера раскладывается
// в локальную папку. Непустая папка без overwrite — отказ, а не молчаливая перезапись;
// путь из ответа сервера не может выйти за пределы папки назначения.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeVault } from './projectExport.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lore-export-'));
const files = {
  'LORE/O__R/index.md': '# index\n',
  'LORE/O__R/tasks/SPRINT_X/T-1.md': '---\nid: "SPRINT_X/T-1"\n---\n',
};

describe('project_export — раскладка архива на диск', () => {
  it('пишет все файлы по путям из ответа и считает их', () => {
    const d = tmp();
    try {
      const r = writeVault(d, files, false);
      expect(r.written).toBe(2);
      expect(readFileSync(join(d, 'LORE/O__R/tasks/SPRINT_X/T-1.md'), 'utf8')).toContain('SPRINT_X/T-1');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('непустая папка без overwrite — отказ, ничего не перезаписано', () => {
    const d = tmp();
    try {
      writeFileSync(join(d, 'мои заметки.md'), 'своё');
      expect(() => writeVault(d, files, false)).toThrow(/не пуста|overwrite/);
      expect(existsSync(join(d, 'LORE'))).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('overwrite перезаписывает только папку LORE/<проект>, свои заметки рядом не трогает', () => {
    const d = tmp();
    try {
      writeFileSync(join(d, 'мои заметки.md'), 'своё');
      writeVault(d, files, true);
      writeVault(d, { 'LORE/O__R/index.md': '# новая\n' }, true);
      expect(readFileSync(join(d, 'мои заметки.md'), 'utf8')).toBe('своё');
      expect(existsSync(join(d, 'LORE/O__R/tasks/SPRINT_X/T-1.md'))).toBe(false);
      expect(readFileSync(join(d, 'LORE/O__R/index.md'), 'utf8')).toBe('# новая\n');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('путь, выходящий за папку назначения, — отказ', () => {
    const d = tmp();
    try {
      expect(() => writeVault(d, { 'LORE/O__R/../../../evil.md': 'x' }, false)).toThrow(/вне папки/);
      expect(() => writeVault(d, { '/etc/evil.md': 'x' }, false)).toThrow(/вне папки/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
