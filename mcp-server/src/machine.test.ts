import { describe, expect, it } from 'vitest';
import { machineHeader } from './backend.js';

// SPRINT_LORE_AGENT_OBSERVABILITY/AO-MACHINE-OBJ: каждая запись агента несёт машину,
// с которой сделана, — заголовком X-Lore-Machine. Бэкенд заводит вершину KnowMachine
// при отсутствии и привязывает к ней агента (машин у агента может быть несколько).

describe('machineHeader: машина сессии из окружения', () => {
  it('LORE_MACHINE_ID задан явно — он и уходит', () => {
    expect(machineHeader({ LORE_MACHINE_ID: 'lorcetus', COMPUTERNAME: 'X' }, () => 'h'))
      .toEqual({ 'X-Lore-Machine': 'lorcetus' });
  });

  it('иначе COMPUTERNAME — тот же источник, что у хука SessionStart', () => {
    expect(machineHeader({ COMPUTERNAME: 'ARHARAGA' }, () => 'h')).toEqual({ 'X-Lore-Machine': 'ARHARAGA' });
  });

  it('иначе HOSTNAME, иначе имя хоста ОС', () => {
    expect(machineHeader({ HOSTNAME: 'ci-server' }, () => 'h')).toEqual({ 'X-Lore-Machine': 'ci-server' });
    expect(machineHeader({}, () => 'my-box')).toEqual({ 'X-Lore-Machine': 'my-box' });
  });

  it('недопустимые символы заменяются, длина ограничена', () => {
    expect(machineHeader({ LORE_MACHINE_ID: ' Мой ПК #1 ' }, () => 'h')['X-Lore-Machine']).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    expect(machineHeader({ LORE_MACHINE_ID: 'a'.repeat(200) }, () => 'h')['X-Lore-Machine']).toHaveLength(64);
  });

  it('совсем нечего сказать — заголовка нет (бэкенд ответит предупреждением, а не молча)', () => {
    expect(machineHeader({}, () => '')).toEqual({});
    expect(machineHeader({ LORE_MACHINE_ID: '   ' }, () => '  ')).toEqual({});
  });
});
