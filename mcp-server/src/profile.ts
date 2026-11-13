// Профильная выдача инструментов MCP (SPRINT_LORE_MCP_V2/MCPV2-1, MCPV2-2).
//
// Поверхность сервера сужается до того, что клиенту можно, — по двум осям:
//   1) LORE_MCP_PROFILE — явный выбор конфигом (core | full | имя профиля из
//      agent-profiles/); для субагентских и лёгких сессий;
//   2) роль клиента — клейм agent_scope его сервисного токена (OIDC-режим),
//      тот же профиль, что бэкенд уже применяет (AgentScopeFilter).
// Пересечение: инструмент виден, только если разрешён ОБЕИМЯ осями.
//
// Граница безопасности — бэкенд (AgentScopeFilter отказывает записью с причиной);
// фильтр здесь — про размер tool-payload и честную картину «что тебе доступно».
// Профили разрешений читаются из agent-profiles/*.json — тех же файлов, что
// OpenCode-агенты (mcp-server/agent-profiles/README.md); двойного учёта нет.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Verdict = 'allow' | 'deny';
export type Permission = Record<string, Verdict>;

/** Read-only профиль: срезы, поиск, граф, качество, версия. Ничего не пишет. */
const CORE_TOOLS = [
  'list_slices', 'query_slice', 'changed', 'run_block', 'search', 'search_similar',
  'task_shape', 'machine_acl', 'harness_list', 'graph', 'quality_check', 'lore_version',
] as const;

export function corePermission(): Permission {
  const p: Permission = { '*': 'deny' };
  for (const t of CORE_TOOLS) p[t] = 'allow';
  return p;
}

export function fullPermission(): Permission {
  return { '*': 'allow' };
}

/**
 * Клейм agent_scope токена → имя профиля (backend AgentScopeFilter.agentScopeOf:
 * значение без префикса «agent-», повторы маппера схлопываются, ДВА РАЗНЫХ
 * профиля — ошибка провижининга). Возвращаем:
 *   строку-профиль | null (клейма нет — человек/легаси) | 'ambiguous' (отказ).
 * Подпись токена здесь не проверяется: токен получен с нашего token-endpoint,
 * а граница прав — бэкенд; фильтр честности не является доверенной границей.
 */
export function profileNameFromJwt(jwt: string): string | null | 'ambiguous' {
  const part = jwt.split('.')[1];
  if (!part) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const raw = claims['agent_scope'];
  if (raw == null) return null;
  const values = Array.isArray(raw) ? raw : [raw];
  const profiles = new Set<string>();
  for (const v of values) {
    const s = String(v).replace(/^"|"$/g, '').trim();
    if (!s) continue;
    profiles.add(s.startsWith('agent-') ? s.slice('agent-'.length) : s);
  }
  if (profiles.size === 0) return null;
  if (profiles.size > 1) return 'ambiguous';
  return [...profiles][0];
}

/** Загрузить профиль разрешений: имя файла из agent-profiles/, либо core/full. */
export function permissionForProfile(name: string): Permission {
  if (name === 'full') return fullPermission();
  if (name === 'core') return corePermission();
  const url = new URL(`../agent-profiles/${name}.json`, import.meta.url);
  let doc: { permission?: Permission };
  try {
    doc = JSON.parse(readFileSync(fileURLToPath(url), 'utf-8')) as { permission?: Permission };
  } catch {
    throw new Error(`LORE_MCP_PROFILE=${name}: нет agent-profiles/${name}.json (и это не core/full)`);
  }
  if (!doc.permission || typeof doc.permission !== 'object') {
    throw new Error(`agent-profiles/${name}.json: нет блока permission`);
  }
  return doc.permission;
}

function matches(rule: string, tool: string): boolean {
  if (rule === '*') return true;
  if (rule.endsWith('*')) return tool.startsWith(rule.slice(0, -1));
  return rule === tool;
}

/**
 * Одна матрица разрешений → предикат. Семантика OpenCode: правила в порядке
 * файла, ПОБЕЖДАЕТ ПОСЛЕДНЕЕ совпавшее (поэтому «doc_*: allow» выше «doc_del:
 * deny» не прячет deny); без совпадений — запрет (в файлах профилей «*» первым).
 */
export function gateFor(permissions: Permission[]): (tool: string) => boolean {
  return (tool: string): boolean => {
    for (const perm of permissions) {
      let verdict: Verdict | undefined;
      for (const [rule, v] of Object.entries(perm)) {
        if (matches(rule, tool)) verdict = v;
      }
      if (verdict !== 'allow') return false;
    }
    return true;
  };
}

export type SurfaceScope = {
  /** Источники для журнала/отладки: env, token, default. */
  sources: string[];
  gate: (tool: string) => boolean;
  /** Сколько осей сужения задействовано (0 = полная поверхность). */
  axes: number;
};

/**
 * Собрать сужение поверхности. perms собираются в index.ts:
 * env-ось (LORE_MCP_PROFILE) и/или ролевая ось (agent_scope токена);
 * ни одной — полная поверхность (прежнее поведение, обратная совместимость).
 */
export function surfaceScope(perms: Permission[], sources: string[]): SurfaceScope {
  return { sources, gate: gateFor(perms), axes: perms.length };
}

export { CORE_TOOLS };
