// Подпись «кто» для агента — то же правило, что у сервера (WhoLabel.java), для мест, где строку собирает клиент
// (список «Агенты»). SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-HUMAN-NAME, владелица 21.11.2026: «Claude Code ·
// full» вместо учётки, «и машину если есть, если нет пока так». Учётка — подсказкой/полем, текстом не подменяет имя.

const MCP_CLIENT = /^lore-mcp-([A-Za-z0-9-]+?)(?:_.*)?$/;
const NO_MACHINE = new Set(['(unknown)', '(n/a)']);

/** Профиль из учётки MCP: lore-mcp-full_kimi → full; не учётка MCP — null. */
export function profileOf(clientId: string | null | undefined): string | null {
  const m = clientId ? MCP_CLIENT.exec(clientId.trim()) : null;
  return m ? m[1] : null;
}

const clean = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

/** «имя · профиль · машина»; имени нет — harness; не знаем ничего — учётка. */
export function agentLabel(a: { name?: string | null; harness?: string | null; clientId?: string | null; machine?: string | null }): string {
  const parts: string[] = [];
  const who = clean(a.name) ?? clean(a.harness);
  if (who) parts.push(who);
  const profile = profileOf(a.clientId);
  if (profile) parts.push(profile);
  const machine = clean(a.machine);
  if (machine && !NO_MACHINE.has(machine)) parts.push(machine);
  return parts.length ? parts.join(' · ') : (a.clientId ?? '');
}
