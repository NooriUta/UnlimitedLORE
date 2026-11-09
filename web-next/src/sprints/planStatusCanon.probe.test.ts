// Проба канона статусов на РЕАЛЬНЫХ строках корпуса
// (аудит 09.11, находка D-03 · SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// Аудит намерил «56 задач без статусов». Серверная сессия прогнала весь корпус
// (4802 задачи, то же выражение статуса, что у `tasks_of_sprint`) и дала числа:
// **null — ноль**. Значит сервер статус отдаёт всегда, и пустота на экране —
// со стороны канона, то есть моя.
//
// Её же распределение по видам строк (это ДАННЫЕ, не догадка):
//   3919 «✅ DONE», 446 «📋 PLANNED», 273 «🚫 CANCELLED», 55 «🟡 PARTIAL»,
//   34 «🚀 READY FOR DEPLOY», 26 «⬜ TODO», 14 «🔄 IN PROGRESS»,
//   13 «🟣 BACKLOG», 8 «🔴 BLOCKED» — штатные;
//   нештатные: 7 «DONE» без значка, 1 «PARTIAL» без значка,
//   6 «✅ DONE — <хвост текста>».
//
// Проба проверяет канон ровно на них. Если какой-то штатный вид не узнаётся —
// это и есть источник «задач без статуса», и находка закрывается правкой
// канона, а не данных.
import { describe, expect, it } from 'vitest';
import { planStatusOf } from './taskStatus';

/** Штатные виды строк и то, чем они обязаны стать в канонической оси. */
const REAL: readonly [raw: string, expected: string][] = [
  ['✅ DONE', 'done'],
  ['📋 PLANNED', 'planned'],
  ['🚫 CANCELLED', 'cancelled'],
  ['🟡 PARTIAL', 'partial'],
  ['🚀 READY FOR DEPLOY', 'ready_for_deploy'],
  ['⬜ TODO', 'todo'],
  ['🔄 IN PROGRESS', 'active'],
  ['🟣 BACKLOG', 'backlog'],
  ['🔴 BLOCKED', 'blocked'],
];

describe('проба D-03: канон статусов против корпуса', () => {
  it('положительный контроль: канон вообще работает', () => {
    expect(planStatusOf('✅ DONE')).toBe('done');
  });

  it.each(REAL)('штатный вид «%s» узнаётся как «%s»', (raw, expected) => {
    expect(planStatusOf(raw)).toBe(expected);
  });

  it('ни один штатный вид не превращается в «неизвестно»', () => {
    const unknown = REAL.filter(([raw]) => planStatusOf(raw) === 'unknown').map(([raw]) => raw);
    expect(unknown, `канон не узнаёт штатные виды: ${unknown.join(' · ')}`).toEqual([]);
  });

  it('значок не обязателен: «DONE» без значка — тоже done (7 задач в корпусе)', () => {
    expect(planStatusOf('DONE')).toBe('done');
    expect(planStatusOf('PARTIAL')).toBe('partial');
  });

  it('хвост текста после статуса не ломает узнавание (6 задач в корпусе)', () => {
    // «✅ DONE — SPRINT_SHUTTLE_… архивирован»: статус тот же, хвост — пояснение.
    expect(planStatusOf('✅ DONE — SPRINT_SHUTTLE_X архивирован')).toBe('done');
  });

  it('пустая строка и null — «неизвестно», а не «активна»: это разные утверждения', () => {
    expect(planStatusOf(null)).toBe('unknown');
    expect(planStatusOf('')).toBe('unknown');
  });

  it('настоящая чужая строка — «неизвестно», и это честно', () => {
    expect(planStatusOf('🟢 ОТГРУЖЕНО')).toBe('unknown');
  });
});
