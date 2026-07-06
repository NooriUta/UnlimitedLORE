package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;

/**
 * A2 — bridges Keycloak (omilore realm) auth to the existing role gate. When OIDC
 * is enabled, it derives the internal {@code X-Seer-Role} header from the VERIFIED
 * token's realm roles, overwriting whatever the client sent — so requireAdmin
 * (which reads X-Seer-Role) can no longer be spoofed with a plain header.
 *
 * When OIDC is disabled (dev/local, quarkus.oidc.enabled=false) the request is
 * anonymous and the incoming header is left untouched — today's behaviour, so
 * nothing about local dev changes until auth is switched on.
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 100)
public class SeerRoleFromTokenFilter implements ContainerRequestFilter {

    @Inject
    SecurityIdentity identity;

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (identity == null || identity.isAnonymous()) {
            return; // OIDC off, or no bearer token — leave X-Seer-Role as received
        }
        final String role;
        if (identity.hasRole("super-admin")) {
            role = "superadmin";
        } else if (identity.hasRole("admin")) {
            role = "admin";
        } else {
            role = "viewer";
        }
        ctx.getHeaders().putSingle("X-Seer-Role", role);
    }
}
