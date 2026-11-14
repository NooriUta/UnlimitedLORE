#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerLoreRead } from './tools/loreRead.js';
import { registerLoreWrite } from './tools/loreWrite.js';
import { BACKEND_FALLBACK_URL, BACKEND_URL, clientAgentScope, lorePost } from './backend.js';
import { SourceTrail } from './sourceTrail.js';
import { registerMuninn } from './tools/muninn.js';
import { registerClaudeRules } from './tools/claudeRules.js';
import { registerForgejo, forgejoConfigured } from './tools/forgejo.js';
import { registerVersion, warnIfStale } from './tools/version.js';
import { readBuildInfo } from './buildInfo.js';
import { withStrictTools } from './tools/strictTool.js';
import { legacySurfaceGate, LEGACY_CRUD_TOOLS } from './tools/entity.js';
import { corePermission, permissionForProfile, surfaceScope, type Permission } from './profile.js';

// stdio MCP server for AIDA LORE. Talks to the UnlimitedLORE backend (:9100),
// which in turn serves system_aida_lore. NEVER write to stdout — it is the
// JSON-RPC channel; diagnostics go to stderr only.
// withStrictTools (MT-09): wraps .tool() so every schema below is registered
// strict — an unknown parameter is a 400, not a silently dropped key.
//
// SPRINT_LORE_MCP_V2: сужение поверхности ДО регистрации. Две оси —
// LORE_MCP_PROFILE (конфиг) и agent_scope сервисного токена (роль клиента,
// та же, что видит бэкенд). Пересечение; ни одной оси — полная поверхность
// (прежнее поведение). Граница безопасности — бэкенд (AgentScopeFilter),
// фильтр здесь — про размер tool-payload и честную картину доступного.
//
// SE-10: версия сервера — отметка сборки (dist/build-info.json), а не
// константа '1.0.0': по константе нельзя было отличить сборку двухнедельной
// давности от сегодняшней, а именно это расхождение и прятало правки схем.
const build = readBuildInfo();

/** Собрать сужение поверхности: env-ось и ролевая ось (см. profile.ts).
 *  profiles — имена профилей, реально применённых осями (нужны legacy-оси MCPV2-3). */
async function resolveSurface() {
  const perms: Permission[] = [];
  const sources: string[] = [];
  const profiles: string[] = [];
  const envProfile = (process.env.LORE_MCP_PROFILE ?? '').trim();
  if (envProfile) {
    // Явная ошибка конфига — громко и при старте: человек чинит env, а не гадает.
    perms.push(permissionForProfile(envProfile));
    sources.push(`env:${envProfile}`);
    profiles.push(envProfile);
  }
  const scope = await clientAgentScope();
  if (scope === 'ambiguous') {
    console.error('[aida-lore-mcp] agent_scope ambiguous (несколько разных профилей в токене) — выдача сужена до core; это ошибка провижининга, бэкенд записи откажет');
    perms.push(corePermission());
    sources.push('token:ambiguous→core');
    profiles.push('core');
  } else if (scope) {
    try {
      perms.push(permissionForProfile(scope));
      sources.push(`token:${scope}`);
      profiles.push(scope);
    } catch (e) {
      // Профиль в токене без файла — дрейф провижининга; не роняем сервер,
      // сужаем до core (безопасная сторона), ошибка видна в stderr.
      console.error(`[aida-lore-mcp] ${(e as Error).message} — выдача сужена до core`);
      perms.push(corePermission());
      sources.push(`token:${scope}→core`);
      profiles.push('core');
    }
  }
  return { surface: surfaceScope(perms, sources), profiles };
}

async function main(): Promise<void> {
  const { surface, profiles } = await resolveSurface();
  // MCPV2-3: legacy-ось поверх профильной. LORE_MCP_LEGACY=1 → полная старая
  // поверхность + entity_*; профиль ≠ full → старые имена видны в рамках профиля
  // (профили ссылаются на них), entity_* — только если профиль разрешает запись;
  // дефолт (full) → покрытые старые имена скрыты, работа через entity_*.
  const legacy = process.env.LORE_MCP_LEGACY === '1';
  const narrowed = profiles.some(p => p !== 'full');
  const server = withStrictTools(
    new McpServer({ name: 'aida-lore', version: build.commit }),
    legacySurfaceGate(surface.gate, { legacy, narrowed }),
    // AO-02: след источников — копилка прочитанного, отправка после создания (бэкенд за флагом).
    (() => { const trail = new SourceTrail((p, b) => lorePost(p, b)); return (n: string, a: unknown, r: unknown) => trail.observe(n, a, r); })(),
  );

  registerLoreRead(server);
  registerLoreWrite(server);
  registerMuninn(server);
  // Правила CLAUDE переехали из репозитория в LORE (29.08.2026): main зеркалируется
  // в публичный GitHub. Эти два инструмента и есть путь туда и обратно — без них
  // перенос оставлял бы правила без способа их положить и забрать.
  registerClaudeRules(server);
  // FJ-04: forgejo_* появляются только при заявленном мосте (LORE_FORGEJO / FORGEJO_*-env);
  // без него инструментов нет вовсе — лучше, чем вечные 503 (ADR-LORE-024).
  registerForgejo(server);
  if (!forgejoConfigured()) console.error('[aida-lore-mcp] forgejo bridge off (no LORE_FORGEJO/FORGEJO_* env) — forgejo_* tools not registered');
  // SE-10: сверка своей сборки со сборкой бэкенда — инструментом для агента и
  // строкой в stderr для человека.
  registerVersion(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[aida-lore-mcp] ready — backend ${BACKEND_URL}${BACKEND_FALLBACK_URL ? ` (запасной ${BACKEND_FALLBACK_URL})` : ''}, surface: ${surface.axes ? surface.sources.join(' ∩ ') : 'full'}${legacy ? ', legacy: on (полная старая поверхность + entity_*)' : narrowed ? '' : `, consolidated: entity_* (скрыто ${LEGACY_CRUD_TOOLS.length} per-entity имён; LORE_MCP_LEGACY=1 возвращает)`}, build ${build.commit} @ ${build.built_at || 'unknown'}`);
  // После connect и без await: предупреждение не должно задерживать готовность
  // и не должно ронять старт, если бэкенд недоступен.
  void warnIfStale();
}

main().catch((e) => {
  console.error('[aida-lore-mcp] fatal:', e);
  process.exit(1);
});
