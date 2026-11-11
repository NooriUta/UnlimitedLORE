// Главная админки «что требует внимания» (SPRINT_UXR_S7B_ADMIN/S7B-26,
// прототип docs/prototypes/s7b-admin-v6.html, экран «Главная»).
//
// Здесь только счёт по уже читаемым срезам — своих запросов Главная не
// заводит: агенты (agent_owners), роли (role_matrix), сбои MCP (mcp_failures).
import type { McpData } from './mcp';
import type { PersonRoles, RolesData } from './roles';

export { agentsWithoutMachine } from './agents';

/**
 * Люди без проектов: учётка есть, ролей нет. Только строки, которые сервер
 * ПРОВЕРИЛ (или не назвал состояние — старая сборка): «не смогли» и «нет прав»
 * про пустоту ничего не говорят, и считать их «без проектов» — враньё.
 */
export function peopleWithoutProjects(data: RolesData): PersonRoles[] {
  return data.people.filter(p => (p.state === 'checked' || p.state === 'unknown') && p.cells.length === 0);
}

/**
 * Сбои записей агентов (код ≥ 400): сумма и у скольких профилей. Срез сбоев
 * не прочитан — n = null: «не смогли проверить», а не «сбоев нет».
 */
export function mcpFailureTotal(d: McpData): { n: number | null; profiles: number } {
  if (d.failError !== null) return { n: null, profiles: 0 };
  let n = 0;
  let profiles = 0;
  for (const p of d.profiles) {
    if (p.failures && p.failures > 0) { n += p.failures; profiles += 1; }
  }
  return { n, profiles };
}
