package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import studio.seer.heimdall.bench.MartClient;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Shared infrastructure for the LORE REST resources (B2 God-class split). Holds
 * the ArcadeDB clients, config, the JSON error contract, and the small helpers
 * every domain resource needs. Concrete resources extend this so a per-domain
 * class (AidaLoreResource, LoreBragiResource, …) inherits them without changing
 * a single call site. All members are package-private — every LORE resource
 * lives in this package.
 */
public abstract class LoreResourceBase {

    // task_uid carries a '/' (e.g. SPRINT_X/SH-1); all values are bound as SQL params, never concatenated.
    static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_./\\-]{1,100}");

    /** JSON error body returned by every LORE endpoint (and LoreExceptionMapper). */
    public record LoreError(String error, String detail) {}

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String password;

    @Inject
    @RestClient
    MartClient client;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    // Throws LoreExceptions.Forbidden (→ 403 JSON via LoreExceptionMapper) when the
    // caller is not admin/superadmin. Call as a guard: `requireAdmin(role);`.
    void requireAdmin(String role) {
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            throw new LoreExceptions.Forbidden("admin role required");
        }
    }

    Response badParams(String msg) {
        return noStore(Response.status(Response.Status.BAD_REQUEST)
            .entity(new LoreError("BAD_PARAMS", msg)));
    }

    Response disabled() {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("LORE_DISABLED",
                "lore.enabled=false (lore is dev-only)")));
    }

    String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    /** Param map that tolerates null values (Map.of forbids them) — used for nullable note_md. */
    static Map<String, Object> mapOfNullable(Object... kv) {
        Map<String, Object> m = new java.util.HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    /**
     * The HAS_STATE edge that links an entity vertex to its (new or initial) SCD2
     * history row. Byte-for-byte identical across every LORE type — only the
     * vertex/hist class and key field change (B1). Same SQL, same :id/:nsid params.
     */
    static LoreCommandClient.LoreCommand linkStateCmd(
            String vertexType, String histType, String keyField, String id, String nsid) {
        return new LoreCommandClient.LoreCommand("sql",
            "CREATE EDGE HAS_STATE FROM (SELECT FROM " + vertexType + " WHERE " + keyField + " = :id) " +
            "TO (SELECT FROM " + histType + " WHERE state_uid = :nsid)",
            Map.of("id", id, "nsid", nsid));
    }

    static Response noStore(Response.ResponseBuilder builder) {
        return builder.type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").build();
    }

    static String str(Object o) {
        return o == null ? "" : o.toString().trim();
    }
}
