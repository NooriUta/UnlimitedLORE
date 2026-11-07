// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00b: базовые элементы web-next берёт из
// Seiðr-kit (D-2026-UXR-KIT-REACT), своей копии не держит. Проверяем, что
// элементы разрешаются через пакет и рисуют иконки из набора, который
// регистрирует приложение (офлайн, CSP запрещает удалённую подгрузку).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { IconButton, Pill, StatusStar, registerGameIcons } from '@seidr/kit';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8');

describe('web-next ← элементы @seidr/kit (S4-00b)', () => {
  it('элементы рендерятся из пакета, иконки — из зарегистрированного набора', () => {
    registerGameIcons(gameIcons);
    const html = renderToString(
      <>
        <IconButton icon="funnel" label="Фильтр" />
        <Pill variant="id">S4-00b</Pill>
        <StatusStar status="done" label="Статус: готово" />
      </>,
    );
    expect(html).toContain('aria-label="Фильтр"');
    expect(html).toContain('sk-pill--id');
    expect(html).toContain('data-category="done"');
    expect(html).toMatch(/<svg/);
    expect(html).not.toContain('data-missing');
  });

  it('набор game-icons регистрируется до рендера (main.tsx), из зависимости web-next', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/import gameIcons from '@iconify-json\/game-icons\/icons\.json'/);
    expect(main).toMatch(/registerGameIcons\(gameIcons\)/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@iconify/react']).toBeTruthy();
    expect(pkg.dependencies['@iconify-json/game-icons']).toBeTruthy();
  });

  it('vite не тянет вторую копию @iconify/react из kit/node_modules', () => {
    expect(read('vite.config.ts')).toMatch(/dedupe:\s*\[[^\]]*'@iconify\/react'/);
  });

  it('своих копий элементов в web-next нет', () => {
    const own = readdirSync(resolve(here), { recursive: true }) as string[];
    const copies = own.filter(f => /(?:^|[\\/])(Pill|IconButton|GameIcon|StatusStar|Kbd|Tooltip|Toolbar)\.tsx$/.test(f));
    expect(copies).toEqual([]);
  });

  it('метка версии в оболочке — ID-пилюля kit, а не своя разметка', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/import \{[^}]*\bPill\b[^}]*\} from '@seidr\/kit'/);
    expect(read('src/App.css')).not.toMatch(/\.shell-tag/);
  });
});
