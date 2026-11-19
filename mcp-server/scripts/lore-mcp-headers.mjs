#!/usr/bin/env node
// Заголовки для MCP LORE по адресу (AO-MCP-HOSTED) — помощник для headersHelper клиента.
//
// Зачем: токен client_credentials живёт минуты, а статичный "Bearer ${LORE_MCP_TOKEN}" в
// .mcp.json протухает посреди сессии. Помощник берёт свежий токен у Keycloak при каждом
// запуске и печатает в stdout JSON заголовков — так его ждёт headersHelper Claude Code.
//
// Вход (env): LORE_OIDC_ISSUER, LORE_MCP_CLIENT_ID, LORE_MCP_CLIENT_SECRET — те же, что у
// stdio-режима; LORE_MCP_PROFILE (по умолчанию full); LORE_MACHINE_ID | COMPUTERNAME |
// HOSTNAME — машина (X-Lore-Machine); LORE_HARNESS; CLAUDE_CODE_SESSION_ID, если есть.
// stdout — ТОЛЬКО JSON заголовков; ошибки — в stderr, токен в stderr не печатается.
import { hostname } from 'node:os';

const need = ['LORE_OIDC_ISSUER', 'LORE_MCP_CLIENT_ID', 'LORE_MCP_CLIENT_SECRET'];
const missing = need.filter((k) => !(process.env[k] ?? '').trim());
if (missing.length) {
  console.error(`lore-mcp-headers: нет ${missing.join(', ')} — токен взять не из чего`);
  process.exit(2);
}
const issuer = process.env.LORE_OIDC_ISSUER.trim().replace(/\/$/, '');
const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.LORE_MCP_CLIENT_ID.trim(),
    client_secret: process.env.LORE_MCP_CLIENT_SECRET.trim(),
  }),
  signal: AbortSignal.timeout(15000),
}).catch((e) => { console.error(`lore-mcp-headers: Keycloak недоступен: ${e.cause?.code ?? e.message}`); process.exit(1); });
if (!res.ok) {
  console.error(`lore-mcp-headers: Keycloak ответил ${res.status} (${(await res.text()).slice(0, 200)})`);
  process.exit(1);
}
const { access_token: token } = await res.json();
const clean = (v) => (v ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 64);
const headers = {
  Authorization: `Bearer ${token}`,
  'X-Lore-Mcp-Profile': (process.env.LORE_MCP_PROFILE || 'full').trim(),
};
const machine = clean(process.env.LORE_MACHINE_ID || process.env.COMPUTERNAME || process.env.HOSTNAME || hostname());
if (machine) headers['X-Lore-Machine'] = machine;
if (clean(process.env.LORE_HARNESS)) headers['X-Lore-Harness'] = clean(process.env.LORE_HARNESS);
if (clean(process.env.CLAUDE_CODE_SESSION_ID)) headers['X-Lore-Session-Id'] = clean(process.env.CLAUDE_CODE_SESSION_ID);
process.stdout.write(JSON.stringify(headers));
