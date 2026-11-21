#!/usr/bin/env node
// Заголовки для MCP LORE по адресу (AO-MCP-HOSTED) — помощник для headersHelper Claude Code.
//
// Зачем: токен client_credentials живёт минуты, а статичный "Bearer ${LORE_MCP_TOKEN}" в
// .mcp.json протухает посреди сессии. Проба 19.11.2026: Claude Code запускает headersHelper
// при подключении и после 401, сам берёт новые заголовки и повторяет вызов. Помощник отдаёт
// свежий токен и печатает в stdout JSON заголовков — так его ждёт headersHelper.
//
// Кэш: токен держится в файле пользователя (~/.lore/mcp-token.json или LORE_MCP_TOKEN_CACHE)
// до истечения минус 60 с, чтобы не ходить в Keycloak на каждое подключение. Ключ записи —
// issuer + client_id + SHA-256 секрета; сам секрет в файл не пишется. Файл — права 0600.
//
// Вход (env): LORE_OIDC_ISSUER, LORE_MCP_CLIENT_ID, LORE_MCP_CLIENT_SECRET (или переменная, названная в
// LORE_MCP_SECRET_VAR) — те же, что у
// stdio-режима; LORE_MCP_PROFILE (по умолчанию full); LORE_MACHINE_ID | COMPUTERNAME |
// HOSTNAME | os.hostname() — машина (X-Lore-Machine); LORE_HARNESS (по умолчанию claude-code).
// X-Lore-Session-Id помощник не выдаёт: номер сессии Claude Code в headersHelper не приходит
// (проба 19.11), а Mcp-Session-Id меняется при каждом переподключении и сессией агента не является.
// stdout — ТОЛЬКО JSON заголовков; ошибки — в stderr, токен и секрет в stderr не печатаются.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

const MARGIN_MS = 60_000;
const env = (k) => (process.env[k] ?? '').trim();

// Патч 1.18.1: LORE_MCP_SECRET_VAR — ИМЯ переменной, где лежит секрет (обёртка «infisical run … -- node
// lore-mcp-headers.mjs» отдаёт его под своим именем, например LORE_MCP_CLIENT_SECRET_FULL). По умолчанию
// LORE_MCP_CLIENT_SECRET. В ошибке называется имя переменной, значение секрета — никогда.
const secretVar = env('LORE_MCP_SECRET_VAR') || 'LORE_MCP_CLIENT_SECRET';
if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(secretVar)) {
  console.error('lore-mcp-headers: LORE_MCP_SECRET_VAR — не имя переменной окружения');
  process.exit(2);
}
const need = ['LORE_OIDC_ISSUER', 'LORE_MCP_CLIENT_ID', secretVar];
const missing = need.filter((k) => !env(k));
if (missing.length) {
  console.error(`lore-mcp-headers: нет ${missing.join(', ')} — токен взять не из чего`
    + (secretVar !== 'LORE_MCP_CLIENT_SECRET' && missing.includes(secretVar) ? ` (имя переменной секрета задано LORE_MCP_SECRET_VAR)` : ''));
  process.exit(2);
}
const issuer = env('LORE_OIDC_ISSUER').replace(/\/+$/, '');
const clientId = env('LORE_MCP_CLIENT_ID');
const secret = env(secretVar);
const cacheFile = env('LORE_MCP_TOKEN_CACHE') || join(homedir(), '.lore', 'mcp-token.json');
const key = `${issuer}|${clientId}|${createHash('sha256').update(secret).digest('hex')}`;

function readCache() {
  try {
    const all = JSON.parse(readFileSync(cacheFile, 'utf8'));
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

function writeCache(all) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    renameSync(tmp, cacheFile);
    try { chmodSync(cacheFile, 0o600); } catch { /* Windows: права наследуются от профиля */ }
  } catch (e) {
    // Кэш — удобство: не записался — токен всё равно выдаём.
    console.error(`lore-mcp-headers: кэш токена не записан (${e.code ?? e.message})`);
  }
}

async function freshToken() {
  const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => { console.error(`lore-mcp-headers: Keycloak недоступен: ${e.cause?.code ?? e.name}`); process.exit(1); });
  if (!res.ok) {
    let code = '';
    try { code = String((await res.json()).error ?? ''); } catch { /* не JSON */ }
    code = code.split(secret).join('***').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
    console.error(`lore-mcp-headers: Keycloak отказал клиенту ${clientId}: ${res.status}${code ? ` ${code}` : ''}`);
    process.exit(1);
  }
  const body = await res.json();
  if (!body.access_token) { console.error('lore-mcp-headers: Keycloak не вернул access_token'); process.exit(1); }
  return { token: body.access_token, ttlMs: Math.max(0, Number(body.expires_in ?? 0) * 1000) };
}

const cache = readCache();
const now = Date.now();
for (const [k, v] of Object.entries(cache)) if (!v || typeof v.expires_at !== 'number' || v.expires_at <= now) delete cache[k];
let token = cache[key] && cache[key].expires_at - MARGIN_MS > now ? cache[key].access_token : '';
if (!token) {
  const got = await freshToken();
  token = got.token;
  cache[key] = { access_token: token, expires_at: now + got.ttlMs };
  writeCache(cache);
}

const clean = (v) => (v ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 64);
const headers = {
  Authorization: `Bearer ${token}`,
  'X-Lore-Mcp-Profile': env('LORE_MCP_PROFILE') || 'full',
};
let host = '';
try { host = hostname(); } catch { /* нет имени хоста */ }
const machine = clean(env('LORE_MACHINE_ID') || env('COMPUTERNAME') || env('HOSTNAME') || host);
if (machine) headers['X-Lore-Machine'] = machine;
headers['X-Lore-Harness'] = clean(env('LORE_HARNESS') || 'claude-code');
process.stdout.write(JSON.stringify(headers));
