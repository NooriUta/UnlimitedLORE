// AP-02: роли из access-токена для отчёта RBAC — только роли и группы, без самого токена и прочих
// полей (sub, email). Подпись не проверяется: это разбор «что выдал Keycloak», а не доверие токену.

export interface RoleClaims { seer_roles: string[]; realm_roles: string[]; groups: string[] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function payloadOf(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? decodeURIComponent(Array.from(atob(b64), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))
      : Buffer.from(b64, 'base64').toString('utf8');
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function roleClaimsOf(token: string | null | undefined): RoleClaims | null {
  if (!token) return null;
  const p = payloadOf(token);
  if (!p) return null;
  const realm = p.realm_access && typeof p.realm_access === 'object' ? (p.realm_access as { roles?: unknown }).roles : undefined;
  return { seer_roles: strings(p.seer_roles), realm_roles: strings(realm), groups: strings(p.groups) };
}
