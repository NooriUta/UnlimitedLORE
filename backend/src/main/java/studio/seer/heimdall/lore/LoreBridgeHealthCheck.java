package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;

/**
 * MIG-33 items 2/3: surfaces the KC-bridge's live configured-state at
 * {@code /q/health/ready} — unauthenticated ({@link SeerRoleFromTokenFilter}
 * exempts {@code /q/health/*}), so the SAME {@code kc_configured} field is
 * readable regardless of auth mode. Before this, CD's "Verify KC bridge
 * actually got its secret" step only checked {@code kc_configured} in the
 * auth-OFF branch (via {@code /lore/kc/auth-preflight}, itself auth-gated
 * once OIDC is on) — the auth-ON branch checked only that a 401/403 was
 * returned, never whether the bridge itself was alive. A dead bridge behind
 * a correctly-enforcing auth layer passed CD green either way.
 *
 * <p>DOWN only when the bridge is actually MANDATORY — auth on AND
 * {@code lore.auth.require-admin} true, the exact condition
 * {@link LoreAuthStartupGuard} uses to decide whether a dead bridge is fatal
 * at boot. When auth is off the bridge stays a pluggable, optional
 * dependency (ADR-LORE-025 D11/D14) — its absence must not flip overall
 * readiness, only be visible in the check's own data for CD to read.
 */
@Readiness
@ApplicationScoped
public class LoreBridgeHealthCheck implements HealthCheck {

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @ConfigProperty(name = "lore.auth.require-admin", defaultValue = "true")
    boolean requireAdmin;

    @Inject
    KcBridge kc;

    @Override
    public HealthCheckResponse call() {
        boolean configured = kc.configured();
        boolean mandatory = oidcEnabled && requireAdmin;
        return HealthCheckResponse.named("lore-kc-bridge")
            .status(!mandatory || configured)
            .withData("kc_configured", configured)
            .withData("mandatory", mandatory)
            .build();
    }
}
