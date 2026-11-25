// SPRINT_LORE_EXT_ISSUES_W2/ISS-04-MCP-HTTP (issue #4): MCP по URL для клиентов без
// Keycloak (Llama Chat и др. браузерные web UI). Критерии приёмки issue:
//   1. LORE_MCP_TRANSPORT=http → POST /mcp инициализируется SDK-клиентом, tools/list отвечает;
//   3. с LORE_MCP_TOKEN — 401 без токена, 200 с ним (Bearer на КАЖДОМ запросе);
//   4. без LORE_MCP_TRANSPORT — stdio как раньше (smoke);
//   5. CORS: разрешённый origin проходит, чужой блокируется;
//   6. GET /health → 200.
// Плюс: LORE_MCP_HOST по умолчанию 127.0.0.1 и громкое предупреждение, если токена нет,
// а адрес не loopback. (Критерий 2 — живой Llama Chat — руками; протокол тот же, что в 1.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const GATE = 'gate-secret-1';
const ALLOWED = 'http://chat.allowed.test';
const seen: { auth?: string }[] = [];
let backend: Server;
let mcp: { port: number; close: () => Promise<void> };
let base: string;

function listen(s: Server): Promise<number> {
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
}

beforeAll(async () => {
  backend = createServer((req: IncomingMessage, res) => {
    seen.push({ auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commit: req.headers.authorization ?? 'none', built_at: '2026-11-25T00:00:00Z' }));
  });
  process.env.LORE_BACKEND_URL = `http://127.0.0.1:${await listen(backend)}`;
  process.env.LORE_MCP_TRANSPORT = 'http';
  delete process.env.LORE_OIDC_ISSUER;
  const { startHttpServer } = await import('./http.js');
  mcp = await startHttpServer({ port: 0, host: '127.0.0.1', token: GATE, corsOrigins: [ALLOWED], log: () => {} });
  base = `http://127.0.0.1:${mcp.port}`;
});

afterAll(async () => {
  await mcp?.close();
  await new Promise<void>((r) => backend?.close(() => r()));
});

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
});
const rawHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

async function connect(headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'gate-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}

function commitOf(r: unknown): string {
  const text = (r as { content: { text: string }[] }).content[0].text;
  return (JSON.parse(text) as { backend: { commit: string } }).backend.commit;
}

describe('httpConfig: переменные окружения HTTP-режима', () => {
  it('host по умолчанию 127.0.0.1, порт 9200, токена и CORS нет', async () => {
    const { httpConfig } = await import('./http.js');
    expect(httpConfig({})).toEqual({ host: '127.0.0.1', port: 9200, token: null, corsOrigins: [] });
  });
  it('LORE_MCP_HOST/PORT/TOKEN/CORS_ORIGINS читаются; список origin — через запятую, без хвостового /', async () => {
    const { httpConfig } = await import('./http.js');
    expect(httpConfig({
      LORE_MCP_HOST: '0.0.0.0', LORE_MCP_PORT: '8787', LORE_MCP_TOKEN: ' t1 ',
      LORE_MCP_CORS_ORIGINS: 'http://a.test, http://b.test:8080/ ,',
    })).toEqual({ host: '0.0.0.0', port: 8787, token: 't1', corsOrigins: ['http://a.test', 'http://b.test:8080'] });
  });
  it('мусорный порт — ошибка с именем переменной', async () => {
    const { httpConfig } = await import('./http.js');
    expect(() => httpConfig({ LORE_MCP_PORT: 'x' })).toThrow(/LORE_MCP_PORT/);
    expect(() => httpConfig({ LORE_MCP_PORT: '70000' })).toThrow(/LORE_MCP_PORT/);
  });
});

describe('предупреждение при старте: нет токена, адрес не loopback', () => {
  it('0.0.0.0 без токена — громкое предупреждение, называющее LORE_MCP_TOKEN', async () => {
    const { httpStartupWarnings } = await import('./http.js');
    const w = httpStartupWarnings({ host: '0.0.0.0', token: null });
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/LORE_MCP_TOKEN/);
    expect(w[0]).toMatch(/0\.0\.0\.0/);
    expect(httpStartupWarnings({ host: '10.0.0.5', token: null }).length).toBe(1);
  });
  it('loopback или токен задан — без предупреждения', async () => {
    const { httpStartupWarnings } = await import('./http.js');
    for (const h of ['127.0.0.1', '::1', 'localhost', '127.1.2.3']) expect(httpStartupWarnings({ host: h, token: null }), h).toEqual([]);
    expect(httpStartupWarnings({ host: '0.0.0.0', token: 'x' })).toEqual([]);
  });
});

describe('LORE_MCP_TOKEN: Bearer на каждом запросе (критерии 1, 3)', () => {
  it('без токена — 401', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: rawHeaders, body: initBody });
    expect(r.status).toBe(401);
    expect(await r.text()).toMatch(/LORE_MCP_TOKEN/);
  });

  it('чужой Bearer — 401', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, Authorization: 'Bearer wrong' }, body: initBody });
    expect(r.status).toBe(401);
  });

  it('с токеном — 200: initialize, tools/list, вызов; сам токен шлюза в бэкенд НЕ уходит', async () => {
    const raw = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, Authorization: `Bearer ${GATE}` }, body: initBody });
    expect(raw.status).toBe(200);
    await raw.body?.cancel();
    const c = await connect({ Authorization: `Bearer ${GATE}` });
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toContain('query_slice');
    expect(names).toContain('lore_version');
    const before = seen.length;
    expect(commitOf(await c.callTool({ name: 'lore_version', arguments: {} }))).toBe('none');
    expect(seen.slice(before).every((s) => s.auth === undefined)).toBe(true);
    await c.close();
  });

  it('токен проверяется и на запросах внутри сессии, не только на initialize', async () => {
    const init = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, Authorization: `Bearer ${GATE}` }, body: initBody });
    const sid = init.headers.get('mcp-session-id');
    await init.body?.cancel();
    expect(sid).toBeTruthy();
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { ...rawHeaders, 'Mcp-Session-Id': sid! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(r.status).toBe(401);
    const g = await fetch(`${base}/mcp`, { method: 'GET', headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': sid! } });
    expect(g.status).toBe(401);
  });

  it('токен шлюза в X-Lore-Mcp-Token — тогда Authorization (Keycloak) уходит в бэкенд как раньше', async () => {
    const c = await connect({ 'X-Lore-Mcp-Token': GATE, Authorization: 'Bearer kc-jwt' });
    expect(commitOf(await c.callTool({ name: 'lore_version', arguments: {} }))).toBe('Bearer kc-jwt');
    await c.close();
  });
});

describe('GET /health (критерий 6)', () => {
  it('/health и /mcp/health — 200 без входа', async () => {
    for (const p of ['/health', '/mcp/health']) {
      const r = await fetch(`${base}${p}`);
      expect(r.status, p).toBe(200);
      expect(((await r.json()) as { status: string }).status).toBe('ok');
    }
  });
});

describe('CORS по LORE_MCP_CORS_ORIGINS (критерий 5)', () => {
  it('preflight с разрешённого origin — 204 и заголовки CORS (Authorization, Mcp-Session-Id)', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,mcp-session-id' },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect((r.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toMatch(/authorization/);
    expect((r.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toMatch(/mcp-session-id/);
    expect(r.headers.get('access-control-allow-methods') ?? '').toMatch(/POST/);
  });

  it('запрос с разрешённого origin проходит и несёт Allow-Origin + Expose Mcp-Session-Id', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, Origin: ALLOWED, Authorization: `Bearer ${GATE}` }, body: initBody });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect((r.headers.get('access-control-expose-headers') ?? '').toLowerCase()).toMatch(/mcp-session-id/);
    await r.body?.cancel();
  });

  it('чужой origin — 403 и без Allow-Origin, и на preflight, и на запросе', async () => {
    const pre = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, Origin: 'http://evil.test', Authorization: `Bearer ${GATE}` }, body: initBody });
    expect(r.status).toBe(403);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('stdio без LORE_MCP_TRANSPORT — как раньше (критерий 4, smoke)', () => {
  it('процесс по stdio отвечает на initialize и tools/list', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('LORE_')) env[k] = v;
    env.LORE_BACKEND_URL = 'http://127.0.0.1:9';
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(here, 'index.ts')],
      env, stderr: 'ignore',
    });
    const client = new Client({ name: 'stdio-smoke', version: '0' });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('query_slice');
    await client.close();
  }, 60_000);
});
