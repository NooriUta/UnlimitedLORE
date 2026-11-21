// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MCP-HOSTED, вариант «г»: вход по паре
// X-Lore-Client-Id + X-Lore-Client-Secret для клиентов без headersHelper (OpenCode и
// другие — у них заголовки статичны, свежий Bearer подставить нечем).
//
// Сервер сам берёт токен у Keycloak (client_credentials, тот же token endpoint, что у
// stdio-режима — oidcTokenUrl в backend.ts) и держит его в кэше до истечения минус запас.
// Ключ кэша — client_id + SHA-256 секрета: неверный секрет к известному id не получит
// чужой токен из кэша, а сам секрет в памяти кэша не хранится.
//
// Секрет не пишется ни в журнал, ни в текст ошибки: из ответа Keycloak берётся только
// код ошибки (error), без error_description, и любое случайное вхождение секрета в
// сообщении всё равно вымарывается.
import { createHash } from 'node:crypto';

export class CredsRejected extends Error {}
export class TokenEndpointUnavailable extends Error {}

export type TokenBrokerOptions = {
  /** Полный адрес token endpoint; пусто — вариант «г» на этом сервере не настроен. */
  tokenUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Запас до истечения: токен, которому осталось меньше, считается протухшим. */
  marginMs?: number;
  timeoutMs?: number;
  log?: (m: string) => void;
};

type Entry = { token: string; expiresAt: number };

export type TokenBroker = {
  configured: boolean;
  token: (clientId: string, secret: string) => Promise<string>;
};

function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

export function createTokenBroker(opts: TokenBrokerOptions): TokenBroker {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const margin = opts.marginMs ?? 60_000;
  const timeout = opts.timeoutMs ?? 15_000;
  const log = opts.log ?? (() => {});
  const cache = new Map<string, Entry>();
  // Параллельные запросы одного клиента ждут один поход в Keycloak, а не N.
  const inflight = new Map<string, Promise<string>>();

  async function fetchToken(key: string, clientId: string, secret: string): Promise<string> {
    let res: Response;
    try {
      res = await f(opts.tokenUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      const c = (e as { cause?: { code?: string } }).cause;
      const why = scrub(c?.code ?? (e as Error).message ?? String(e), secret);
      log(`[aida-lore-mcp] token endpoint недоступен для ${clientId}: ${why}`);
      throw new TokenEndpointUnavailable(`Keycloak недоступен (${why}) — токен для ${clientId} не получен`);
    }
    if (!res.ok) {
      let code = '';
      try { code = String(((await res.json()) as { error?: unknown }).error ?? ''); } catch { /* не JSON */ }
      code = scrub(code, secret).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        log(`[aida-lore-mcp] Keycloak отказал ${clientId}: ${res.status}${code ? ` ${code}` : ''}`);
        throw new CredsRejected(
          `Keycloak отказал в токене клиенту ${clientId} (${res.status}${code ? ` ${code}` : ''}): ` +
          'проверьте X-Lore-Client-Id и X-Lore-Client-Secret');
      }
      log(`[aida-lore-mcp] token endpoint ответил ${res.status} для ${clientId}`);
      throw new TokenEndpointUnavailable(`Keycloak ответил ${res.status} — токен для ${clientId} не получен`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new TokenEndpointUnavailable(`Keycloak не вернул access_token для ${clientId}`);
    const ttlMs = Math.max(0, Number(body.expires_in ?? 0) * 1000);
    // Короткоживущий токен (ttl ≤ запаса) не кэшируется дольше половины своей жизни.
    const expiresAt = now() + (ttlMs > margin ? ttlMs - margin : Math.floor(ttlMs / 2));
    cache.set(key, { token: body.access_token, expiresAt });
    log(`[aida-lore-mcp] токен для ${clientId} получен (вариант «г»), живёт ${Math.round(ttlMs / 1000)} с`);
    return body.access_token;
  }

  return {
    configured: !!(opts.tokenUrl ?? '').trim(),
    async token(clientId, secret) {
      if (!(opts.tokenUrl ?? '').trim()) {
        throw new TokenEndpointUnavailable('LORE_OIDC_ISSUER у MCP-сервера не задан');
      }
      const key = `${clientId}\u0000${createHash('sha256').update(secret).digest('hex')}`;
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now()) return hit.token;
      if (hit) cache.delete(key);
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = fetchToken(key, clientId, secret).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}
