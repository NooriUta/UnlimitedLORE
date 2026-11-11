// Цель палитры команд — мостик между экраном и шапкой
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14).
//
// Палитра kit умеет команды над записью или выделением (`target`), но живёт в
// шапке оболочки, а цель — открытая запись или выделение — в экране списка.
// Мостика не было, поэтому Ctrl+K не предлагал команд над целью никогда.
//
// Цель одна на окно: открыт один экран, у него одна открытая запись или одно
// выделение. Экран публикует, палитра читает; экран ушёл — цель снимается
// (иначе палитра действовала бы над записью, которой на экране уже нет).
import { useSyncExternalStore } from 'react';
import type { PaletteTarget } from '@seidr/kit';

let current: PaletteTarget | null = null;
const subs = new Set<() => void>();

export function setPaletteTarget(next: PaletteTarget | null): void {
  if (next === current) return;
  current = next;
  subs.forEach(cb => cb());
}

export function getPaletteTarget(): PaletteTarget | null {
  return current;
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

/** Текущая цель палитры; меняется вместе с экраном. */
export function usePaletteTarget(): PaletteTarget | null {
  return useSyncExternalStore(subscribe, getPaletteTarget, () => null);
}
