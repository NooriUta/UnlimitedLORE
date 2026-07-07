# LORE auth — Keycloak `omilore` realm (A2)

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

## Enabling auth (staging/prod)

1. **Import the realm** into the shared KC (`aida-root-keycloak-1`, `http://localhost:18180/kc`):
   `kcadm.sh create realms -f backend/keycloak/omilore-realm.json` (or the admin UI →
   Add realm → import). Then: rotate the `lore-mcp` secret, assign the `admin` realm
   role to the `lore-mcp` service-account user, and create your admin user(s).
2. **Backend:** set `LORE_AUTH_ENABLED=true` and `LORE_OIDC_ISSUER=http://<kc>/kc/realms/omilore`
   (from inside the lore-backend container, `<kc>` must be reachable — add the KC host to
   `extra_hosts` / use the compose network alias). Rebuild the image.
3. **Verify:** a request without a bearer token → 401; a token carrying realm role
   `admin`/`super-admin` → writes succeed; forging `X-Seer-Role: admin` without a token →
   still 401/anonymous (the filter no longer honours the raw header once a token is required).

## Remaining runtime work (only needed when auth is on)

- **Frontend `lore-app`:** implement the OIDC Authorization Code + PKCE login (redirect to
  KC, store the token, send `Authorization: Bearer …`). Today the SPA sends `X-Seer-Role`
  directly — that stops working once auth is enforced.
- **MCP server:** fetch a token via `client_credentials` from the `lore-mcp` client
  (`LORE_MCP_CLIENT_ID`/`LORE_MCP_CLIENT_SECRET`) and send `Bearer` instead of the default
  `LORE_SEER_ROLE=admin` header (`mcp-server/src/backend.ts`).

Both are gated on the realm being live, so they're deliberately left as follow-ups.
