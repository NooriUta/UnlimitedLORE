// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED, вариант «г»: клиенты без headersHelper
// (OpenCode и другие) присылают X-Lore-Client-Id + X-Lore-Client-Secret, а токен у
// Keycloak (client_credentials, тот же token endpoint, что у stdio-режима) берёт сервер.
//
// Контракт:
//   * пара id/секрет → бэкенд получает Bearer, выданный token endpoint;
//   * токен кэшируется до истечения минус запас; ключ — client_id + хэш секрета;
//   * истёк → новый; неверный секрет — 401, даже если для этого id токен уже в кэше;
//   * секрет никогда не попадает в журнал и в ответ клиенту;
//   * Bearer по-прежнему принимается; нет ни того, ни другого — 401 с понятным текстом;
//   * Mcp-Session-Id (меняется при каждом переподключении) — не сессия агента:
//     в бэкенд как X-Lore-Session-Id не уходит.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const GOOD_SECRET = 'S3cr3t-good-7f1c9a';
const BAD_SECRET = 'S3cr3t-bad-0d2e44';
const CLIENTS: Record<string, string> = { 'lore-mcp-full_opencode': GOOD_SECRET, 'lore-mcp-tester': 'tester-secret-91ab' };

type Seen = { auth?: string; session?: string };
const seen: Seen[] = [];
let kcCalls = 0;
let issued = 0;
let expiresIn = 300;
let clock = 1_000_000;
const logs: string[] = [];

let backend: Server;
let kc: Server;
let mcp: { port: number; close: () => Promise<void> };
let bare: { port: number; close: () => Promise<void> };
let base: string;

function listen(s: Server): Promise<number> {
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
}

beforeAll(async () => {
  backend = createServer((req, res) => {
    seen.push({ auth: req.headers.authorization, session: req.headers['x-lore-session-id'] as string | undefined });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commit: req.headers.authorization ?? 'none', built_at: '2026-11-19T00:00:00Z' }));
  });
  // Поддельный Keycloak: realm omilore, client_credentials. На неверный секрет отвечает
  // 401 и (намеренно, хуже настоящего) повторяет присланный секрет в теле — сервер всё
  // равно не должен вынести его ни в журнал, ни в ответ клиенту.
  kc = createServer(async (req, res) => {
    const body = new URLSearchParams(await readBody(req));
    if (req.url !== '/kc/realms/omilore/protocol/openid-connect/token' || body.get('grant_type') !== 'client_credentials') {
      res.writeHead(404); res.end(); return;
    }
    kcCalls++;
    const id = body.get('client_id') ?? '';
    const secret = body.get('client_secret') ?? '';
    if (CLIENTS[id] !== secret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized_client', error_description: `Invalid client credentials (${secret})` }));
      return;
    }
    issued++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: `kc-${id}-${issued}`, expires_in: expiresIn, token_type: 'Bearer' }));
  });
  const bport = await listen(backend);
  const kport = await listen(kc);
  process.env.LORE_BACKEND_URL = `http://127.0.0.1:${bport}`;
  process.env.LORE_MCP_TRANSPORT = 'http';
  delete process.env.LORE_MCP_CLIENT_ID;
  delete process.env.LORE_MCP_CLIENT_SECRET;
  delete process.env.LORE_OIDC_ISSUER;
  const { startHttpServer } = await import('./http.js');
  mcp = await startHttpServer({
    port: 0, host: '127.0.0.1', log: (m) => logs.push(m),
    oidcIssuer: `http://127.0.0.1:${kport}/kc/realms/omilore`, now: () => clock,
  });
  // Сервер без issuer: пара id/секрет ему не по силам — это должно быть сказано прямо.
  bare = await startHttpServer({ port: 0, host: '127.0.0.1', log: (m) => logs.push(m), oidcIssuer: '' });
  base = `http://127.0.0.1:${mcp.port}`;
});

afterAll(async () => {
  await mcp?.close();
  await bare?.close();
  await new Promise<void>((r) => backend?.close(() => r()));
  await new Promise<void>((r) => kc?.close(() => r()));
});

async function connect(headers: Record<string, string>, url = `${base}/mcp`): Promise<Client> {
  const client = new Client({ name: 'opencode-like', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

const creds = (id: string, secret: string) => ({ 'X-Lore-Client-Id': id, 'X-Lore-Client-Secret': secret });

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
});
const rawHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function versionCommit(r: unknown): string {
  const text = (r as { content: { text: string }[] }).content[0].text;
  return (JSON.parse(text) as { backend: { commit: string } }).backend.commit;
}

describe('вариант «г»: X-Lore-Client-Id + X-Lore-Client-Secret', () => {
  it('пара id/секрет → бэкенд получает Bearer, выданный token endpoint', async () => {
    const c = await connect(creds('lore-mcp-full_opencode', GOOD_SECRET));
    const got = versionCommit(await c.callTool({ name: 'lore_version', arguments: {} }));
    expect(got).toMatch(/^Bearer kc-lore-mcp-full_opencode-\d+$/);
    await c.close();
  });

  it('кэш: повторные вызовы и новая сессия за токеном не ходят', async () => {
    const c1 = await connect(creds('lore-mcp-full_opencode', GOOD_SECRET));
    await c1.callTool({ name: 'lore_version', arguments: {} });
    const before = kcCalls;
    const t1 = versionCommit(await c1.callTool({ name: 'lore_version', arguments: {} }));
    const c2 = await connect(creds('lore-mcp-full_opencode', GOOD_SECRET));
    const t2 = versionCommit(await c2.callTool({ name: 'lore_version', arguments: {} }));
    expect(kcCalls).toBe(before);
    expect(t2).toBe(t1);
    await Promise.all([c1.close(), c2.close()]);
  });

  it('истёк токен (минус запас) → берётся новый', async () => {
    const c = await connect(creds('lore-mcp-full_opencode', GOOD_SECRET));
    const t1 = versionCommit(await c.callTool({ name: 'lore_version', arguments: {} }));
    const before = kcCalls;
    // Ещё не истёк, но уже в запасе (60 с до конца) — должен обновиться.
    clock += (expiresIn - 30) * 1000;
    const t2 = versionCommit(await c.callTool({ name: 'lore_version', arguments: {} }));
    expect(kcCalls).toBe(before + 1);
    expect(t2).not.toBe(t1);
    expect(t2).toMatch(/^Bearer kc-lore-mcp-full_opencode-\d+$/);
    await c.close();
  });

  it('неверный секрет → 401, даже когда токен этого client_id уже в кэше', async () => {
    const warm = await connect(creds('lore-mcp-full_opencode', GOOD_SECRET));
    await warm.callTool({ name: 'lore_version', arguments: {} });
    const r = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { ...rawHeaders, ...creds('lore-mcp-full_opencode', BAD_SECRET) }, body: initBody,
    });
    expect(r.status).toBe(401);
    const text = await r.text();
    expect(text).toMatch(/lore-mcp-full_opencode/);
    expect(text).not.toContain(BAD_SECRET);
    await warm.close();
  });

  it('id без секрета (и наоборот) → 401 с именем недостающего заголовка', async () => {
    const a = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, 'X-Lore-Client-Id': 'lore-mcp-tester' }, body: initBody });
    expect(a.status).toBe(401);
    expect(await a.text()).toMatch(/X-Lore-Client-Secret/);
    const b = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, 'X-Lore-Client-Secret': 'x' }, body: initBody });
    expect(b.status).toBe(401);
    expect(await b.text()).toMatch(/X-Lore-Client-Id/);
  });

  it('ни Bearer, ни пары → 401, текст называет оба способа входа', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: rawHeaders, body: initBody });
    expect(r.status).toBe(401);
    const t = await r.text();
    expect(t).toMatch(/Authorization: Bearer/);
    expect(t).toMatch(/X-Lore-Client-Id/);
    expect(t).toMatch(/X-Lore-Client-Secret/);
  });

  it('Bearer по-прежнему принимается и идёт в бэкенд как есть', async () => {
    const before = kcCalls;
    const c = await connect({ Authorization: 'Bearer tok-direct' });
    expect(versionCommit(await c.callTool({ name: 'lore_version', arguments: {} }))).toBe('Bearer tok-direct');
    expect(kcCalls).toBe(before);
    await c.close();
  });

  it('сервер без LORE_OIDC_ISSUER: пара id/секрет → 503 с именем переменной', async () => {
    const r = await fetch(`http://127.0.0.1:${bare.port}/mcp`, {
      method: 'POST', headers: { ...rawHeaders, ...creds('lore-mcp-tester', 'tester-secret-91ab') }, body: initBody,
    });
    expect(r.status).toBe(503);
    expect(await r.text()).toMatch(/LORE_OIDC_ISSUER/);
  });

  it('секрет не попадает в журнал (ни при успехе, ни при отказе)', async () => {
    // К этому месту в журнал уже записаны успешные входы, отказ по неверному секрету и
    // отказ сервера без issuer; добавим отказ по чужому id для полноты.
    await fetch(`${base}/mcp`, { method: 'POST', headers: { ...rawHeaders, ...creds('nope', GOOD_SECRET) }, body: initBody });
    const all = logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const s of [GOOD_SECRET, BAD_SECRET, 'tester-secret-91ab']) expect(all).not.toContain(s);
    expect(all).toMatch(/lore-mcp-full_opencode/); // id в журнале есть — по нему видно, кто входил
  });
});

describe('Mcp-Session-Id — не сессия агента', () => {
  it('в бэкенд не уходит X-Lore-Session-Id, если клиент сам его не прислал', async () => {
    const from = seen.length;
    const c = await connect({ Authorization: 'Bearer tok-nosession' });
    await c.callTool({ name: 'lore_version', arguments: {} });
    const hits = seen.slice(from).filter((s) => s.auth === 'Bearer tok-nosession');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((s) => s.session === undefined)).toBe(true);
    await c.close();
  });
});
