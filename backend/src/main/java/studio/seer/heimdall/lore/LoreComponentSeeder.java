package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * Seeds the 25 canonical LoreComponent entries into system_aida_lore.
 * Idempotent: upserts by component_id (UNIQUE index).
 * Runs after schema init (depends on LoreSchemaInitializer via @Startup ordering).
 */
@ApplicationScoped
@Startup
public class LoreComponentSeeder {

    private static final Logger LOG = Logger.getLogger(LoreComponentSeeder.class);

    record Component(String id, String fullName, String area, String parentId, String gameIcon) {}

    private static final List<Component> COMPONENTS = List.of(
        // ── Data ─────────────────────────────────────────────────────────
        new Component("YGG",      "Yggdrasil",           "data",          null,        "oak"),
        new Component("FRIGG",    "Frigg",               "data",          null,        "keyring"),
        // ── Engine ───────────────────────────────────────────────────────
        new Component("DALI",     "Dali",                "engine",        null,        "family-tree"),
        new Component("HND",      "Hound Parser",        "engine",        "DALI",      "wolf-head"),
        new Component("DEDUP",    "Dedup Engine",        "algorithm",     "HND",       null),
        new Component("TS",       "Type System",         "algorithm",     "HND",       null),
        new Component("OL",       "OpenLineage",         "engine",        "DALI",      "rune-stone"),
        new Component("ANVIL",    "Anvil",               "engine",        null,        "thor-hammer"),
        // ── AI ───────────────────────────────────────────────────────────
        new Component("MT",       "Mimir / AI Tools",    "ai",            null,        "open-book"),
        new Component("MIMIR",    "MIMIR Chat",          "ai",            "MT",        "open-book"),
        // ── API ──────────────────────────────────────────────────────────
        new Component("SHT",      "Shuttle GraphQL",     "api",           null,        "split-arrows"),
        new Component("CHUR",     "Chur",                "api",           null,        "stone-bridge"),
        // ── Frontend ─────────────────────────────────────────────────────
        new Component("VERDANDI", "Verdandi",            "frontend",      null,        "hourglass"),
        new Component("LOOM",     "Loom",                "frontend",      "VERDANDI",  "spider-web"),
        new Component("KNOT",     "Knot",                "frontend",      "LOOM",      "triquetra"),
        new Component("ANVIL_FE", "Anvil UI",            "frontend",      "VERDANDI",  "thor-hammer"),
        new Component("SKULD",    "Skuld",               "frontend",      "VERDANDI",  "crossed-axes"),
        new Component("URD",      "Urd",                 "frontend",      "VERDANDI",  "scroll-quill"),
        // ── Heimdall (Control Panel + Observability) ──────────────────────
        new Component("FE",       "Heimdall",            "frontend",      null,        "hunting-horn"),
        new Component("OBS",      "Observability",       "observability", "FE",        "radar-dish"),
        new Component("ALERTS",   "Alerting / SLO",      "observability", "OBS",       "ringing-bell"),
        new Component("LORE",     "System AIDA Lore",    "platform",      "FE",        "open-book"),
        new Component("SDK",      "Client SDK",          "platform",      "FE",        null),
        // ── Platform / Security ───────────────────────────────────────────
        new Component("INFRA",    "Infrastructure",      "platform",      null,        "cog"),
        new Component("KC",       "Keycloak",            "security",      null,        "padlock")
    );

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    // Standalone gate: this BE shares system_aida_lore with the main project, so
    // by default it does NOT re-seed on boot. Set lore.bootstrap=true only when
    // pointing at a fresh ArcadeDB that needs the canonical components.
    @ConfigProperty(name = "lore.bootstrap", defaultValue = "false")
    boolean bootstrap;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String password;

    @Inject
    @RestClient
    LoreCommandClient client;

    @PostConstruct
    void seed() {
        if (!enabled || !bootstrap) return;
        LOG.infof("[LORE] Seeding %d LoreComponent entries", COMPONENTS.size());
        int upserted = 0;
        for (Component c : COMPONENTS) {
            String parentClause   = c.parentId()  == null ? "NULL" : "'" + c.parentId()  + "'";
            String gameIconClause = c.gameIcon()  == null ? "NULL" : "'" + c.gameIcon()  + "'";
            String sql = String.format(
                "UPDATE LoreComponent SET component_id='%s', full_name='%s', area='%s', parent_id=%s, game_icon=%s UPSERT WHERE component_id='%s'",
                c.id(), c.fullName().replace("'", "\\'"), c.area(), parentClause, gameIconClause, c.id()
            );
            try {
                client.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql))
                      .await().indefinitely();
                upserted++;
            } catch (Exception e) {
                LOG.warnf("[LORE SEED] component %s: %s", c.id(), e.getMessage());
            }
        }
        LOG.infof("[LORE] Seeded %d/%d components", upserted, COMPONENTS.size());
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
                (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }
}
