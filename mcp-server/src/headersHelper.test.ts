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
  // Каталог сессий — пустой временный, без ожидания: иначе помощник нашёл бы claude, под которым идут тесты.
  LORE_SESSION_DIR: join(dir, 'no-sessions'),
  LORE_SESSION_WAIT_MS: '0',
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

// AO-SESSION-DOOR, вариант «б» (владелица 27.11.2026, «ок»): номер сессии Claude Code в headersHelper не
// приходит, но хук SessionStart его получает (stdin, session_id). Проба 27.11 на двух параллельных сессиях:
// хук и headersHelper запускает ОДИН процесс claude своей сессии. Поэтому тот же файл помощника работает и
// хуком: `lore-mcp-headers.mjs --session-start` пишет session_id в <каталог сессий>/<pid claude>.json, а
// помощник по pid своего claude читает его и ставит X-Lore-Session-Id. Унаследованный CLAUDE_CODE_SESSION_ID
// не читается (KDP-40: из живой сессии он родительский). Нет файла за время ожидания — заголовка нет.
function runWith(args: string[], env: Record<string, string | undefined>, stdin = ''): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('LORE_') && k !== 'CLAUDE_CODE_SESSION_ID') clean[k] = v;
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: clean });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('close', (status) => done({ status, stdout, stderr }));
    p.stdin.end(stdin);
  });
}

describe('сессия из хука SessionStart (--session-start) → X-Lore-Session-Id', () => {
  const SID = '6be1e61d-6cfb-4f31-88d9-8164f3645639';
  const sessEnv = (sub: string) => ({ LORE_SESSION_DIR: join(dir, sub), LORE_CLAUDE_PID: '4242', LORE_SESSION_WAIT_MS: '300' });

  it('хук пишет session_id в файл по pid claude; помощник ставит заголовок', async () => {
    const m = await runWith(['--session-start'], sessEnv('s1'), JSON.stringify({ session_id: SID, hook_event_name: 'SessionStart' }));
    expect(m.status, m.stderr).toBe(0);
    expect(m.stdout).toBe('');
    expect(JSON.parse(readFileSync(join(dir, 's1', '4242.json'), 'utf8')).session_id).toBe(SID);
    const r = await runWith([], { ...base(), ...sessEnv('s1') });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)['X-Lore-Session-Id']).toBe(SID);
  });

  it('хук сработал чуть позже помощника — помощник дожидается файла', async () => {
    const p = runWith([], { ...base(), ...sessEnv('s2'), LORE_SESSION_WAIT_MS: '3000' });
    await new Promise((r) => setTimeout(r, 400));
    await runWith(['--session-start'], sessEnv('s2'), JSON.stringify({ session_id: SID }));
    const r = await p;
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)['X-Lore-Session-Id']).toBe(SID);
  });

  it('файла нет — заголовка нет; унаследованный CLAUDE_CODE_SESSION_ID не берётся', async () => {
    const r = await runWith([], { ...base(), ...sessEnv('s3') });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).not.toHaveProperty('X-Lore-Session-Id');
  });

  it('чужой pid claude — чужую сессию не берёт', async () => {
    await runWith(['--session-start'], sessEnv('s4'), JSON.stringify({ session_id: SID }));
    const r = await runWith([], { ...base(), ...sessEnv('s4'), LORE_CLAUDE_PID: '9999' });
    expect(JSON.parse(r.stdout)).not.toHaveProperty('X-Lore-Session-Id');
  });

  it('хук без session_id или с мусором — код 0, файла нет (хук не роняет старт сессии)', async () => {
    const m = await runWith(['--session-start'], sessEnv('s5'), 'не json');
    expect(m.status).toBe(0);
    expect(existsSync(join(dir, 's5', '4242.json'))).toBe(false);
    const bad = await runWith(['--session-start'], sessEnv('s5'), JSON.stringify({ session_id: '../../etc' }));
    expect(bad.status).toBe(0);
    expect(existsSync(join(dir, 's5', '4242.json'))).toBe(false);
  });

  it('хуку не нужны переменные токена (их у хука может не быть)', async () => {
    const m = await runWith(['--session-start'], sessEnv('s6'), JSON.stringify({ session_id: SID }));
    expect(m.status, m.stderr).toBe(0);
    expect(existsSync(join(dir, 's6', '4242.json'))).toBe(true);
  });
});
