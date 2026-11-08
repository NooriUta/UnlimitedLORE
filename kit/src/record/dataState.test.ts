// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30 — «Состояние данных».
//
// Владелица: блок должен говорить, что проверено, что не смогли проверить и
// что обрезано. Это прямое продолжение правила, по которому у нас построено
// всё остальное: «не смогли проверить» ≠ «пусто».
//
// Источник — meta ответа: errors (блок не прочитался), truncated/total/
// returned (выдача обрезана) и, когда бэкенд начнёт отдавать, sources
// (состояние по каждому блоку). Пока sources нет, состояние выводится из
// того, что уже есть, — и это честно: мы не притворяемся, что знаем больше.
import { describe, expect, it } from 'vitest';
import { dataStateOf } from './dataState';

describe('S4-30 · состояние данных', () => {
  it('всё прочитано и ничего не обрезано — блоку нечего сказать', () => {
    const s = dataStateOf({ generated_at: '2026-11-08T00:00:00Z', total: 5, returned: 5, truncated: false });
    expect(s.hasAnything).toBe(false);
    expect(s.failed).toEqual([]);
    expect(s.truncated).toBeUndefined();
  });

  it('ошибка блока — «не смогли проверить», с названием блока и причиной', () => {
    const s = dataStateOf({ generated_at: 'x', errors: [{ block: 'edges', reason: 'HTTP 403' }] });
    expect(s.failed).toEqual([{ block: 'edges', reason: 'HTTP 403' }]);
    expect(s.hasAnything).toBe(true);
  });

  it('обрезанная выдача — сколько показано из скольких', () => {
    const s = dataStateOf({ generated_at: 'x', truncated: true, total: 500, returned: 100 });
    expect(s.truncated).toEqual({ returned: 100, total: 500 });
  });

  it('обрезано, но сколько всего — неизвестно: не выдумываем число', () => {
    const s = dataStateOf({ generated_at: 'x', truncated: true, returned: 100 });
    expect(s.truncated).toEqual({ returned: 100 });
  });

  it('total равен returned при truncated — доверяем флагу, а не арифметике', () => {
    // Сервер сказал «обрезано»; молча решить, что он ошибся, нельзя.
    const s = dataStateOf({ generated_at: 'x', truncated: true, total: 100, returned: 100 });
    expect(s.truncated).toEqual({ returned: 100, total: 100 });
  });

  it('data_state от сервера — главный источник, когда он есть', () => {
    // Имя поля согласовано с серверной сессией 08.11.2026: ok / error / truncated.
    const s = dataStateOf({
      generated_at: 'x',
      data_state: [
        { block: 'tasks', state: 'ok' },
        { block: 'edges', state: 'error', reason: 'таймаут' },
        { block: 'news', state: 'truncated' },
      ],
    } as never);
    expect(s.checked).toEqual(['tasks']);
    expect(s.failed).toEqual([{ block: 'edges', reason: 'таймаут' }]);
    expect(s.truncatedBlocks).toEqual(['news']);
  });

  it('прежнее имя поля sources ещё принимается — переход не ломает ничего', () => {
    const s = dataStateOf({ generated_at: 'x', sources: [{ block: 'edges', state: 'failed', reason: 'таймаут' }] } as never);
    expect(s.failed).toEqual([{ block: 'edges', reason: 'таймаут' }]);
  });

  it('сводка и errors вместе не задваиваются', () => {
    const s = dataStateOf({
      generated_at: 'x',
      errors: [{ block: 'edges', reason: 'HTTP 403' }],
      data_state: [{ block: 'edges', state: 'error', reason: 'HTTP 403' }],
    } as never);
    expect(s.failed).toHaveLength(1);
  });

  it('незнакомое состояние блока не глотаем: оно попадает в «не смогли проверить»', () => {
    const s = dataStateOf({ generated_at: 'x', data_state: [{ block: 'x', state: 'что-то новое' }] } as never);
    expect(s.failed[0].block).toBe('x');
    expect(s.failed[0].reason).toMatch(/что-то новое/);
  });
});
