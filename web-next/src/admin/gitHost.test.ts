// Адрес git-хоста — из настройки или записей репозиториев, не литерал нашего Forgejo
// (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE).
import { describe, expect, it, vi } from 'vitest';
import { fetchGitHost, originOf, resolveGitHost } from './gitHost';
import { primaryHostOf } from './projectLike';

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const hosts = (base: string) => JSON.stringify([{ remote: 'origin', role: 'primary', base_url: base }]);

describe('SELF-PROVISION · адрес git-хоста', () => {
  it('настройка forgejo.url главнее записей; берётся origin', () => {
    expect(resolveGitHost('https://git.acme.io/', [{ host: 'https://forge.other.org' }])).toBe('https://git.acme.io');
  });

  it('настройки нет — самый частый хост primary у зарегистрированных проектов', () => {
    expect(resolveGitHost(null, [{ host: 'https://a.org' }, { host: 'https://b.org' }, { host: 'https://b.org' }, { host: null }])).toBe('https://b.org');
  });

  it('нет ни настройки, ни записей — null («адрес git-хоста не задан»), а не чей-то домен', () => {
    expect(resolveGitHost(null, [])).toBeNull();
    expect(resolveGitHost('ftp://x', [{ host: null }])).toBeNull();
  });

  it('origin — только http(s)', () => {
    expect(originOf('https://git.acme.io/AIDA/x')).toBe('https://git.acme.io');
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('')).toBeNull();
  });

  it('хост primary из hosts[] записи репозитория', () => {
    expect(primaryHostOf(hosts('https://git.acme.io/AIDA/x'))).toBe('https://git.acme.io');
    expect(primaryHostOf(null)).toBeNull();
  });

  it('fetchGitHost: параметр приложения из справочника app_setting', async () => {
    const f = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [{ dict_type: 'app_setting', code: 'forgejo.url', label_ru: 'https://git.acme.io', is_active: true }] });
      return json({ rows: [{ slug: 'A/b', hosts: hosts('https://forge.other.org/A/b') }] });
    });
    expect(await fetchGitHost(f as unknown as typeof fetch)).toBe('https://git.acme.io');
  });
});
