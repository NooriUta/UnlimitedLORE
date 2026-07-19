# LORE auth — Keycloak `omilore` realm (A2)

**Перенесено в LORE (2026-07-14):** полное содержимое теперь живёт как runbook
`RUNBOOK-AUTH-OMILORE` — `:4400/lore?section=knowledge&passport=RUNBOOK-AUTH-OMILORE`
(или `query_slice({slice:"runbook_by_id", params:{id:"RUNBOOK-AUTH-OMILORE"}})` из MCP).
Этот файл больше не обновляется — правьте runbook в LORE, не этот .md.

Replaces the "trust the `X-Seer-Role` header" model with verified Keycloak JWTs.
**Off by default** — dev/local runs exactly as before until you switch it on.

## What ships in the repo (buildable now)

- `backend/build.gradle` — `quarkus-oidc`.
- `application.properties` — OIDC config, **`quarkus.oidc.enabled=${LORE_AUTH_ENABLED:false}`**.
- `SeerRoleFromTokenFilter` — when a valid token is present, overwrites `X-Seer-Role`
  from the token's realm roles (`super-admin`→`superadmin`, `admin`→`admin`, else
  `viewer`), so `requireAdmin` can no longer be spoofed by a plain header. Anonymous
  (OIDC off / no token) → header passes through unchanged.
- `backend/keycloak/omilore-realm.json` — importable realm: roles `admin`/`super-admin`/
  `viewer`, client `lore-app` (SPA, public + PKCE S256), client `lore-mcp` (confidential
  service-account). Realm roles land in the `seer_roles` claim (mirrors the platform
  `seer` realm mapper).
- **Frontend `lore-app`** (`src/auth/session.ts`, `AuthGate.tsx`, `AuthCallback.tsx`) — full
  Authorization Code + PKCE login via `oidc-client-ts`. Feature-flagged on
  `VITE_LORE_AUTH_ENABLED`: off (default/unset) → every write call still sends the same
  hardcoded `X-Seer-Role: admin` header as always, `AuthGate` renders children immediately,
  zero behavior change. On → `AuthGate` redirects to Keycloak when there's no session,
  `/auth/callback` exchanges the code, and `authHeaders()` (imported by every `src/api/*`
  write call) switches to `Authorization: Bearer <token>` instead of the role header. A
  small logout badge appears in `AppShell`'s header, but only once the flag is on.
- **MCP server** (`mcp-server/src/backend.ts`) — `client_credentials` token fetch against
  the `lore-mcp` service account, cached until near expiry. Feature-gated on
  `LORE_OIDC_ISSUER` + `LORE_MCP_CLIENT_ID` + `LORE_MCP_CLIENT_SECRET` all being set:
  unset (default) → `lorePost`/`loreUpload` keep sending `X-Seer-Role` from
  `LORE_SEER_ROLE` exactly as before. Set → they send a Bearer token instead.

## Enabling auth (staging/prod)

1. **Import the realm** into the shared KC — since the ci-server move that is
   `https://odal.seidrstudio.pro/kc` (the `http://localhost:18180/kc` in earlier revisions of
   this file was the laptop stand and no longer resolves anywhere useful):
   `kcadm.sh create realms -f backend/keycloak/omilore-realm.json` (or the admin UI →
   Add realm → import). Then: rotate the `lore-mcp` secret, assign the `admin` realm
   role to the `lore-mcp` service-account user, and create your admin user(s).
2. **Backend:** set `LORE_AUTH_ENABLED=true` and `LORE_OIDC_ISSUER=http://<kc>/kc/realms/omilore`
   (from inside the lore-backend container, `<kc>` must be reachable — add the KC host to
   `extra_hosts` / use the compose network alias). Rebuild the image.
3. **Frontend:** set `VITE_LORE_AUTH_ENABLED=true`, `VITE_OIDC_ISSUER` (same issuer URL,
   reachable from the browser — likely a different host/port than the backend's internal
   one), `VITE_OIDC_CLIENT_ID=lore-app` (default). Rebuild.
4. **MCP:** set `LORE_OIDC_ISSUER`, **`LORE_MCP_CLIENT_ID=lore-mcp-full`**, `LORE_MCP_CLIENT_SECRET`
   (the service-account secret of that client).

   ⚠️ **Use the per-profile client, NOT the generic `lore-mcp`.** Both exist in the realm, and
   the difference is invisible until it matters:

   | client | protocol mappers | client role |
   |---|---|---|
   | `lore-mcp` | `lore-realm-role-mapper` only | — |
   | `lore-mcp-full` | `agent_scope` + `seer_roles` | `agent-full` |

   With the generic client the token arrives **without the `agent_scope` claim**, so
   `AgentScopeFilter` (AL-17) treats the caller as "not an agent" and lets everything through.
   Authorization would look enabled while its main consumer bypasses it entirely — no errors,
   no denials, no protection. Verified against the live realm 2026-07-19.

   `agent-full` is near-admin by design; that is fine. The point is that the claim is
   **present**, so the filter passes the caller by right rather than by absence of a marker —
   and the profile can be narrowed later. With `lore-mcp` there would be nothing to narrow.

   The other seven clients (`lore-mcp-developer`, `-tester`, `-pm`, `-architect`, `-analyst`,
   `-marketer`, `-product-analyst`) carry the same mappers with their own scope: an agent run
   under one of them gets that profile's real restrictions rather than a declaration.

   Ordering does not matter: since `mcp-server/src/backend.ts` sends **both** the Bearer token
   and `X-Seer-Role`, configuring MCP before the flip is safe (the Bearer is ignored while auth
   is off) and flipping auth afterwards does not interrupt it.
5. **Verify:** a request without a bearer token → 401; a token carrying realm role
   `admin`/`super-admin` → writes succeed; forging `X-Seer-Role: admin` without a token →
   still 401/anonymous (the filter no longer honours the raw header once a token is required).
   In the browser: no session → redirected to Keycloak login; after login, writes work and
   the header shows a logout badge.

   ⚠️ **Open the stand over https — `https://lore.odal.seidrstudio.pro`, not `http://<ip>:4400`.**
   The browser exposes `window.crypto.subtle` only in a *secure context* (https, or `localhost`
   as the sole exception). `oidc-client-ts` needs it for PKCE, so over plain http on a LAN
   address the call throws, `AuthGate` never gets a session, and **the page just goes blank —
   no redirect to Keycloak, no error explaining why.** The symptom points at Keycloak; the
   cause is the address bar.

   This worked on the laptop stand purely because it was served as `http://localhost:4400`.
   The move to ci-server changed the address and silently took the crypto with it.

   Port `4400` over http stays up and reading works there as before — only login cannot.

All three flags (backend/frontend/MCP) must flip together — flipping only one leaves that
side either broken (frontend/MCP sending a token nothing checks) or unprotected (backend
enforcing auth while a client still only sends the old header).
