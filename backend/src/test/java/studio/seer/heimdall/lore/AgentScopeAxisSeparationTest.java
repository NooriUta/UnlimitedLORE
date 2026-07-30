package studio.seer.heimdall.lore;

import io.quarkus.security.credential.Credential;
import io.quarkus.security.identity.SecurityIdentity;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.junit.jupiter.api.Test;

import java.security.Permission;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * AL-47 пункт 1 (SPEC-RBAC-OMILORE-AGENTS §0): разделение осей — человеческий
 * токен не несёт agent_scope, агентный не несёт (проверяемого здесь) seer_roles
 * по этому же клейму. AgentScopeFilter.agentScopeOf читает РОВНО claim
 * "agent_scope" — тест пинует это на уровне кода, а не только обещанием в спеке:
 * если бы функция вместо этого читала любой другой клейм (например seer_roles,
 * которым несёт человеческий токен), человеческий вызов ошибочно получил бы
 * agent-скоуп и прошёл бы фильтр там, где не должен.
 */
class AgentScopeAxisSeparationTest {

    @Test
    void humanTokenWithoutAgentScopeClaimYieldsNullScope() {
        assertNull(AgentScopeFilter.agentScopeOf(identityWithClaim(Map.of("seer_roles", List.of("admin")))),
            "человеческий токен несёт seer_roles, а не agent_scope — скоуп обязан быть null");
    }

    @Test
    void agentTokenWithAgentScopeClaimYieldsUnprefixedScope() {
        assertEquals("full", AgentScopeFilter.agentScopeOf(identityWithClaim(Map.of("agent_scope", List.of("agent-full")))),
            "агентный токен несёт agent_scope — скоуп обязан извлечься и потерять префикс agent-");
    }

    @Test
    void identityWithoutJwtPrincipalYieldsNullScope() {
        // Не-JWT principal (например, dev-заглушка) — не роняет фильтр, просто
        // не даёт скоупа, как и человеческий токен без клейма.
        assertNull(AgentScopeFilter.agentScopeOf(new FakeIdentity(NonJwtPrincipal::new)));
    }

    private static SecurityIdentity identityWithClaim(Map<String, Object> claims) {
        return new FakeIdentity(() -> new FakeJwt(claims));
    }

    /** Principal-фабрика, чтобы один FakeIdentity обслуживал и JWT, и не-JWT случаи. */
    private interface PrincipalSupplier { Principal get(); }

    private static final class FakeIdentity implements SecurityIdentity {
        private final PrincipalSupplier principal;
        FakeIdentity(PrincipalSupplier principal) { this.principal = principal; }
        @Override public Principal getPrincipal() { return principal.get(); }
        @Override public boolean isAnonymous() { return false; }
        @Override public Set<String> getRoles() { return Set.of(); }
        @Override public boolean hasRole(String role) { return false; }
        @Override public <T extends Credential> T getCredential(Class<T> credentialType) { return null; }
        @Override public Set<Credential> getCredentials() { return Set.of(); }
        @Override public <T> T getAttribute(String name) { return null; }
        @Override public Map<String, Object> getAttributes() { return Map.of(); }
        @Override public io.smallrye.mutiny.Uni<Boolean> checkPermission(Permission permission) {
            throw new UnsupportedOperationException("не используется agentScopeOf");
        }
        @Override public Set<Permission> getPermissions() { return Set.of(); }
    }

    /** Не-JWT principal (dev-заглушка вроде QuarkusSecurityIdentity anonymous). */
    private static final class NonJwtPrincipal implements Principal {
        @Override public String getName() { return "not-a-jwt"; }
    }

    /** Principal + минимальный JsonWebToken — только getClaim, единственное, что читает agentScopeOf. */
    private static final class FakeJwt implements Principal, JsonWebToken {
        private final Map<String, Object> claims;
        FakeJwt(Map<String, Object> claims) { this.claims = claims; }
        @Override public String getName() { return "fake"; }
        @Override public Set<String> getClaimNames() { return claims.keySet(); }
        @Override public <T> T getClaim(String claimName) {
            @SuppressWarnings("unchecked")
            T v = (T) claims.get(claimName);
            return v;
        }
    }
}
