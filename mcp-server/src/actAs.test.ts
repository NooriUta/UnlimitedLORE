import { describe, expect, it } from 'vitest';
import { actAsHeader } from './backend.js';

// SPRINT_LORE_AGENT_OBSERVABILITY/AO-07, путь «full заявляет роль»: экземпляр MCP
// подагента получает LORE_ACT_AS=<профиль> и шлёт его заголовком X-Lore-Act-As на
// каждой записи. Бэкенд сужает права до матрицы профиля (AgentScopeFilter.effectiveScope).

describe('actAsHeader: заявка профиля из окружения', () => {
  it('профиль задан — заголовок X-Lore-Act-As', () => {
    expect(actAsHeader({ LORE_ACT_AS: 'tester' })).toEqual({ 'X-Lore-Act-As': 'tester' });
  });

  it('пробелы срезаются', () => {
    expect(actAsHeader({ LORE_ACT_AS: '  marketer ' })).toEqual({ 'X-Lore-Act-As': 'marketer' });
  });

  it('не задан или пуст — заголовка нет (поведение как раньше)', () => {
    expect(actAsHeader({})).toEqual({});
    expect(actAsHeader({ LORE_ACT_AS: '   ' })).toEqual({});
  });
});
