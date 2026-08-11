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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * AL-84/ADR-LORE-025-D17, поправка 2026-08-11 (решение владельца): единственный
 * практический путь заведения проекта был мёртв — ни один агентный профиль не
 * писал в семейство "project" (AgentScopeFilter.HUMAN_ONLY), а у человека нет ни
 * UI-кнопки, ни проверенной superadmin-учётки отдельно от обычного admin. Открыт
 * РОВНО agent-full — тест пинует и то, что открыт, и то, что человеческий порог
 * (именно superadmin, не admin) и остальные шесть агентных профилей не тронуты.
 */
class LoreResourceBaseProjectGuardTest {

    private static final LoreResourceBase RESOURCE = new LoreResourceBase() {};

    @Test
    void agentFullPassesWithoutSuperAdminRole() {
        RESOURCE.identity = fakeIdentity(Map.of("agent_scope", List.of("agent-full")));
        assertDoesNotThrow(() -> RESOURCE.requireSuperAdminOrAgentFull("admin"));
    }

    @Test
    void otherAgentProfileStillRejectedEvenWithSuperAdminRoleHeader() {
        // Заголовок роли не годится разделителем — узкие агентные профили тоже
        // ходят с ролью admin/superadmin. Гейт обязан смотреть на agent_scope,
        // не на X-Seer-Role, иначе исключение стало бы всеобщим.
        RESOURCE.identity = fakeIdentity(Map.of("agent_scope", List.of("agent-pm")));
        assertThrows(LoreExceptions.Forbidden.class,
            () -> RESOURCE.requireSuperAdminOrAgentFull("superadmin"));
    }

    @Test
    void humanStillNeedsSuperAdminNotPlainAdmin() {
        RESOURCE.identity = fakeIdentity(Map.of("seer_roles", List.of("admin")));
        assertThrows(LoreExceptions.Forbidden.class,
            () -> RESOURCE.requireSuperAdminOrAgentFull("admin"));
    }

    @Test
    void humanWithSuperAdminRolePasses() {
        RESOURCE.identity = fakeIdentity(Map.of("seer_roles", List.of("superadmin")));
        assertDoesNotThrow(() -> RESOURCE.requireSuperAdminOrAgentFull("superadmin"));
    }

    private static SecurityIdentity fakeIdentity(Map<String, Object> claims) {
        return new FakeIdentity(() -> new FakeJwt(claims));
    }

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
            throw new UnsupportedOperationException("не используется в этом тесте");
        }
        @Override public Set<Permission> getPermissions() { return Set.of(); }
    }

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
