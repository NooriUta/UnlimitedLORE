import { useSyncExternalStore } from 'react';
import { getRole, isAdmin, subscribe, type SeerRole } from './session';

// ADR-LORE-025 D8: the ONLY way UI gates role-dependent sections (⚙ Admin
// LORE, write buttons). Re-renders on session changes (login/logout/renew).
export function useRole(): SeerRole {
  return useSyncExternalStore(subscribe, getRole, getRole);
}

export function useIsAdmin(): boolean {
  return useSyncExternalStore(subscribe, isAdmin, isAdmin);
}
