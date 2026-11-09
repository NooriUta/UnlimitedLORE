// Проба: откуда «56 задач без статусов» (аудит 09.11, D-03)
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG.
//
// Два кандидата уже отброшены ЗАМЕРОМ, а не рассуждением:
//   1. **Сервер.** Серверная сессия прогнала весь корпус: из 4802 задач статус
//      null у НУЛЯ. Срез статус отдаёт всегда.
//   2. **Канон списка.** `planStatusOf` узнаёт все девять реальных видов строк
//      и даже грязные («DONE» без значка, «✅ DONE — хвост») —
//      `sprints/planStatusCanon.probe.test.ts`, 15 проверок зелёные.
//
// Остаётся третий: **в приложении ДВА словаря статусов, и они не совпадают.**
// Таблица задач переводит строку своим `taskStatusCode` (11 кодов), а словарь
// конфига, по которому kit рисует чип, живёт на оси из шести значений
// (D-2026-UXR-STATUS-AXIS). Код, которого нет в конфиге, рисовать нечем.
//
// Эта проба показывает расхождение числами. Она НЕ требует стенда и не зависит
// от скриншота аудита.
import { describe, expect, it } from 'vitest';
import { TASK_STATUS_CODES, taskStatusCode } from './taskRecord';
import { planStatusOf } from '../sprints/taskStatus';
import { v2Config } from '../shell/v2Config';

/** Реальные виды строк корпуса (числа — замер серверной сессии 09.11). */
const CORPUS: readonly string[] = [
  '✅ DONE', '📋 PLANNED', '🚫 CANCELLED', '🟡 PARTIAL', '🚀 READY FOR DEPLOY',
  '⬜ TODO', '🔄 IN PROGRESS', '🟣 BACKLOG', '🔴 BLOCKED',
];

const configCodes = () => new Set(v2Config('ru').statuses.items.map(i => i.code));

describe('проба D-03: два словаря статусов в одном приложении', () => {
  it('положительный контроль: оба словаря вообще отвечают', () => {
    expect(taskStatusCode('✅ DONE')).toBeTruthy();
    expect(planStatusOf('✅ DONE')).toBeTruthy();
  });

  it('одна и та же строка получает РАЗНЫЕ коды в списке и в таблице задач', () => {
    // Вот оно: «в работе» у списка active, у таблицы задач in_progress.
    expect(planStatusOf('🔄 IN PROGRESS')).toBe('active');
    expect(taskStatusCode('🔄 IN PROGRESS')).toBe('in_progress');
  });

  // СТОРОЖ, а не наблюдение: любой код, который может получиться из реальных
  // данных, обязан быть в словаре конфига. Нет записи — kit нечем рисовать чип,
  // и статус выглядит отсутствующим. Именно так и появились «задачи без
  // статусов» в аудите.
  it('коды таблицы задач все есть в словаре конфига', () => {
    const inConfig = configCodes();
    const orphans = CORPUS.map(raw => taskStatusCode(raw)).filter(code => !inConfig.has(code));
    expect([...new Set(orphans)], 'нечем рисовать чип для этих кодов').toEqual([]);
  });

  it('коды списка все есть в словаре конфига', () => {
    const inConfig = configCodes();
    const orphans = CORPUS.map(raw => planStatusOf(raw)).filter(code => !inConfig.has(code));
    expect([...new Set(orphans)], 'нечем рисовать чип для этих кодов').toEqual([]);
  });

  it('весь словарь таблицы задач покрыт конфигом — включая коды вне корпуса', () => {
    const inConfig = configCodes();
    const orphans = TASK_STATUS_CODES.filter(c => !inConfig.has(c));
    expect([...orphans], 'код есть в словаре таблицы, но не в конфиге').toEqual([]);
  });

  it('пустой статус два словаря понимают по-разному — это тоже расхождение', () => {
    // Таблица задач молча считает пустое «к работе», список — «неизвестно».
    // «Статус не ставили» и «статус неизвестен» — разные утверждения, и
    // первое ещё и выдумывает состояние.
    expect(taskStatusCode('')).toBe('todo');
    expect(planStatusOf('')).toBe('unknown');
  });
});
