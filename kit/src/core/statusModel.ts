// Модель смены статуса (SPRINT_UXR_S10_SEIDR_KIT/K-05) — чистые функции над
// KitConfig['statuses'] без React: какие переходы допустимы, какая у пункта
// клавиша (1…9 или свой hotkey), каким токеном красить, может ли роль менять.
import type { KitConfig } from './contract';

export type KitStatuses = KitConfig['statuses'];
export type KitStatusItem = KitStatuses['items'][number];

export interface StatusTarget {
  item: KitStatusItem;
  /** Клавиша выбора: свой hotkey статуса, иначе номер 1…9; '' — без клавиши. */
  key: string;
}

export function findStatus(statuses: KitStatuses, code: string): KitStatusItem | undefined {
  return statuses.items.find((s) => s.code === code);
}

/**
 * Куда можно перейти из `from`. allow текущего статуса ограничивает цели
 * (пустой allow = переходов нет); без allow — все, кроме текущего. Статус вне
 * конфига (сбой данных) — предлагаются все: иначе из сбоя не выбраться.
 * Номера 1…9 — по позиции в списке целей; свой hotkey статуса важнее номера.
 */
export function statusTargets(statuses: KitStatuses, from: string): StatusTarget[] {
  const cur = findStatus(statuses, from);
  const allow = cur?.allow;
  const items = statuses.items.filter((s) => s.code !== from && (!allow || allow.includes(s.code)));
  return items.map((item, i) => ({ item, key: item.hotkey ?? (i < 9 ? String(i + 1) : '') }));
}

/** Цвет статуса — только токен: «--x», «x», «var(--x)» → var(--x); пусто — --t3. */
export function statusColor(color: string | undefined): string {
  const c = (color ?? '').trim();
  if (!c) return 'var(--t3)';
  if (c.startsWith('var(')) return c;
  if (c.startsWith('--')) return `var(${c})`;
  if (/^[a-z][\w-]*$/i.test(c)) return `var(--${c})`;
  return c;
}

/** Может ли роль менять статус: без ролей в конфиге — да; неизвестная роль — нет. */
export function canChangeStatus(config: KitConfig, role?: string): boolean {
  if (!config.roles) return true;
  if (!role) return true;
  return config.roles[role]?.canStatus ?? false;
}
