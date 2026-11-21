// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED: помощник headersHelper для Claude Code
// (scripts/lore-mcp-headers.mjs). Проба 19.11: Claude Code запускает helper при
// подключении и после 401, сам повторяет вызов; номер сессии Claude Code в helper не
// попадает. Поэтому helper:
//   * печатает в stdout ТОЛЬКО JSON заголовков: Authorization, X-Lore-Machine, X-Lore-Harness;
//   * кэширует токен в файле пользователя (не ходит в Keycloak на каждый запуск),
//     истёкший (минус запас) — берёт заново; секрет в файл не пишет;
//   * X-Lore-Session-Id не выдумывает;
//   * без переменных — код 2 и пустой stdout (Claude Code не примет мусор за заголовки).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lore-mcp-headers.mjs');
const SECRET = 'helper-secret-5d9e';
let kc: Server;
let issuer: string;
let calls = 0;
let dir: string;

beforeAll(async () => {
  kc = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const p = new URLSearchParams(b);
      if (req.url !== '/realms/omilore/protocol/openid-connect/token' || p.get('client_secret') !== SECRET) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":"unauthorized_client"}');
        return;
      }
      calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: `tok-${calls}`, expires_in: 300 }));
    });
  });
  await new Promise<void>((r) => kc.listen(0, '127.0.0.1', () => r()));
  issuer = `http://127.0.0.1:${(kc.address() as AddressInfo).port}/realms/omilore`;
  dir = mkdtempSync(join(tmpdir(), 'lore-mcp-headers-'));
});

afterAll(async () => {
  await new Promise<void>((r) => kc.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

// Асинхронно: spawnSync заблокировал бы цикл событий, и поддельный Keycloak в этом же
// процессе не ответил бы помощнику.
function run(env: Record<string, string | undefined>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('LORE_') && k !== 'CLAUDE_CODE_SESSION_ID') clean[k] = v;
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT], { env: clean });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('close', (status) => done({ status, stdout, stderr }));
  });
}

const base = () => ({
  LORE_OIDC_ISSUER: issuer,
  LORE_MCP_CLIENT_ID: 'lore-mcp-full',
  LORE_MCP_CLIENT_SECRET: SECRET,
  LORE_MCP_TOKEN_CACHE: join(dir, 'token.json'),
  CLAUDE_CODE_SESSION_ID: 'b2c27515-7345-4386-b9e0-9c824bc96050',
});

describe('scripts/lore-mcp-headers.mjs', () => {
  it('выдаёт корректный JSON: Authorization, X-Lore-Machine, X-Lore-Harness', async () => {
    const r = await run(base());
    expect(r.status, r.stderr).toBe(0);
    const h = JSON.parse(r.stdout) as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok-1');
    expect(h['X-Lore-Machine']).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    expect(h['X-Lore-Harness']).toBe('claude-code');
    expect(Object.values(h).every((v) => typeof v === 'string')).toBe(true);
    // Номер сессии Claude Code в helper не попадает — заголовок не выдумываем.
    expect(h).not.toHaveProperty('X-Lore-Session-Id');
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it('второй запуск берёт токен из файла кэша, в Keycloak не ходит; секрета в файле нет', async () => {
    const before = calls;
    const r = await run(base());
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).Authorization).toBe(`Bearer tok-${before}`);
    expect(calls).toBe(before);
    expect(readFileSync(join(dir, 'token.json'), 'utf8')).not.toContain(SECRET);
  });

  it('истёкший (в пределах запаса) кэш → новый токен', async () => {
    writeFileSync(join(dir, 'token.json'), JSON.stringify({}));
    const file = join(dir, 'token.json');
    const before = calls;
    const r0 = await run(base()); // пустой кэш → новый
    expect(calls).toBe(before + 1);
    const cache = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { expires_at: number }>;
    for (const k of Object.keys(cache)) cache[k].expires_at = Date.now() + 10_000; // внутри запаса 60 с
    writeFileSync(file, JSON.stringify(cache));
    const r = await run(base());
    expect(r.status, r.stderr).toBe(0);
    expect(calls).toBe(before + 2);
    expect(JSON.parse(r.stdout).Authorization).not.toBe(JSON.parse(r0.stdout).Authorization);
  });

  it('другой секрет того же клиента — не берёт чужой кэш', async () => {
    const r = await run({ ...base(), LORE_MCP_CLIENT_SECRET: 'wrong' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toContain('wrong');
  });

  it('LORE_HARNESS переопределяет код harness; LORE_MACHINE_ID — машину', async () => {
    const r = await run({ ...base(), LORE_HARNESS: 'opencode', LORE_MACHINE_ID: 'odal box' });
    const h = JSON.parse(r.stdout) as Record<string, string>;
    expect(h['X-Lore-Harness']).toBe('opencode');
    expect(h['X-Lore-Machine']).toBe('odal-box');
  });

  // Патч 1.18.1: обёртка «infisical run … -- node lore-mcp-headers.mjs» отдаёт секрет под своим именем
  // (LORE_MCP_CLIENT_SECRET_FULL). LORE_MCP_SECRET_VAR — имя переменной, откуда брать секрет.
  it('LORE_MCP_SECRET_VAR: секрет берётся из названной переменной', async () => {
    const { LORE_MCP_CLIENT_SECRET: _drop, ...rest } = base();
    const r = await run({ ...rest, LORE_MCP_SECRET_VAR: 'LORE_MCP_CLIENT_SECRET_FULL', LORE_MCP_CLIENT_SECRET_FULL: SECRET,
      LORE_MCP_TOKEN_CACHE: join(dir, 'var.json') });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).Authorization).toMatch(/^Bearer tok-\d+$/);
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it('LORE_MCP_SECRET_VAR названа, а переменной нет — понятная ошибка с её именем, без значения секрета', async () => {
    const r = await run({ ...base(), LORE_MCP_SECRET_VAR: 'LORE_MCP_CLIENT_SECRET_FULL', LORE_MCP_TOKEN_CACHE: join(dir, 'var2.json') });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/LORE_MCP_CLIENT_SECRET_FULL/);
    expect(r.stderr).not.toContain(SECRET);
  });

  it('нет переменных — код 2, stdout пуст, в stderr названы недостающие', async () => {
    const r = await run({ LORE_MCP_TOKEN_CACHE: join(dir, 'none.json') });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/LORE_MCP_CLIENT_ID/);
    expect(r.stderr).toMatch(/LORE_MCP_CLIENT_SECRET/);
    expect(existsSync(join(dir, 'none.json'))).toBe(false);
  });
});
