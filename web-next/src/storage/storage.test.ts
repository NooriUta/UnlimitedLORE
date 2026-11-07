// SPRINT_UXR_S3_V2_INFRA/S3-08 — разведение хранилища браузера v1 и v2.
// v1 (корневой src/) заморожен и пишет ключи без префикса (lore-palette,
// lore-mode, lore-theme, …). v2 пишет только lore.v2.*; общая у них лишь
// cookie платформы seer-prefs (палитра/режим).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHARED_PREFS_COOKIE,
  V2_PREFIX,
  clearV2,
  createV2Storage,
  readSharedPrefs,
  v2Key,
  writeSharedPrefs,
  type CookieJar,
} from './storage';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

function jar(initial = ''): CookieJar & { writes: string[] } {
  let cookie = initial;
  const writes: string[] = [];
  return {
    writes,
    read: () => cookie,
    write: (c: string) => {
      writes.push(c);
      const [pair] = c.split(';');
      const name = pair.split('=')[0];
      const rest = cookie.split('; ').filter(p => p && !p.startsWith(name + '='));
      cookie = [...rest, pair].join('; ');
    },
  };
}

describe('S3-08: ключи v2 — только lore.v2.*', () => {
  it('префикс ровно lore.v2.', () => {
    expect(V2_PREFIX).toBe('lore.v2.');
    expect(v2Key('palette')).toBe('lore.v2.palette');
  });

  it('пустое имя или имя с чужим/уже вписанным префиксом — ошибка, а не тихий двойной префикс', () => {
    expect(() => v2Key('')).toThrow();
    expect(() => v2Key('lore.v2.palette')).toThrow();
    expect(() => v2Key('lore.v1.palette')).toThrow();
    expect(() => v2Key('lore-palette')).toThrow();
  });

  it('запись и чтение идут под префиксом, ключи v1 не видны и не трогаются', () => {
    const ls = new MemStorage();
    ls.setItem('lore-palette', 'lichen');
    ls.setItem('lore-mode', 'light');
    const s = createV2Storage(ls);
    expect(s.get('palette')).toBeNull();
    s.set('palette', 'slate');
    expect(ls.getItem('lore.v2.palette')).toBe('slate');
    expect(ls.getItem('lore-palette')).toBe('lichen');
    expect(s.get('palette')).toBe('slate');
    s.remove('palette');
    expect(ls.getItem('lore.v2.palette')).toBeNull();
    expect(ls.getItem('lore-palette')).toBe('lichen');
  });

  it('JSON-помощники: битое значение = null, а не исключение', () => {
    const ls = new MemStorage();
    const s = createV2Storage(ls);
    s.setJson('scope', { project: 'p1' });
    expect(s.getJson('scope')).toEqual({ project: 'p1' });
    ls.setItem('lore.v2.scope', '{oops');
    expect(s.getJson('scope')).toBeNull();
  });

  it('clearV2 чистит только lore.v2.*, хранилище v1 остаётся целым', () => {
    const ls = new MemStorage();
    ls.setItem('lore-palette', 'lichen');
    ls.setItem('lore.v1.x', '1');
    ls.setItem('lore.v2.a', '1');
    ls.setItem('lore.v2.b', '2');
    clearV2(ls);
    expect(ls.getItem('lore.v2.a')).toBeNull();
    expect(ls.getItem('lore.v2.b')).toBeNull();
    expect(ls.getItem('lore-palette')).toBe('lichen');
    expect(ls.getItem('lore.v1.x')).toBe('1');
  });

  it('недоступное хранилище (приватный режим, запрет) — get=null, set не роняет', () => {
    const deny = () => { throw new Error('denied'); };
    const broken = {
      get length(): number { return deny(); },
      getItem: deny, setItem: deny, removeItem: deny, key: deny, clear: deny,
    } as unknown as Storage;
    const s = createV2Storage(broken);
    expect(s.get('palette')).toBeNull();
    expect(() => s.set('palette', 'x')).not.toThrow();
    expect(() => clearV2(broken)).not.toThrow();
  });
});

describe('S3-08: общая с v1 только cookie seer-prefs', () => {
  it('имя cookie совпадает с v1 (src/theme/prefs.ts)', () => {
    expect(SHARED_PREFS_COOKIE).toBe('seer-prefs');
    const v1 = readFileSync(join(__dirname, '../../../src/theme/prefs.ts'), 'utf8');
    expect(v1).toContain(`'${SHARED_PREFS_COOKIE}'`);
  });

  it('читает формат v1: JSON {theme, palette} в encodeURIComponent', () => {
    const value = encodeURIComponent(JSON.stringify({ theme: 'light', palette: 'lichen' }));
    expect(readSharedPrefs(jar(`a=1; seer-prefs=${value}; b=2`))).toEqual({ theme: 'light', palette: 'lichen' });
    expect(readSharedPrefs(jar('seer-prefs=%7Boops'))).toEqual({});
    expect(readSharedPrefs(jar(''))).toEqual({});
  });

  it('пишет патчем поверх прежнего, с Domain на поддомене и без него на localhost/IP', () => {
    const j = jar(`seer-prefs=${encodeURIComponent(JSON.stringify({ theme: 'dark', palette: 'slate' }))}`);
    writeSharedPrefs({ palette: 'juniper' }, j, 'new.lore.odal.example.org');
    expect(readSharedPrefs(j)).toEqual({ theme: 'dark', palette: 'juniper' });
    expect(j.writes[0]).toContain('Path=/');
    expect(j.writes[0]).toContain('Domain=.odal.example.org');

    const local = jar();
    writeSharedPrefs({ theme: 'light' }, local, 'localhost');
    expect(local.writes[0]).not.toContain('Domain=');
    const ip = jar();
    writeSharedPrefs({ theme: 'light' }, ip, '192.168.3.131');
    expect(ip.writes[0]).not.toContain('Domain=');
  });
});

describe('S3-08: гард — к хранилищу браузера v2 обращается только storage/', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(n => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it('ни один исходник web-next/src вне storage/ не трогает localStorage/sessionStorage/document.cookie', () => {
    const root = join(__dirname, '..');
    const files = walk(root).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(1); // положительный контроль: обход что-то нашёл
    const offenders = files
      .filter(f => !relative(root, f).replace(/\\/g, '/').startsWith('storage/'))
      .filter(f => /\b(localStorage|sessionStorage)\b|document\.cookie/.test(readFileSync(f, 'utf8')))
      .map(f => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('положительный контроль гарда: тот же шаблон находит обращение в самом storage.ts', () => {
    const src = readFileSync(join(__dirname, 'storage.ts'), 'utf8');
    expect(src).toMatch(/\b(localStorage|sessionStorage)\b|document\.cookie/);
  });
});
