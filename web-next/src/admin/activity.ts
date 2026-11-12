// Окно активности машины и harness (SPRINT_UXR_S7B_ADMIN/S7B-ACT-1).
//
// Слово владелицы 11.11: «по DSH предлагаю в админку на машину и harness выставить настройки
// (считать активной в течении — от часа после последнего вызова до суток)».
//
// Сервер хранит окно на акторе-машине (client_id minilore-link-*): activity_window_h — окно
// машины, activity_window_harness — окна по harness. Правило выбора — то же, что
// MachineActivity.effective на сервере: harness → машина → общий дефолт. Отдельный модуль —
// его читают и «Доступ к машинам» (machines.ts), и «Агенты» (agents.ts), а те друг друга.

/** Учётка машины miniLORE — тот же префикс, что MachineAccess.PREFIX на сервере. */
export const MACHINE_CLIENT_PREFIX = 'minilore-link-';

export interface MachineActivity { windowH: number | null; harness: Record<string, number> }

/** Запасной дефолт — тот же, что MachineActivity.DEFAULT_H на сервере; сервер называет свой полем. */
export const ACTIVITY_DEFAULT_H = 1;
/** Выбор в форме — список владелицы «1ч/3ч/6ч/12ч/24ч». */
export const ACTIVITY_CHOICES = [1, 3, 6, 12, 24] as const;

/** Часы окна 1..24 или null (не число, вне диапазона). */
export const hoursOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 24 ? v : null);

export function parseActivity(windowH: unknown, harness: unknown): MachineActivity {
  const h: Record<string, number> = {};
  if (harness && typeof harness === 'object' && !Array.isArray(harness)) {
    for (const [k, v] of Object.entries(harness as Record<string, unknown>)) {
      const n = hoursOf(v);
      if (n !== null) h[k] = n;
    }
  }
  return { windowH: hoursOf(windowH), harness: h };
}

/** Окно для harness на машине: harness → машина → общий дефолт (MachineActivity.effective). */
export function activityWindowH(a: MachineActivity, harness: string | null, defaultH: number = ACTIVITY_DEFAULT_H): { hours: number; basis: 'harness' | 'machine' | 'default' } {
  if (harness !== null && a.harness[harness] !== undefined) return { hours: a.harness[harness], basis: 'harness' };
  if (a.windowH !== null) return { hours: a.windowH, basis: 'machine' };
  return { hours: defaultH, basis: 'default' };
}
