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
 * Idempotent DDL bootstrap for system_aida_lore.
 * Runs at startup; all statements use IF NOT EXISTS so re-runs are safe.
 * Pattern: MimirSessionInitializer.
 */
@ApplicationScoped
@Startup
public class LoreSchemaInitializer {

    private static final Logger LOG = Logger.getLogger(LoreSchemaInitializer.class);

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    // Standalone gate: shared system_aida_lore already has the schema, so skip
    // DDL on boot by default. Set lore.bootstrap=true for a fresh ArcadeDB.
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
    void init() {
        if (!enabled || !bootstrap) {
            LOG.info("[LORE] schema init skipped (lore.enabled/lore.bootstrap off — shared DB already initialized)");
            return;
        }
        LOG.infof("[LORE] Initializing schema in %s", db);
        DDL.forEach(this::execIgnoreError);
        LOG.infof("[LORE] Schema init complete for %s", db);
    }

    private void execIgnoreError(String sql) {
        try {
            client.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql))
                  .await().indefinitely();
        } catch (Exception e) {
            LOG.tracef("[LORE DDL] '%s' → %s", sql, e.getMessage());
        }
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
                (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    // ── Vertex types ──────────────────────────────────────────────────────────
    private static final List<String> DDL = List.of(
        // Справочники
        "CREATE VERTEX TYPE LoreComponent    IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE LoreTechnology   IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE LoreTag          IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusDecision   IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusAdr        IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusSprint     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusMilestone  IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusTask       IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusPhase      IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE StatusPlanItem   IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE TrackType        IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanTrack        IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanSection      IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanConfig       IF NOT EXISTS EXTENDS V",
        // Ядра
        "CREATE VERTEX TYPE KnowDecision     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowADR          IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowSprint       IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowSpec         IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowFinding      IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowRelease      IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowMilestone    IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowPhase        IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowTask         IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanItem         IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanCheckpoint   IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanVersion      IF NOT EXISTS EXTENDS V",
        // Hist (SCD2)
        "CREATE VERTEX TYPE KnowDecisionHist  IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowADRHist       IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowSprintHist    IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowSpecHist      IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowFindingHist   IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowReleaseHist   IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowMilestoneHist IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowPhaseHist     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowTaskHist      IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE PlanItemHist      IF NOT EXISTS EXTENDS V",

        // ── Edge types ────────────────────────────────────────────────────────
        "CREATE EDGE TYPE DECIDED_IN       IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE FORMALIZED_AS    IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE IMPLEMENTED_IN   IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE DEPENDS_ON       IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE SUPERSEDES       IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE YIELDED          IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE VALIDATES        IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE BELONGS_TO       IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE DOCUMENTED_IN    IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE TAGGED_WITH      IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE CONTRIBUTES_TO   IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE RELEASED_IN      IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE INCLUDES         IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE GATES            IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE PART_OF          IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE IN_PHASE         IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE PARENT_OF        IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE USES             IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE ON_TRACK         IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE REPRESENTS       IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE ON_MILESTONE     IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE OF_TYPE          IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE CHANGED_IN       IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE IMPLEMENTED_IN_RELEASE IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE HAS_STATE        IF NOT EXISTS EXTENDS E",
        "CREATE EDGE TYPE HAS_STATUS       IF NOT EXISTS EXTENDS E",

        // ── Unique indexes on PK fields ───────────────────────────────────────
        "CREATE INDEX IF NOT EXISTS ON LoreComponent   (component_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON LoreTechnology  (tech_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON LoreTag         (tag_id)       UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusDecision  (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusAdr       (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusSprint    (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusMilestone (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusTask      (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusPhase     (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON StatusPlanItem  (status_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON TrackType       (type_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanTrack       (track_id)     UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanSection     (section_id)   UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanConfig      (config_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowDecision    (decision_id)  UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowADR         (adr_id)       UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSprint      (sprint_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSpec        (spec_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowFinding     (finding_id)   UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowRelease     (release_id)   UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowMilestone   (milestone_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowPhase       (phase_uid)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowTask        (task_uid)     UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowTask        (task_id)",
        "CREATE INDEX IF NOT EXISTS ON PlanItem        (item_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanCheckpoint  (checkpoint_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanVersion     (version_id)   UNIQUE",

        // ── Status valid_to index (current-row lookup for write-path SCD2) ─────
        "CREATE INDEX IF NOT EXISTS ON StatusPlanItem    (valid_to)",

        // ── Hist valid_to indexes (current-row queries) ───────────────────────
        "CREATE INDEX IF NOT EXISTS ON KnowDecisionHist  (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowADRHist       (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowSprintHist    (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowSpecHist      (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowFindingHist   (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowReleaseHist   (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowMilestoneHist (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowPhaseHist     (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON KnowTaskHist      (valid_to)",
        "CREATE INDEX IF NOT EXISTS ON PlanItemHist      (valid_to)",

        // ── Phase 5 (v1.2): KnowRunbook + QualityGate + QGMetric ────────────────
        "CREATE VERTEX TYPE KnowRunbook     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE QualityGate     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE QGMetric        IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowDoc         IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowDocHist     IF NOT EXISTS EXTENDS V",

        "CREATE EDGE TYPE MEASURED_BY       IF NOT EXISTS EXTENDS E",

        "CREATE INDEX IF NOT EXISTS ON KnowRunbook  (runbook_id)  UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON QualityGate  (qg_id)       UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON QGMetric     (metric_id)   UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowDoc      (doc_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowDocHist  (valid_to)"
    );
}
