// SPRINT_UXR_S3_V2_INFRA/S3-18 — боевой менеджер: Authorization Code + PKCE S256
// у клиента lore-app, state входа — в переданном хранилище под префиксом lore.v2.*.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOidcManager } from './oidc';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const ISSUER = 'https://kc.example/kc/realms/omilore';

afterEach(() => { vi.unstubAllGlobals(); });

describe('S3-18 · createOidcManager', () => {
  it('запрос входа: code + PKCE S256, client lore-app, свой redirect_uri; state — в хранилище lore.v2.oidc.*', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const store = new MemStorage();
    const mgr = createOidcManager({
      issuer: ISSUER, clientId: 'lore-app', redirectUri: 'https://new.lore.example/',
      postLogoutRedirectUri: 'https://new.lore.example/', store, prefix: 'lore.v2.oidc.',
    });
    // Навигацию в node не сделать — берём тот же запрос, который строит signinRedirect.
    const client = (mgr as unknown as { _client: { createSigninRequest(a: object): Promise<{ url: string }> } })._client;
    const req = await client.createSigninRequest({ request_type: 'si:r', url_state: undefined, state: '/?sec=adr' });
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('client_id')).toBe('lore-app');
    expect(url.searchParams.get('redirect_uri')).toBe('https://new.lore.example/');
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)!);
    expect(keys.length).toBe(1);
    expect(keys[0].startsWith('lore.v2.oidc.')).toBe(true);
    expect(JSON.parse(store.getItem(keys[0])!).code_verifier).toBeTruthy();
  });
});
