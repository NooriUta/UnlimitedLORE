package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.security.credential.Credential;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.Permission;
import java.security.Principal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S0_SAFETY/S0-04 — контрактный тест ЭНДПОИНТА подписи встройки Völva
 * ({@code GET /lore/embed/volva/{chart}}, SPRINT_VIZ_EMBED/VE-2).
 *
 * <p>Зачем отдельно от {@link VolvaEmbedSignerTest}: тот проверяет чистые функции
 * подписи, а контракт держит ресурс — откуда берутся проекты (под ПОЛЬЗОВАТЕЛЯ,
 * по {@code sub} токена), кто получает отказ (служебный клиент, чужой проект),
 * какие поля и коды уходят наружу. Правки сервера в редизайне UXR не должны
 * менять ни одно из этого молча.
 *
 * <p>Снимок формы: ответ — ровно {@code chart, project, locked, url, expires_at}
 * в этом порядке; {@code project} — ВСЕГДА массив (как и запертый
 * {@code params.project} в JWT: Völva фильтрует {@code project IN ({{project}})}).
 *
 * <p>Без CDI и без БД: ресурс собирается руками, проекты пользователя и ключ
 * подставляются заглушками — тест гоняется в любом CI без Docker.
 */
class VolvaEmbedEndpointContractTest {

    static final String SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    static final String SITE = "https://volva.example/";
    static final String CHARTS = "sprints_timeline:44, sprints_dashboard:dashboard:4:unlocked";
    static final ObjectMapper JSON = new ObjectMapper();

    /** Снимок формы успешного ответа — порядок ключей тоже контракт. */
    static final List<String> SHAPE = List.of("chart", "project", "locked", "url", "expires_at");

    // ── сборка ресурса ───────────────────────────────────────────────────────

    /** Кого спросили о проектах — доказательство «под пользователя». */
    static final class RbacStub extends ProjectRbacService {
        final Map<String, Set<String>> bySub;
        final List<String> askedSubs = new ArrayList<>();
        RbacStub(Map<String, Set<String>> bySub) { this.bySub = bySub; }
        @Override public Set<String> allowedProjectsForUser(String kcSub) {
            askedSubs.add(kcSub);
            return bySub.getOrDefault(kcSub, Set.of());
        }
    }

    static final class SecretStub extends SecretProvider {
        final String value;
        SecretStub(String value) { this.value = value; }
        @Override public Optional<String> get(String key) {
            return AidaLoreResource.VOLVA_EMBED_SECRET_KEY.equals(key) ? Optional.ofNullable(value) : Optional.empty();
        }
    }

    static AidaLoreResource resource(Map<String, Object> claims, RbacStub rbac, String secret) {
        AidaLoreResource r = new AidaLoreResource();
        r.enabled = true;
        r.secrets = new SecretStub(secret);
        r.volvaSiteUrl = Optional.of(SITE);
        r.volvaCharts = Optional.of(CHARTS);
        r.volvaTtlSeconds = 600;
        r.readAllClients = "lore-reader-minilore";
        r.projectRbac = rbac;
        r.identity = claims == null ? null : new FakeIdentity(new FakeJwt(claims));
        return r;
    }

    static AidaLoreResource user(String sub, RbacStub rbac) {
        return resource(Map.of("sub", sub), rbac, SECRET);
    }

    static JsonNode body(Response resp) {
        return JSON.valueToTree(resp.getEntity());
    }

    static JsonNode jwtPayload(String url) throws Exception {
        String jwt = url.substring(url.lastIndexOf('/') + 1);
        String[] p = jwt.split("\\.");
        assertEquals(3, p.length, "JWT из трёх частей");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String sig = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(mac.doFinal((p[0] + "." + p[1]).getBytes(StandardCharsets.UTF_8)));
        assertEquals(sig, p[2], "подпись HS256 ключом из хранилища секретов");
        return JSON.readTree(Base64.getUrlDecoder().decode(p[1]));
    }

    static List<String> keys(JsonNode n) {
        List<String> out = new ArrayList<>();
        n.fieldNames().forEachRemaining(out::add);
        return out;
    }

    // ── успешная подпись: поля, массив, срок ─────────────────────────────────

    @Test
    void userGetsSignedLinkWithExactShapeAndProjectAsArray() throws Exception {
        RbacStub rbac = new RbacStub(Map.of("kc-user-1", Set.of("NooriUta/volva")));
        long before = Instant.now().getEpochSecond();
        Response resp = user("kc-user-1", rbac).volvaEmbed("sprints_timeline", "NooriUta/volva", "viewer");

        assertEquals(200, resp.getStatus());
        assertEquals("no-store", resp.getHeaderString("Cache-Control"), "адрес с JWT не кэшируется");
        JsonNode b = body(resp);
        assertEquals(SHAPE, keys(b), "снимок формы ответа");
        assertEquals("sprints_timeline", b.get("chart").asText());
        assertTrue(b.get("locked").asBoolean());
        assertTrue(b.get("project").isArray(), "project в ответе — всегда массив: " + b.get("project"));
        assertEquals(List.of("NooriUta/volva"), JSON.convertValue(b.get("project"), List.class));
        assertTrue(b.get("url").asText().startsWith("https://volva.example/embed/question/"), b.get("url").asText());

        JsonNode p = jwtPayload(b.get("url").asText());
        assertEquals(List.of("resource", "params", "exp"), keys(p), "снимок формы payload");
        assertEquals(44, p.get("resource").get("question").asInt());
        assertTrue(p.get("params").get("project").isArray(), "запертый project в JWT — всегда массив");
        assertEquals(List.of("NooriUta/volva"), JSON.convertValue(p.get("params").get("project"), List.class));
        long exp = p.get("exp").asLong();
        assertTrue(exp >= before + 600 && exp <= Instant.now().getEpochSecond() + 600, "срок — ttl-seconds");
        assertEquals(Instant.ofEpochSecond(exp).toString(), b.get("expires_at").asText(), "expires_at = exp из JWT");

        assertEquals(List.of("kc-user-1"), rbac.askedSubs, "проекты взяты у ПОЛЬЗОВАТЕЛЯ по sub токена");
    }

    @Test
    void multiSelectIsLockedAsNormalisedListInBothResponseAndJwt() throws Exception {
        RbacStub rbac = new RbacStub(Map.of("u", Set.of("NooriUta/volva", "NooriUta/UnlimitedLORE")));
        Response resp = user("u", rbac).volvaEmbed("sprints_timeline",
            " NooriUta/volva, NooriUta/UnlimitedLORE,NooriUta/volva ", "viewer");
        assertEquals(200, resp.getStatus());
        List<String> want = List.of("NooriUta/volva", "NooriUta/UnlimitedLORE");
        assertEquals(want, JSON.convertValue(body(resp).get("project"), List.class),
            "ответ называет ровно то, что заперто в подписи, а не эхо сырого запроса");
        assertEquals(want, JSON.convertValue(jwtPayload(body(resp).get("url").asText()).get("params").get("project"), List.class));
    }

    @Test
    void unlockedDashboardForFullScopeHasEmptyArrayAndNoParams() throws Exception {
        // admin видит все проекты и так — незапертый дашборд ему можно.
        Response resp = resource(null, new RbacStub(Map.of()), SECRET).volvaEmbed("sprints_dashboard", null, "admin");
        assertEquals(200, resp.getStatus());
        JsonNode b = body(resp);
        assertEquals(SHAPE, keys(b));
        assertFalse(b.get("locked").asBoolean());
        assertTrue(b.get("project").isArray() && b.get("project").isEmpty(),
            "у незапертого project — пустой массив, не null и не строка: " + b.get("project"));
        assertTrue(b.get("url").asText().startsWith("https://volva.example/embed/dashboard/"));
        JsonNode p = jwtPayload(b.get("url").asText());
        assertEquals(4, p.get("resource").get("dashboard").asInt());
        assertTrue(p.get("params").isObject() && p.get("params").isEmpty(), "у незапертого params пусты");
    }

    // ── отказы: коды и тела ──────────────────────────────────────────────────

    static void assertRefused(Response resp, int status, String code) {
        assertEquals(status, resp.getStatus(), String.valueOf(resp.getEntity()));
        assertEquals("no-store", resp.getHeaderString("Cache-Control"));
        JsonNode b = body(resp);
        assertEquals(List.of("error", "detail"), keys(b), "форма ошибки");
        assertEquals(code, b.get("error").asText());
        assertFalse(b.toString().contains("/embed/"), "в отказе нет адреса встройки");
    }

    @Test
    void foreignProjectIsRefusedForUser() {
        RbacStub rbac = new RbacStub(Map.of("u", Set.of("NooriUta/volva")));
        assertRefused(user("u", rbac).volvaEmbed("sprints_timeline", "NooriUta/AIDA", "viewer"), 403, "FORBIDDEN_PROJECT");
        assertRefused(user("u", rbac).volvaEmbed("sprints_timeline", "NooriUta/volva,NooriUta/AIDA", "viewer"),
            403, "FORBIDDEN_PROJECT");
    }

    @Test
    void userWithoutAnyProjectIsRefused() {
        assertRefused(user("nobody", new RbacStub(Map.of())).volvaEmbed("sprints_timeline", "NooriUta/volva", "viewer"),
            403, "FORBIDDEN_PROJECT");
    }

    @Test
    void headerRoleAdminDoesNotUnlockForTokenUser() {
        // Роль из заголовка admin у человека — обход скоупа (как у слайсов); но
        // служебный клиент с тем же заголовком — отказ (следующий тест).
        RbacStub rbac = new RbacStub(Map.of());
        Response resp = user("u", rbac).volvaEmbed("sprints_timeline", "NooriUta/AIDA", "admin");
        assertEquals(200, resp.getStatus(), "admin-человек видит все проекты — подпись выдаётся");
        assertTrue(rbac.askedSubs.isEmpty());
    }

    @Test
    void serviceClientIsRefusedEvenIfItReadsTheWholeCorpus() {
        for (String client : List.of("lore-reader-minilore", "lore-agent-pm")) {
            Response resp = resource(Map.of("client_id", client, "sub", "svc"), new RbacStub(Map.of()), SECRET)
                .volvaEmbed("sprints_timeline", "NooriUta/volva", "admin");
            assertRefused(resp, 403, "AGENT_REFUSED");
        }
    }

    @Test
    void unlockedDashboardIsRefusedToProjectScopedUser() {
        RbacStub rbac = new RbacStub(Map.of("u", Set.of("NooriUta/volva")));
        assertRefused(user("u", rbac).volvaEmbed("sprints_dashboard", null, "viewer"), 403, "UNLOCKED_NEEDS_FULL_SCOPE");
    }

    @Test
    void badInputAndMissingConfigHaveStableCodes() {
        RbacStub rbac = new RbacStub(Map.of("u", Set.of("NooriUta/volva")));
        assertRefused(user("u", rbac).volvaEmbed("rm -rf", "NooriUta/volva", "viewer"), 404, "UNKNOWN_CHART");
        assertRefused(user("u", rbac).volvaEmbed("sprints_timeline", null, "viewer"), 400, "PROJECT_REQUIRED");
        assertRefused(user("u", rbac).volvaEmbed("sprints_timeline", "x' OR '1'='1", "viewer"), 400, "PROJECT_REQUIRED");
        assertRefused(resource(Map.of("sub", "u"), rbac, null).volvaEmbed("sprints_timeline", "NooriUta/volva", "viewer"),
            503, "NOT_CONFIGURED");
    }

    // ── заглушки токена ──────────────────────────────────────────────────────

    static final class FakeIdentity implements SecurityIdentity {
        private final Principal principal;
        FakeIdentity(Principal principal) { this.principal = principal; }
        @Override public Principal getPrincipal() { return principal; }
        @Override public boolean isAnonymous() { return false; }
        @Override public Set<String> getRoles() { return Set.of(); }
        @Override public boolean hasRole(String role) { return false; }
        @Override public <T extends Credential> T getCredential(Class<T> credentialType) { return null; }
        @Override public Set<Credential> getCredentials() { return Set.of(); }
        @Override public <T> T getAttribute(String name) { return null; }
        @Override public Map<String, Object> getAttributes() { return Map.of(); }
        @Override public io.smallrye.mutiny.Uni<Boolean> checkPermission(Permission permission) {
            throw new UnsupportedOperationException();
        }
        @Override public Set<Permission> getPermissions() { return Set.of(); }
    }

    static final class FakeJwt implements Principal, JsonWebToken {
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
