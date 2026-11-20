// @vitest-environment jsdom
// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE — пункт «Теги» в меню оболочки v2. Экран «сущности по тегу»
// (#1661) открывался только по адресу /tags. Пункт заведён тем же путём, что соседи: раздел оболочки
// (?sec=tags) в группе «Знание», в модели (surfaces.nav) и в рукописном меню-умолчании; иконка — из канона kit.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ICON_CANON, createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import App from '../App';
import { V2_SECTIONS, menuFromModel, v2Config } from '../shell/v2Config';

const here = dirname(fileURLToPath(import.meta.url));

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  document.documentElement.lang = 'ru';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}

const mem = () => createSafeStorage(() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
});

/** Конфиг модели на сервере — источник меню (MC-07). */
function modelNav(): { nav: { id: string; labelKey: string; tone: string; pinTop?: boolean; items: { section: string; icon: string }[] }[]; audience: Record<string, string> } {
  return JSON.parse(readFileSync(resolve(here, '../../../shared/model/lore-model.json'), 'utf8'));
}

describe('SUPERTAGS-SPIKE · пункт «Теги» в меню', () => {
  it('у пункта иконка из канона kit', () => {
    expect(ICON_CANON.sectionTags).toBe('price-tag');
  });

  it('раздел tags известен оболочке', () => {
    expect(V2_SECTIONS as readonly string[]).toContain('tags');
  });

  it('модель: «Теги» в группе «Знание», уровень everywhere — сервер отдаст пункт в общее меню', () => {
    const m = modelNav();
    const knowledge = m.nav.find(g => g.id === 'knowledge');
    expect(knowledge?.items).toContainEqual({ section: 'tags', icon: ICON_CANON.sectionTags });
    expect(m.audience.tags).toBe('everywhere');
  });

  it('меню из модели: пункт не отброшен как незнакомый, подпись из локалей ru/en', () => {
    const m = modelNav();
    // K5-MODEL-NAV-EDGE-LABELS (#1654): menuFromModel принимает документ /lore/model (surfaces.nav), разбор — kit navFromModel.
    const doc = { surfaces: { nav: m.nav.map(g => ({ id: g.id, label_key: g.labelKey, tone: g.tone, pin_top: !!g.pinTop, items: g.items })) } };
    for (const [lang, title] of [['ru', 'Теги'], ['en', 'Tags']] as const) {
      const knowledge = menuFromModel(lang, doc).find(g => g.id === 'knowledge');
      expect(knowledge?.items).toContainEqual({ id: 'tags', title, icon: ICON_CANON.sectionTags });
    }
  });

  it('рукописное меню (модели нет) — тот же пункт в «Знании»', () => {
    for (const [lang, title] of [['ru', 'Теги'], ['en', 'Tags']] as const) {
      const knowledge = v2Config(lang).menu.groups.find(g => g.id === 'knowledge');
      expect(knowledge?.items).toContainEqual({ id: 'tags', title, icon: ICON_CANON.sectionTags });
    }
  });

  it('в оболочке: пункт ведёт на экран тегов (?sec=tags), щелчок открывает «Сущности по тегу»', async () => {
    const win = fakeWin();
    render(<App path="/" win={win} storage={mem()} narrow={false} />);
    const side = screen.getByRole('navigation', { name: 'Разделы' });
    const link = within(side).getByRole('link', { name: 'Теги' });
    expect(link.getAttribute('href')).toContain('sec=tags');
    fireEvent.click(link);
    expect(win.location.search).toContain('sec=tags');
    expect(await screen.findByRole('heading', { level: 1, name: 'Сущности по тегу' })).toBeTruthy();
    // Экран внутри оболочки — без второго <main> и без второго h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('прямой адрес /tags по-прежнему открывает экран', async () => {
    render(<App path="/tags" win={fakeWin()} storage={mem()} narrow={false} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Сущности по тегу' })).toBeTruthy();
  });
});
