import { describe, expect, it } from 'vitest';
import { roleFromClaims, getRole, AUTH_ENABLED } from './session';

// ADR-LORE-025 D8: the claim→role mapping that gates ⚙ Admin LORE.

describe('roleFromClaims', () => {
  it('super-admin wins over everything', () => {
    expect(roleFromClaims(['super-admin'])).toBe('superadmin');
    expect(roleFromClaims(['admin', 'super-admin'])).toBe('superadmin');
  });

  it('admin maps to admin', () => {
    expect(roleFromClaims(['admin'])).toBe('admin');
    expect(roleFromClaims(['whatever', 'admin'])).toBe('admin');
  });

  it('empty or unknown roles fall to viewer (least privilege)', () => {
    expect(roleFromClaims([])).toBe('viewer');
    expect(roleFromClaims(['user', 'offline_access'])).toBe('viewer');
  });
});

describe('getRole with auth off (dev)', () => {
  it('auth flag is off in the test build and the role comes from config (default admin)', () => {
    // VITE_LORE_AUTH_ENABLED unset in tests → dev fallback path.
    expect(AUTH_ENABLED).toBe(false);
    expect(getRole()).toBe('admin');
  });
});
