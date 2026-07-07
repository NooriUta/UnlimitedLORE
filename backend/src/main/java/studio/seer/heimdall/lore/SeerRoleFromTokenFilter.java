package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * A2 — bridges Keycloak (omilore realm) auth to the existing role gate. When OIDC
 * is enabled, it derives the internal {@code X-Seer-Role} header from the VERIFIED
 * token's realm roles, overwriting whatever the client sent — so requireAdmin
 * (which reads X-Seer-Role) can no longer be spoofed with a plain header.
 *
 * When OIDC is disabled (dev/local, quarkus.oidc.enabled=false) the request is
 * anonymous and the incoming header is left untouched — today's behaviour, so
 * nothing about local dev changes until auth is switched on.
 *
 * When OIDC IS enabled, an anonymous request (no bearer token) must NOT get the
 * same free pass: Quarkus treats a missing token as an anonymous identity too, so
 * "OIDC on, no token" and "OIDC off" both hit isAnonymous()==true above. Without
 * the oidcEnabled check below, an unauthenticated caller could send a plain
 * `X-Seer-Role: admin` header once OIDC is switched on in staging/prod and reach
 * requireAdmin() — the exact spoof this filter exists to close (flagged by Devin
 * review on PR #79, SEC-0001).
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 100)
public class SeerRoleFromTokenFilter implements ContainerRequestFilter {

    @Inject
    SecurityIdentity identity;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (identity == null || identity.isAnonymous()) {
            if (oidcEnabled) {
                // OIDC is on but this request carried no verified token — an
                // anonymous caller gets no role, full stop. Never trust a raw
                // client header once verified auth is the source of truth.
                ctx.getHeaders().remove("X-Seer-Role");
            }
            return; // OIDC off (dev/local): leave X-Seer-Role as received, today's behaviour
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
