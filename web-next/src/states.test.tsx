// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00c: честные состояния и оболочки web-next
// берёт из Seiðr-kit (D-2026-UXR-KIT-REACT), своих копий не держит; язык
// подписей kit задаётся один раз в main.tsx.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import gameIcons from '@iconify-json/game-icons/icons.json';
import {
  EmptyState, Forbidden, KitLangProvider, LoadError, Skeleton, Tabs, Truncated, Ear, registerGameIcons,
} from '@seidr/kit';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8');

describe('web-next ← состояния и оболочки @seidr/kit (S4-00c)', () => {
  it('четыре исхода различимы по data-state и тексту', () => {
    registerGameIcons(gameIcons);
    const html = renderToString(
      <>
        <Skeleton />
        <EmptyState />
        <LoadError error={{ status: 502 }} />
        <Forbidden />
        <Truncated meta={{ truncated: true, limit: 1000 }} shown={1000} />
      </>,
    );
    for (const s of ['loading', 'empty', 'error', 'forbidden', 'partial']) expect(html).toContain(`data-state="${s}"`);
    expect(html).toContain('HTTP 502');
    expect(html).not.toContain('data-missing');
  });

  it('оболочки рендерятся из пакета, язык — из KitLangProvider', () => {
    const html = renderToString(
      <KitLangProvider lang="en">
        <Tabs label="View" value="a" onChange={() => {}} items={[{ id: 'a', label: 'A' }]} />
        <Ear label="Props" />
        <EmptyState />
      </KitLangProvider>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('sk-ear');
    expect(html).toContain('Empty (checked)');
  });

  it('main.tsx задаёт язык kit по <html lang> (один раз на приложение)', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/import \{[^}]*\bKitLangProvider\b[^}]*\} from '@seidr\/kit'/);
    expect(main).toMatch(/<KitLangProvider lang=\{kitLang\}>/);
    expect(main).toMatch(/document\.documentElement\.lang/);
  });

  it('своих копий состояний и оболочек в web-next нет', () => {
    const own = readdirSync(resolve(here), { recursive: true }) as string[];
    const copies = own.filter(f =>
      /(?:^|[\\/])(Skeleton|EmptyState|LoadError|Forbidden|Truncated|StateViews|LoadStateView|Sheet|Drawer|Tabs|Ear|useLoadState|loadState)\.tsx?$/.test(f));
    expect(copies).toEqual([]);
  });
});
