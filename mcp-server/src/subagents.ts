// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.1, решения владелицы 21.11.2026): «одна главная на harness и роли
// допом; если harness выдали младшую роль, под старшую она не пойдёт; список доступных ролей для подагентов — правило
// при запуске MCP». Сервер при старте кладёт в instructions роли, доступные подагентам этой сессии: роли не выше
// главной роли учётки, под которой запущен MCP (agent_scope токена), по порядку модели, — и правило своей учётки.
//
// Порядок ролей — копия раздела agent_profiles модели (mcp-server/model/agent-order.json): образ MCP собирается из
// mcp-server/, модель в него не попадает; совпадение с shared/model/lore-model.json держит subagents.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type AgentOrder = {
  profiles: { code: string; rank: number; parents: string[] }[];
  harness: Record<string, { main: string; suffix: string }>;
};

/** Копия порядка ролей; нет файла или он битый — null (instructions скажут «не прочитан»). */
export function readAgentOrder(): AgentOrder | null {
  try {
    const doc = JSON.parse(readFileSync(fileURLToPath(new URL('../model/agent-order.json', import.meta.url)), 'utf-8')) as AgentOrder;
    return Array.isArray(doc.profiles) && doc.harness ? doc : null;
  } catch {
    return null;
  }
}

function ancestors(order: AgentOrder, code: string): Set<string> {
  const seen = new Set<string>();
  const todo = [...(order.profiles.find(p => p.code === code)?.parents ?? [])];
  while (todo.length) {
    const c = todo.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    todo.push(...(order.profiles.find(p => p.code === c)?.parents ?? []));
  }
  return seen;
}

/** Роли не выше main (main == роль или main — её предок), по рангу; неизвестная main — пусто. */
export function rolesNotAbove(main: string, order: AgentOrder): string[] {
  if (!order.profiles.some(p => p.code === main)) return [];
  return [...order.profiles].sort((a, b) => a.rank - b.rank)
    .filter(p => p.code === main || ancestors(order, p.code).has(main)).map(p => p.code);
}

function suffixOf(harness: string | null, order: AgentOrder): string {
  if (!harness) return '';
  const short = harness.replace(/-code$/, '');
  for (const [k, v] of Object.entries(order.harness)) if (k.replace(/-code$/, '') === short) return v.suffix;
  return short === 'claude' ? '' : short;
}

/** Имя учётки роли у harness: lore-mcp-<роль>[_<суффикс>]. */
export function clientIdOf(role: string, harness: string | null, order: AgentOrder): string {
  const s = suffixOf(harness, order);
  return 'lore-mcp-' + role + (s ? '_' + s : '');
}

/** Ключ секрета: LORE_MCP_CLIENT_SECRET_<РОЛЬ>[_<HARNESS>] заглавными, «-» → «_». */
export function secretKeyOf(role: string, harness: string | null, order: AgentOrder): string {
  const s = suffixOf(harness, order);
  return ('LORE_MCP_CLIENT_SECRET_' + role + (s ? '_' + s : '')).toUpperCase().replace(/-/g, '_');
}

const RULE = 'Правило: подагенту младшей роли — своя учётка (клиент lore-mcp-<роль>[_<harness>]), не учётка этой сессии; '
  + 'в окружении его MCP LORE_MCP_SECRET_VAR = ключ секрета его роли (LORE_MCP_CLIENT_SECRET_<РОЛЬ>[_<HARNESS>]). '
  + 'Роль выше главной учётки сессии подагенту не даётся: учётка младшей роли под старшую не пойдёт.';

/**
 * Текст instructions о подагентах. main — профиль из agent_scope токена (null — клейма нет, 'ambiguous' — два разных);
 * harness — LORE_HARNESS / X-Lore-Harness. Без порядка ролей или без роли — честно «не выведен», не полный список.
 */
export function subagentInstructions(main: string | null | 'ambiguous', harness: string | null, order: AgentOrder | null): string {
  const head = 'LORE — подагенты этой сессии (OH-MCP-HOSTED-SWITCH). ';
  if (!order) return head + 'Порядок ролей не прочитан (нет model/agent-order.json у сервера) — список ролей подагентов не выведен. ' + RULE;
  if (main === 'ambiguous') return head + 'В токене несколько разных ролей (agent_scope) — ошибка учётки; список ролей подагентов не выведен. ' + RULE;
  if (!main) return head + 'Роль учётки не известна (в токене нет agent_scope: вход человека или учётка без маппера) — список ролей подагентов не выведен. ' + RULE;
  const roles = rolesNotAbove(main, order);
  if (!roles.length) return head + `Роль учётки «${main}» не из модели — список ролей подагентов не выведен. ` + RULE;
  const examples = [...new Set([roles[1], roles[roles.length - 1]].filter((r): r is string => !!r && r !== main))].map(r => `${r} → ${clientIdOf(r, harness, order)}, ${secretKeyOf(r, harness, order)}`);
  return head + `Главная учётка сессии — роль «${main}»${harness ? ` (harness ${harness})` : ''}. `
    + `Подагентам доступны роли не выше неё, по порядку модели: ${roles.join(', ')}. `
    + RULE + (examples.length ? ' Например: ' + examples.join('; ') + '.' : '');
}
