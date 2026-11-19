// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED: MCP по адресу хоста LORE (Streamable HTTP).
//
// Владелица 19.11.2026: «мне надоело локально mcp пересобирать». Сервер живёт на
// https://<хост LORE>/mcp и выкатывается вместе с LORE. Здесь — его контракт:
//   * tools/list отвечает по HTTP;
//   * без Authorization: Bearer — 401 с понятным текстом;
//   * в бэкенд уходит ТОТ ЖЕ токен клиента, своих client_credentials нет;
//   * токены параллельных сессий не смешиваются (контекст запроса, не глобал);
//   * профиль — из X-Lore-Mcp-Profile, неизвестный — 400;
//   * /mcp/health — без входа, отметка сборки.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type Seen = { path: string; auth?: string; seerRole?: string; machine?: string };
const seen: Seen[] = [];
let backend: Server;
let mcp: { port: number; close: () => Promise<void> };
let base: string;

function listen(s: Server): Promise<number> {
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
}

beforeAll(async () => {
  // Бэкенд-заглушка: записывает заголовки и возвращает Authorization в теле
  // /lore/version — так клиент видит, ЧЕЙ токен дошёл до бэкенда в ЕГО вызове.
  backend = createServer((req: IncomingMessage, res) => {
    seen.push({
      path: req.url ?? '',
      auth: req.headers.authorization,
      seerRole: req.headers['x-seer-role'] as string | undefined,
      machine: req.headers['x-lore-machine'] as string | undefined,
    });
    // Случайная задержка, чтобы параллельные вызовы перемешались по времени.
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ commit: req.headers.authorization ?? 'none', built_at: '2026-11-19T00:00:00Z' }));
    }, Math.floor(Math.random() * 30));
  });
  const bport = await listen(backend);
  process.env.LORE_BACKEND_URL = `http://127.0.0.1:${bport}`;
  process.env.LORE_MCP_TRANSPORT = 'http';
  // Секреты stdio-режима в окружении не должны влиять на HTTP-режим.
  delete process.env.LORE_OIDC_ISSUER;
  delete process.env.LORE_MCP_CLIENT_ID;
  delete process.env.LORE_MCP_CLIENT_SECRET;
  const { startHttpServer } = await import('./http.js');
  mcp = await startHttpServer({ port: 0, host: '127.0.0.1', log: () => {} });
  base = `http://127.0.0.1:${mcp.port}`;
});

afterAll(async () => {
  await mcp?.close();
  await new Promise<void>((r) => backend?.close(() => r()));
});

async function connect(token: string, profile?: string): Promise<Client> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (profile) headers['X-Lore-Mcp-Profile'] = profile;
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
});
const rawHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function versionCommit(r: unknown): string {
  const text = (r as { content: { text: string }[] }).content[0].text;
  return (JSON.parse(text) as { backend: { commit: string } }).backend.commit;
}

describe('transportMode: stdio по умолчанию', () => {
  it('нет переменной — stdio; http — http; мусор — ошибка с именем переменной', async () => {
    const { transportMode } = await import('./http.js');
    expect(transportMode({})).toBe('stdio');
    expect(transportMode({ LORE_MCP_TRANSPORT: 'stdio' })).toBe('stdio');
    expect(transportMode({ LORE_MCP_TRANSPORT: 'http' })).toBe('http');
    expect(() => transportMode({ LORE_MCP_TRANSPORT: 'sse' })).toThrow(/LORE_MCP_TRANSPORT/);
  });
});

describe('HTTP-режим MCP (AO-MCP-HOSTED)', () => {
  it('tools/list отвечает по HTTP', async () => {
    const c = await connect('tok-list');
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toContain('lore_version');
    expect(tools.map((t) => t.name)).toContain('query_slice');
    await c.close();
  });

  it('без Authorization — 401 с понятным текстом, токен-схема Bearer', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: rawHeaders, body: initBody });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate') ?? '').toMatch(/Bearer/);
    expect(await r.text()).toMatch(/Authorization: Bearer/);
  });

  it('Authorization не Bearer — тоже 401', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, Authorization: 'Basic eDp5' }, body: initBody });
    expect(r.status).toBe(401);
  });

  it('токен клиента уходит в бэкенд как есть; X-Seer-Role не шлётся', async () => {
    const c = await connect('tok-forward');
    const r = await c.callTool({ name: 'lore_version', arguments: {} });
    expect(versionCommit(r)).toBe('Bearer tok-forward');
    const hit = seen.filter((s) => s.auth === 'Bearer tok-forward');
    expect(hit.length).toBeGreaterThan(0);
    // В HTTP-режиме заголовок роли дал бы права из env контейнера при выключенном auth.
    expect(hit.every((s) => s.seerRole === undefined)).toBe(true);
    await c.close();
  });

  it('токены двух параллельных сессий не смешиваются', async () => {
    const [a, b] = await Promise.all([connect('tok-A'), connect('tok-B')]);
    const calls = Array.from({ length: 20 }, (_, i) => {
      const [c, tok] = i % 2 ? [a, 'tok-A'] : [b, 'tok-B'];
      return c.callTool({ name: 'lore_version', arguments: {} }).then((r) => ({ tok, got: versionCommit(r) }));
    });
    const results = await Promise.all(calls);
    for (const r of results) expect(r.got).toBe(`Bearer ${r.tok}`);
    await Promise.all([a.close(), b.close()]);
  });

  it('профиль из X-Lore-Mcp-Profile сужает поверхность; по умолчанию full', async () => {
    const full = await connect('tok-p1');
    const tester = await connect('tok-p2', 'tester');
    const fullNames = (await full.listTools()).tools.map((t) => t.name);
    const testerNames = (await tester.listTools()).tools.map((t) => t.name);
    expect(testerNames.length).toBeLessThan(fullNames.length);
    expect(testerNames).toContain('qg_run_log');
    expect(testerNames).not.toContain('adr_new');
    await Promise.all([full.close(), tester.close()]);
  });

  it('неизвестный профиль — 400 со списком допустимых; путь вида ../ не читается', async () => {
    for (const p of ['nope', '../package', 'tool-paths']) {
      const r = await fetch(`${base}/mcp`, {
        method: 'POST', headers: { ...rawHeaders, Authorization: 'Bearer t', 'X-Lore-Mcp-Profile': p }, body: initBody,
      });
      expect(r.status, p).toBe(400);
      const t = await r.text();
      expect(t).toMatch(/X-Lore-Mcp-Profile/);
      expect(t).toMatch(/tester/);
    }
  });

  it('/mcp/health — без входа, отметка сборки', async () => {
    const r = await fetch(`${base}/mcp/health`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j.status).toBe('ok');
    expect(typeof j.commit).toBe('string');
    expect(j).toHaveProperty('built_at');
    expect(j.transport).toBe('http');
  });

  it('неизвестная сессия — 404, чужой путь — 404', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { ...rawHeaders, Authorization: 'Bearer t', 'Mcp-Session-Id': 'no-such' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(r.status).toBe(404);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it('не-initialize без сессии — 400', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { ...rawHeaders, Authorization: 'Bearer t' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(r.status).toBe(400);
  });
});
