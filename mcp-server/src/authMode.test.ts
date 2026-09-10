import { describe, expect, it } from 'vitest';
import { authMode } from './backend.js';

// SPRINT_LORE_AGENT_OBSERVABILITY/AO-07. Частичная настройка OIDC обязана
// ОТКАЗЫВАТЬ, а не откатываться на заголовок роли.
//
// Что было: авторизация токеном включалась, только если заданы все три
// переменные (issuer, client id, secret). Иначе MCP молча слал старый
// заголовок X-Seer-Role из LORE_SEER_ROLE — а в .mcp.json там admin.
// Значит запись сервера под профиль tester, которой забыли подать секрет,
// стартовала С ПРАВАМИ АДМИНИСТРАТОРА: обратное ограничению, без единой
// ошибки. Та же ловушка, что с легаси-клиентом lore-mcp без agent_scope,
// только в новом обличье.
//
// Правило теперь: всё или ничего. Ни одной переменной — прежний режим
// заголовка (dev, осознанно). Все три — токен. Любая частичная комбинация —
// отказ, НАЗЫВАЮЩИЙ пропущенные переменные: молчаливый отказ неотличим от
// поломки, а отказ без имени заставляет гадать, чего не хватает.

const ISSUER = 'https://kc.example/realms/omilore';

describe('authMode', () => {
  // ── положительный контроль: законные режимы не ломаются ────────────────
  it('все три переменные — режим токена', () => {
    expect(authMode({
      LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_ID: 'lore-mcp-tester', LORE_MCP_CLIENT_SECRET: 's',
    })).toBe('oidc');
  });

  it('ни одной переменной — прежний режим заголовка (dev, осознанно)', () => {
    // Без этой проверки правка, запретившая заголовок совсем, прошла бы
    // остальные тесты и сломала бы локальную разработку, выглядя правильной.
    expect(authMode({})).toBe('header');
  });

  // ── основное: частичная настройка — отказ с именем ─────────────────────
  it('клиент задан, секрета нет — отказ, а не админский заголовок', () => {
    // Ровно опасный случай: профиль назначен, секрет забыли подать.
    expect(() => authMode({ LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_ID: 'lore-mcp-tester' }))
      .toThrow(/LORE_MCP_CLIENT_SECRET/);
  });

  it('клиент задан, issuer нет — отказ с именем пропущенной переменной', () => {
    expect(() => authMode({ LORE_MCP_CLIENT_ID: 'lore-mcp-tester', LORE_MCP_CLIENT_SECRET: 's' }))
      .toThrow(/LORE_OIDC_ISSUER/);
  });

  it('секрет задан без клиента — тоже частичная настройка и отказ', () => {
    expect(() => authMode({ LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_SECRET: 's' }))
      .toThrow(/LORE_MCP_CLIENT_ID/);
  });

  it('пустые строки считаются незаданными, а не заданными', () => {
    // .mcp.json с "${LORE_MCP_CLIENT_SECRET}" при незаданной переменной даёт
    // пустую строку, а не отсутствие ключа. Счесть её «заданной» значило бы
    // пропустить ровно тот случай, ради которого тест написан.
    expect(() => authMode({
      LORE_OIDC_ISSUER: ISSUER, LORE_MCP_CLIENT_ID: 'lore-mcp-tester', LORE_MCP_CLIENT_SECRET: '',
    })).toThrow(/LORE_MCP_CLIENT_SECRET/);
  });
});
