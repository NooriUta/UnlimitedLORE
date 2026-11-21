// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED: MCP по адресу хоста LORE.
//
// Владелица 19.11.2026: «мне надоело локально mcp пересобирать» → «mcp лучше по
// адресу lore host». Сервер живёт за nginx фронта на https://<хост LORE>/mcp и
// выкатывается вместе с LORE (сервис lore-mcp в compose), поэтому версия MCP
// равна версии стенда и руками ничего не собирается.
//
// Контракт:
//   POST/GET/DELETE /mcp — Streamable HTTP (MCP SDK), сессия на клиента;
//   GET /mcp/health      — без входа, отметка сборки (как у /lore/version);
//   Вход на каждом запросе к /mcp — одно из двух:
//     а) Authorization: Bearer <токен клиента> — для клиентов с headersHelper
//        (Claude Code: scripts/lore-mcp-headers.mjs);
//     г) X-Lore-Client-Id + X-Lore-Client-Secret — для клиентов со статичными
//        заголовками (OpenCode и др.): токен у Keycloak берёт сервер
//        (client_credentials, clientCreds.ts), кэширует до истечения минус запас.
//        Нужен LORE_OIDC_ISSUER у сервера (не секрет). Секрет в журнал не пишется.
//     Bearer важнее пары. Нет ни того, ни другого — 401.
//     Полученным токеном MCP идёт в бэкенд: права и скоуп — ровно агента, своих
//     client_credentials у сервера нет. Токен живёт в контексте запроса
//     (AsyncLocalStorage, backend.ts), в журнал не пишется;
//   Mcp-Session-Id — сессия ТРАНСПОРТА (меняется при каждом переподключении,
//     проба 19.11), а не сессия агента: в бэкенд как X-Lore-Session-Id не уходит;
//   X-Lore-Mcp-Profile — профиль поверхности (по умолчанию full), сверяется со
//     списком agent-profiles; неизвестный — 400. Задаётся при initialize и
//     действует всю сессию.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { oidcTokenUrl, runWithClientAuth } from './backend.js';
import { CredsRejected, TokenEndpointUnavailable, createTokenBroker } from './clientCreds.js';
import { readBuildInfo } from './buildInfo.js';
import { knownProfiles, profileNameFromJwt } from './profile.js';
import { createLoreServer, resolveSurface } from './server.js';
import { readAgentOrder, subagentInstructions } from './subagents.js';

export type TransportMode = 'stdio' | 'http';

/** Режим транспорта из LORE_MCP_TRANSPORT; по умолчанию stdio — локальная разработка не меняется. */
export function transportMode(env: Record<string, string | undefined>): TransportMode {
  const v = (env.LORE_MCP_TRANSPORT ?? '').trim().toLowerCase();
  if (v === '' || v === 'stdio') return 'stdio';
  if (v === 'http') return 'http';
  throw new Error(`LORE_MCP_TRANSPORT=${env.LORE_MCP_TRANSPORT}: допустимо stdio (по умолчанию) или http`);
}

export type HttpOptions = {
  port: number;
  host?: string;
  /** Сессия без запросов дольше этого закрывается (клиент мог уйти без DELETE). */
  sessionIdleMs?: number;
  /** Предел тела запроса: base64-вложения (bragi_asset_up, asset_up) бывают крупными. */
  maxBodyBytes?: number;
  log?: (m: string) => void;
  /** Issuer realm для варианта «г»; по умолчанию LORE_OIDC_ISSUER. Пусто — вариант «г» выключен. */
  oidcIssuer?: string;
  /** Часы для кэша токенов (тесты). */
  now?: () => number;
};

type Session = { transport: StreamableHTTPServerTransport; server: McpServer; lastSeen: number; profile: string };

/** Заголовки наблюдаемости, которые клиент может прислать и которые уходят в бэкенд как есть
 *  (тот же вид, что у stdio-режима из env: машина, сессия агента, harness, act-as).
 *  X-Lore-Session-Id — только если клиент прислал его САМ; Mcp-Session-Id сюда не подставляется. */
const FORWARDED = ['x-lore-machine', 'x-lore-session-id', 'x-lore-harness', 'x-lore-act-as'] as const;
const FORWARDED_NAME: Record<(typeof FORWARDED)[number], string> = {
  'x-lore-machine': 'X-Lore-Machine',
  'x-lore-session-id': 'X-Lore-Session-Id',
  'x-lore-harness': 'X-Lore-Harness',
  'x-lore-act-as': 'X-Lore-Act-As',
};

function forwardedHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of FORWARDED) {
    const raw = req.headers[h];
    const v = (Array.isArray(raw) ? raw[0] : raw ?? '').trim();
    if (v) out[FORWARDED_NAME[h]] = v.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 64);
  }
  return out;
}

function bearerOf(req: IncomingMessage): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

function header(req: IncomingMessage, name: string): string {
  const raw = req.headers[name];
  return (Array.isArray(raw) ? raw[0] : raw ?? '').trim();
}

function jsonError(res: ServerResponse, status: number, message: string, extra: Record<string, string> = {}): void {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: status === 401 ? -32001 : -32000, message }, id: null }));
}

class BodyTooLarge extends Error {}

function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new BodyTooLarge()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export async function startHttpServer(opts: HttpOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const idleMs = opts.sessionIdleMs ?? Number(process.env.LORE_MCP_SESSION_IDLE_MS ?? 2 * 3600_000);
  const maxBody = opts.maxBodyBytes ?? Number(process.env.LORE_MCP_MAX_BODY_BYTES ?? 64 * 1024 * 1024);
  const legacy = process.env.LORE_MCP_LEGACY === '1';
  const build = readBuildInfo();
  const sessions = new Map<string, Session>();
  const issuer = (opts.oidcIssuer ?? process.env.LORE_OIDC_ISSUER ?? '').trim();
  const broker = createTokenBroker({ tokenUrl: issuer ? oidcTokenUrl(issuer) : '', now: opts.now, log });

  /** Токен запроса: Bearer как есть либо (вариант «г») выданный Keycloak по паре id/секрет.
   *  null — ответ клиенту уже отправлен. */
  async function resolveToken(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
    const bearer = bearerOf(req);
    if (bearer) return bearer;
    const id = header(req, 'x-lore-client-id');
    const secret = header(req, 'x-lore-client-secret');
    const challenge = { 'WWW-Authenticate': 'Bearer realm="lore-mcp"' };
    if (!id && !secret) {
      jsonError(res, 401,
        'Нужен вход: заголовок Authorization: Bearer <токен клиента> (клиенты с headersHelper, ' +
        'scripts/lore-mcp-headers.mjs) либо пара X-Lore-Client-Id + X-Lore-Client-Secret ' +
        '(клиент Keycloak lore-mcp-*, токен возьмёт сервер), см. docs/runbooks/mcp-hosted.md', challenge);
      return null;
    }
    if (!id || !secret) {
      jsonError(res, 401, `Пара неполная: нет заголовка ${id ? 'X-Lore-Client-Secret' : 'X-Lore-Client-Id'}`, challenge);
      return null;
    }
    const clientId = id.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 128);
    try {
      return await broker.token(clientId, secret);
    } catch (e) {
      if (e instanceof CredsRejected) { jsonError(res, 401, e.message, challenge); return null; }
      if (e instanceof TokenEndpointUnavailable) {
        jsonError(res, broker.configured ? 502 : 503, broker.configured
          ? e.message
          : 'Вход по X-Lore-Client-Id/X-Lore-Client-Secret на этом сервере не настроен: у MCP-сервера нет LORE_OIDC_ISSUER. ' +
            'Используйте Authorization: Bearer или попросите администратора стенда задать LORE_OIDC_ISSUER');
        return null;
      }
      throw e;
    }
  }

  async function closeSession(id: string, why: string): Promise<void> {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    log(`[aida-lore-mcp] сессия ${id.slice(0, 8)} закрыта (${why}), активных: ${sessions.size}`);
    await s.transport.close().catch(() => {});
    await s.server.close().catch(() => {});
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = await resolveToken(req, res);
    if (!token) return;
    const auth = { token, headers: forwardedHeaders(req) };
    const sid = header(req, 'mcp-session-id');

    if (sid) {
      const s = sessions.get(sid);
      if (!s) { jsonError(res, 404, `Сессия ${sid.slice(0, 64)} не найдена (сервер перезапущен или сессия закрыта по простою) — переподключитесь`); return; }
      s.lastSeen = Date.now();
      let body: unknown;
      if (req.method === 'POST') {
        try { body = await readJson(req, maxBody); } catch (e) {
          jsonError(res, e instanceof BodyTooLarge ? 413 : 400, e instanceof BodyTooLarge ? `Тело запроса больше ${maxBody} байт` : 'Тело запроса — не JSON');
          return;
        }
      }
      await runWithClientAuth(auth, () => s.transport.handleRequest(req, res, body));
      return;
    }

    // Без сессии — только initialize.
    if (req.method !== 'POST') { jsonError(res, 400, 'Нет заголовка Mcp-Session-Id: сначала initialize (POST /mcp)'); return; }
    let body: unknown;
    try { body = await readJson(req, maxBody); } catch (e) {
      jsonError(res, e instanceof BodyTooLarge ? 413 : 400, e instanceof BodyTooLarge ? `Тело запроса больше ${maxBody} байт` : 'Тело запроса — не JSON');
      return;
    }
    const msgs = Array.isArray(body) ? body : [body];
    if (!msgs.some((m) => isInitializeRequest(m))) {
      jsonError(res, 400, 'Нет заголовка Mcp-Session-Id: первый запрос сессии — initialize');
      return;
    }

    const profile = header(req, 'x-lore-mcp-profile') || 'full';
    const known = knownProfiles();
    if (!known.includes(profile)) {
      jsonError(res, 400, `X-Lore-Mcp-Profile=${profile.slice(0, 64)}: неизвестный профиль; допустимо: ${known.join(', ')}`);
      return;
    }
    const scope = profileNameFromJwt(token);
    const { surface, profiles } = resolveSurface({ name: profile, source: 'header' }, scope, log);
    // OH-MCP-HOSTED-SWITCH: роли подагентов — не выше главной роли учётки (agent_scope её токена).
    const server = createLoreServer(surface, profiles, legacy,
      subagentInstructions(scope, header(req, 'x-lore-harness') || null, readAgentOrder()));
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastSeen: Date.now(), profile });
        // Токен в журнал не пишется — только профиль и оси поверхности.
        log(`[aida-lore-mcp] сессия ${id.slice(0, 8)} открыта, поверхность: ${surface.sources.join(' ∩ ')}, активных: ${sessions.size}`);
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && sessions.has(id)) { sessions.delete(id); log(`[aida-lore-mcp] сессия ${id.slice(0, 8)} закрыта клиентом, активных: ${sessions.size}`); }
    };
    await server.connect(transport);
    await runWithClientAuth(auth, () => transport.handleRequest(req, res, body));
  }

  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
    if (path === '/mcp/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
        status: 'ok', transport: 'http', commit: build.commit, built_at: build.built_at, sessions: sessions.size,
      }));
      return;
    }
    if (path !== '/mcp') { jsonError(res, 404, `Нет такого пути: ${path.slice(0, 100)} (MCP — /mcp, проверка — /mcp/health)`); return; }
    handleMcp(req, res).catch((e) => {
      log(`[aida-lore-mcp] ошибка обработки ${req.method} /mcp: ${(e as Error).message}`);
      jsonError(res, 500, 'Внутренняя ошибка MCP-сервера');
    });
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.lastSeen > idleMs) void closeSession(id, 'простой');
  }, Math.min(60_000, Math.max(1000, idleMs)));
  sweep.unref();

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host ?? '0.0.0.0', () => resolve());
  });
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    close: async () => {
      clearInterval(sweep);
      await Promise.all([...sessions.keys()].map((id) => closeSession(id, 'остановка сервера')));
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
