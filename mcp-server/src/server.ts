// Сборка экземпляра MCP-сервера LORE — общая для stdio и HTTP-режима
// (AO-MCP-HOSTED). В stdio экземпляр один на процесс; в HTTP — один на сессию
// клиента, со своей поверхностью (профиль из заголовка ∩ agent_scope его токена).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLoreRead } from './tools/loreRead.js';
import { registerLoreWrite } from './tools/loreWrite.js';
import { lorePost } from './backend.js';
import { SourceTrail } from './sourceTrail.js';
import { registerMuninn } from './tools/muninn.js';
import { registerClaudeRules } from './tools/claudeRules.js';
import { registerForgejo } from './tools/forgejo.js';
import { registerVersion } from './tools/version.js';
import { readBuildInfo } from './buildInfo.js';
import { withStrictTools } from './tools/strictTool.js';
import { legacySurfaceGate } from './tools/entity.js';
import { corePermission, permissionForProfile, surfaceScope, type Permission, type SurfaceScope } from './profile.js';

// SPRINT_LORE_MCP_V2: сужение поверхности ДО регистрации. Две оси —
// профиль (LORE_MCP_PROFILE в stdio, X-Lore-Mcp-Profile в HTTP) и agent_scope
// токена (роль клиента, та же, что видит бэкенд). Пересечение; ни одной оси —
// полная поверхность. Граница безопасности — бэкенд (AgentScopeFilter),
// фильтр здесь — про размер tool-payload и честную картину доступного.

/** Собрать сужение поверхности: ось профиля и ролевая ось (см. profile.ts).
 *  profiles — имена профилей, реально применённых осями (нужны legacy-оси MCPV2-3). */
export function resolveSurface(
  profile: { name: string; source: string } | null,
  scope: string | null | 'ambiguous',
  log: (m: string) => void = console.error,
): { surface: SurfaceScope; profiles: string[] } {
  const perms: Permission[] = [];
  const sources: string[] = [];
  const profiles: string[] = [];
  if (profile) {
    // Явная ошибка конфига — громко: человек чинит конфиг, а не гадает.
    perms.push(permissionForProfile(profile.name));
    sources.push(`${profile.source}:${profile.name}`);
    profiles.push(profile.name);
  }
  if (scope === 'ambiguous') {
    log('[aida-lore-mcp] agent_scope ambiguous (несколько разных профилей в токене) — выдача сужена до core; это ошибка провижининга, бэкенд записи откажет');
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
      // сужаем до core (безопасная сторона), ошибка видна в журнале.
      log(`[aida-lore-mcp] ${(e as Error).message} — выдача сужена до core`);
      perms.push(corePermission());
      sources.push(`token:${scope}→core`);
      profiles.push('core');
    }
  }
  return { surface: surfaceScope(perms, sources), profiles };
}

// SE-10: версия сервера — отметка сборки (dist/build-info.json), а не константа.
const build = readBuildInfo();

/** Экземпляр сервера со всеми инструментами в рамках поверхности. */
// OH-MCP-HOSTED-SWITCH: instructions — роли подагентов этой сессии и правило своей учётки (subagents.ts).
export function createLoreServer(surface: SurfaceScope, profiles: string[], legacy: boolean, instructions?: string): McpServer {
  // MCPV2-3: legacy-ось поверх профильной. legacy → полная старая
  // поверхность + entity_*; профиль ≠ full → старые имена видны в рамках профиля
  // (профили ссылаются на них), entity_* — только если профиль разрешает запись;
  // дефолт (full) → покрытые старые имена скрыты, работа через entity_*.
  const narrowed = profiles.some(p => p !== 'full');
  const server = withStrictTools(
    new McpServer({ name: 'aida-lore', version: build.commit }, instructions ? { instructions } : undefined),
    legacySurfaceGate(surface.gate, { legacy, narrowed }),
    // AO-02: след источников — копилка прочитанного, отправка после создания (бэкенд за флагом).
    (() => { const trail = new SourceTrail((p, b) => lorePost(p, b)); return (n: string, a: unknown, r: unknown) => trail.observe(n, a, r); })(),
  );

  registerLoreRead(server);
  registerLoreWrite(server);
  registerMuninn(server);
  // Правила CLAUDE переехали из репозитория в LORE (29.08.2026): main зеркалируется
  // в публичный GitHub. Эти инструменты и есть путь туда и обратно.
  registerClaudeRules(server);
  // FJ-04: forgejo_* появляются только при заявленном мосте (LORE_FORGEJO / FORGEJO_*-env);
  // без него инструментов нет вовсе — лучше, чем вечные 503 (ADR-LORE-024).
  registerForgejo(server);
  // SE-10: сверка своей сборки со сборкой бэкенда.
  registerVersion(server);
  return server;
}
