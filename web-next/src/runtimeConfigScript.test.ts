// Настройки входа веба — из env контейнера при СТАРТЕ (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE).
// Сторожим обе половины: образ v2 не принимает build-arg входа (VITE_LORE_AUTH_ENABLED / VITE_OIDC_*) и кладёт
// скрипт старта; скрипт собирает из env /config.json, который читает фронт (auth/runtimeAuthConfig.ts).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');
const code = (s: string) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const SCRIPT = resolve(repo, 'docker/40-lore-runtime-config.sh');

function runScript(env: Record<string, string>): Record<string, unknown> {
  const out = join(mkdtempSync(join(tmpdir(), 'lore-cfg-')), 'config.json');
  const r = spawnSync('sh', [SCRIPT], { env: { PATH: process.env.PATH ?? '', ...env, LORE_CONFIG_JSON: out }, encoding: 'utf8' });
  expect(r.error, String(r.error)).toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
}

describe('SELF-PROVISION · образ веба не впекает настройки входа', () => {
  it('web-next/Dockerfile: нет build-arg входа, есть runtime env и скрипт старта 40-lore-runtime-config.sh', () => {
    const d = code(read('web-next/Dockerfile'));
    expect(d).not.toMatch(/VITE_LORE_AUTH_ENABLED|VITE_OIDC_ISSUER|VITE_OIDC_CLIENT_ID/);
    expect(d).toMatch(/LORE_AUTH_ENABLED=""/);
    expect(d).toMatch(/LORE_OIDC_ISSUER=""/);
    expect(d).toMatch(/COPY docker\/40-lore-runtime-config\.sh \/docker-entrypoint\.d\/40-lore-runtime-config\.sh/);
  });

  it('compose-файлы: у lore-app-next вход — runtime env, а не build-arg', () => {
    for (const f of ['docker-compose.yml', 'deploy/install/docker-compose.install.yml']) {
      const c = code(read(f));
      const svc = c.slice(c.indexOf('lore-app-next:'));
      const block = svc.slice(0, svc.search(/\n {2}[a-z][\w-]*:\s*\n/) + 1 || undefined);
      expect(block, f).not.toMatch(/VITE_LORE_AUTH_ENABLED|VITE_OIDC_ISSUER|VITE_OIDC_CLIENT_ID/);
      expect(block, f).toMatch(/LORE_OIDC_ISSUER: \$\{LORE_OIDC_ISSUER:-\}/);
      expect(block, f).toMatch(/LORE_AUTH_ENABLED: \$\{LORE_AUTH_ENABLED:-/);
    }
  });
});

describe('SELF-PROVISION · скрипт старта собирает /config.json из env', () => {
  it('значения env → поля конфига', () => {
    expect(runScript({ LORE_AUTH_ENABLED: 'true', LORE_OIDC_ISSUER: 'https://auth.example.org/realms/lore', LORE_OIDC_CLIENT_ID: 'web' }))
      .toEqual({ auth_enabled: 'true', oidc_issuer: 'https://auth.example.org/realms/lore', oidc_client_id: 'web' });
  });

  it('ничего не задано — пустые строки (фронт спросит бэкенд), а не чей-то адрес', () => {
    expect(runScript({})).toEqual({ auth_enabled: '', oidc_issuer: '', oidc_client_id: '' });
  });

  it('кавычка и обратный слэш в значении не ломают JSON', () => {
    expect(runScript({ LORE_OIDC_CLIENT_ID: 'a"b\\c' }).oidc_client_id).toBe('a"b\\c');
  });
});
