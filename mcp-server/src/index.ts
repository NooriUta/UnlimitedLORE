#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BACKEND_FALLBACK_URL, BACKEND_URL, clientAgentScope } from './backend.js';
import { forgejoConfigured } from './tools/forgejo.js';
import { warnIfStale } from './tools/version.js';
import { readBuildInfo } from './buildInfo.js';
import { LEGACY_CRUD_TOOLS } from './tools/entity.js';
import { createLoreServer, resolveSurface } from './server.js';
import { readAgentOrder, subagentInstructions } from './subagents.js';
import { httpConfig, httpStartupWarnings, startHttpServer, transportMode } from './http.js';

// MCP server for AIDA LORE. Talks to the UnlimitedLORE backend (:9100),
// which in turn serves system_aida_lore.
//
// Два транспорта (AO-MCP-HOSTED, владелица 19.11.2026: «мне надоело локально
// mcp пересобирать»):
//   stdio (по умолчанию) — локальный процесс сессии, как раньше. NEVER write to
//     stdout — it is the JSON-RPC channel; diagnostics go to stderr only;
//   http (LORE_MCP_TRANSPORT=http) — Streamable HTTP по адресу хоста LORE
//     (…/mcp), выкатывается вместе с LORE; токен и профиль — от клиента
//     в каждом запросе (см. http.ts).
//
// withStrictTools (MT-09): every schema is registered strict — an unknown
// parameter is a 400, not a silently dropped key (см. server.ts).
//
// SE-10: версия сервера — отметка сборки (dist/build-info.json), а не
// константа '1.0.0': по константе нельзя было отличить сборку двухнедельной
// давности от сегодняшней, а именно это расхождение и прятало правки схем.
const build = readBuildInfo();

async function mainStdio(): Promise<void> {
  const envProfile = (process.env.LORE_MCP_PROFILE ?? '').trim();
  const scope = await clientAgentScope();
  const { surface, profiles } = resolveSurface(
    envProfile ? { name: envProfile, source: 'env' } : null,
    scope,
  );
  const legacy = process.env.LORE_MCP_LEGACY === '1';
  const narrowed = profiles.some(p => p !== 'full');
  // OH-MCP-HOSTED-SWITCH: роли подагентов — не выше главной роли учётки (agent_scope токена).
  const server = createLoreServer(surface, profiles, legacy,
    subagentInstructions(scope, (process.env.LORE_HARNESS ?? '').trim() || null, readAgentOrder()));
  if (!forgejoConfigured()) console.error('[aida-lore-mcp] forgejo bridge off (no LORE_FORGEJO/FORGEJO_* env) — forgejo_* tools not registered');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[aida-lore-mcp] ready — backend ${BACKEND_URL}${BACKEND_FALLBACK_URL ? ` (запасной ${BACKEND_FALLBACK_URL})` : ''}, surface: ${surface.axes ? surface.sources.join(' ∩ ') : 'full'}${legacy ? ', legacy: on (полная старая поверхность + entity_*)' : narrowed ? '' : `, consolidated: entity_* (скрыто ${LEGACY_CRUD_TOOLS.length} per-entity имён; LORE_MCP_LEGACY=1 возвращает)`}, build ${build.commit} @ ${build.built_at || 'unknown'}`);
  // После connect и без await: предупреждение не должно задерживать готовность
  // и не должно ронять старт, если бэкенд недоступен.
  void warnIfStale();
}

async function mainHttp(): Promise<void> {
  // ISS-04: LORE_MCP_HOST (по умолчанию 127.0.0.1), LORE_MCP_PORT, LORE_MCP_TOKEN, LORE_MCP_CORS_ORIGINS.
  const cfg = httpConfig(process.env);
  for (const w of httpStartupWarnings(cfg)) console.error(w);
  const { port: bound } = await startHttpServer(cfg);
  console.error(`[aida-lore-mcp] ready (http) — ${cfg.host}:${bound}/mcp, health /health и /mcp/health, токен шлюза ${cfg.token ? 'задан' : 'не задан'}, CORS ${cfg.corsOrigins.length ? cfg.corsOrigins.join(' ') : 'выключен'}, backend ${BACKEND_URL}${BACKEND_FALLBACK_URL ? ` (запасной ${BACKEND_FALLBACK_URL})` : ''}, forgejo bridge ${forgejoConfigured() ? 'on' : 'off'}, build ${build.commit} @ ${build.built_at || 'unknown'}`);
}

(async () => (transportMode(process.env) === 'http' ? mainHttp() : mainStdio()))().catch((e) => {
  console.error('[aida-lore-mcp] fatal:', e);
  process.exit(1);
});
