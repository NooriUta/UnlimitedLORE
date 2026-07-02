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
        "CREATE VERTEX TYPE KnowTag          IF NOT EXISTS EXTENDS V",
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
        "CREATE EDGE TYPE TARGETS_MILESTONE IF NOT EXISTS EXTENDS E",
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
        "CREATE INDEX IF NOT EXISTS ON KnowTag         (tag_id)       UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSprint      (sprint_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSpec        (spec_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowFinding     (finding_id)   UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowRelease     (release_id)   UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowMilestone   (milestone_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowPhase       (phase_uid)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowTask        (task_uid)     UNIQUE",
        // NB 2026-07-01: CREATE INDEX ... NOTUNIQUE (unlike UNIQUE) does NOT
        // implicitly create the property — on a truly fresh DB it fails with
        // "property does not exist". Explicit CREATE PROPERTY first, everywhere
        // a NOTUNIQUE index follows. Confirmed by re-running backend/db-schema/
        // bootstrap.sh against a live DB missing exactly these two properties.
        "CREATE PROPERTY KnowTask.task_id IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowTask        (task_id) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanItem        (item_id)      UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanCheckpoint  (checkpoint_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanVersion     (version_id)   UNIQUE",

        // ── Status valid_to index (current-row lookup for write-path SCD2) ─────
        "CREATE PROPERTY StatusPlanItem.valid_to IF NOT EXISTS DATETIME",
        "CREATE INDEX IF NOT EXISTS ON StatusPlanItem    (valid_to) NOTUNIQUE",

        // ── Hist valid_to indexes (current-row queries) ───────────────────────
        "CREATE PROPERTY KnowDecisionHist.valid_to  IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowADRHist.valid_to       IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowSprintHist.valid_to    IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowSpecHist.valid_to      IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowFindingHist.valid_to   IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowReleaseHist.valid_to   IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowMilestoneHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowPhaseHist.valid_to     IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowTaskHist.valid_to      IF NOT EXISTS DATETIME",
        "CREATE PROPERTY PlanItemHist.valid_to      IF NOT EXISTS DATETIME",
        "CREATE INDEX IF NOT EXISTS ON KnowDecisionHist  (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowADRHist       (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSprintHist    (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSpecHist      (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowFindingHist   (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowReleaseHist   (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowMilestoneHist (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowPhaseHist     (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowTaskHist      (valid_to) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON PlanItemHist      (valid_to) NOTUNIQUE",

        // ── Phase 5 (v1.2): KnowRunbook + QualityGate + QGMetric ────────────────
        "CREATE VERTEX TYPE KnowRunbook     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowRunbookHist IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE QualityGate     IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE QGMetric        IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowDoc         IF NOT EXISTS EXTENDS V",
        "CREATE VERTEX TYPE KnowDocHist     IF NOT EXISTS EXTENDS V",

        "CREATE EDGE TYPE MEASURED_BY       IF NOT EXISTS EXTENDS E",

        "CREATE PROPERTY KnowRunbookHist.state_uid  IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowRunbookHist.valid_from  IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowRunbookHist.valid_to    IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowRunbookHist.content_md  IF NOT EXISTS STRING",

        "CREATE INDEX IF NOT EXISTS ON KnowRunbook    (runbook_id)  UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowRunbookHist (state_uid)  UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowRunbookHist (valid_to)   NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON QualityGate   (qg_id)        UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON QGMetric      (metric_id)    UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowDoc       (doc_id)       UNIQUE",
        "CREATE PROPERTY KnowDocHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE INDEX IF NOT EXISTS ON KnowDocHist   (valid_to) NOTUNIQUE",

        // ── Phase 6 (v1.3): ClRoutine* — routine run outputs stored in LORE ──
        // ArcadeDB DDL: CREATE VERTEX/EDGE TYPE (no EXTENDS V/E via SQL),
        // properties via CREATE PROPERTY <Type>.<prop> <TYPE>
        "CREATE VERTEX TYPE ClRoutineRun        IF NOT EXISTS",
        "CREATE PROPERTY ClRoutineRun.routine_name     IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineRun.run_date         IF NOT EXISTS DATE",
        "CREATE PROPERTY ClRoutineRun.run_ts           IF NOT EXISTS DATETIME",
        "CREATE PROPERTY ClRoutineRun.status           IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineRun.flags            IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineRun.detail_md        IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineRun.gates_failed_ids IF NOT EXISTS STRING",
        // SMART-QG run identity (lore_record_qg_run UPSERT WHERE run_id) — durable
        "CREATE PROPERTY ClRoutineRun.run_id           IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineRun.started_at       IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineRun.finished_at      IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON ClRoutineRun (run_id) UNIQUE",

        "CREATE VERTEX TYPE ClRoutineMetric     IF NOT EXISTS",
        "CREATE PROPERTY ClRoutineMetric.routine_name  IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineMetric.run_date      IF NOT EXISTS DATE",
        "CREATE PROPERTY ClRoutineMetric.metric_key    IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineMetric.value         IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY ClRoutineMetric.unit          IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineMetric.target        IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY ClRoutineMetric.status        IF NOT EXISTS STRING",
        // SMART-QG metric identity + evidence (lore_record_qg_run UPSERT WHERE metric_id) — durable
        "CREATE PROPERTY ClRoutineMetric.metric_id     IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineMetric.run_id        IF NOT EXISTS STRING",
        // source = exact reproducer command + file:line evidence, drives _qg_recommend
        "CREATE PROPERTY ClRoutineMetric.source        IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON ClRoutineMetric (metric_id) UNIQUE",

        "CREATE VERTEX TYPE ClRoutineSprintFlag IF NOT EXISTS",
        "CREATE PROPERTY ClRoutineSprintFlag.routine_name IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineSprintFlag.run_date     IF NOT EXISTS DATE",
        "CREATE PROPERTY ClRoutineSprintFlag.sprint_id    IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineSprintFlag.flag         IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineSprintFlag.lore_status  IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineSprintFlag.git_status   IF NOT EXISTS STRING",

        "CREATE VERTEX TYPE ClRoutineOutput     IF NOT EXISTS",
        "CREATE PROPERTY ClRoutineOutput.routine_name  IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineOutput.run_date      IF NOT EXISTS DATE",
        "CREATE PROPERTY ClRoutineOutput.output_type   IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineOutput.title         IF NOT EXISTS STRING",
        "CREATE PROPERTY ClRoutineOutput.content_md    IF NOT EXISTS STRING",

        "CREATE EDGE TYPE ClRoutineHasOutput    IF NOT EXISTS",

        "CREATE INDEX IF NOT EXISTS ON ClRoutineOutput(routine_name, run_date, output_type) UNIQUE",

        // ── Phase 7 (SPEC-BRAGI-ARCHIVE-001 v0.4): BRAGI content archive ────────
        // Facts+metrics dataset (спека: "Этот архив = факты и метрики"), distinct
        // from the Forseti planning graph — flat vertices, no SCD2/Hist twins.
        // MetricSnapshot itself is ARC-02 (LSM_TIMESERIES, separate storage engine —
        // no graph edges to it; consumers reference it by object_type+object_id tags).
        "CREATE VERTEX TYPE BragiPublication IF NOT EXISTS",
        "CREATE PROPERTY BragiPublication.publication_id  IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPublication.title            IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPublication.topic             IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPublication.main_text_md      IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPublication.type              IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPublication.status_general    IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiPublication (publication_id) UNIQUE",

        "CREATE VERTEX TYPE BragiVariant IF NOT EXISTS",
        "CREATE PROPERTY BragiVariant.variant_id      IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiVariant.text_md         IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiVariant.status          IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiVariant.url             IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiVariant.published_at    IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiVariant (variant_id) UNIQUE",

        "CREATE VERTEX TYPE BragiAsset IF NOT EXISTS",
        "CREATE PROPERTY BragiAsset.asset_id     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiAsset.asset_type   IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiAsset.file_url     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiAsset.alt          IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiAsset.size_bytes   IF NOT EXISTS LONG",
        "CREATE INDEX IF NOT EXISTS ON BragiAsset (asset_id) UNIQUE",

        "CREATE VERTEX TYPE BragiChannel IF NOT EXISTS",
        "CREATE PROPERTY BragiChannel.channel_id    IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiChannel.channel_type  IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiChannel.url_handle    IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiChannel.funnel_role   IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiChannel.rules_md      IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiChannel (channel_id) UNIQUE",

        "CREATE VERTEX TYPE BragiKeyword IF NOT EXISTS",
        "CREATE PROPERTY BragiKeyword.keyword_id    IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiKeyword.phrase        IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiKeyword.cluster       IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiKeyword.freq_exact    IF NOT EXISTS INTEGER",
        "CREATE PROPERTY BragiKeyword.freq_broad    IF NOT EXISTS INTEGER",
        "CREATE PROPERTY BragiKeyword.source        IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiKeyword.intent        IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiKeyword.region_engine IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiKeyword.measured_at   IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiKeyword (keyword_id) UNIQUE",

        "CREATE VERTEX TYPE BragiPage IF NOT EXISTS",
        "CREATE PROPERTY BragiPage.page_id       IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPage.url           IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPage.title         IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPage.description   IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPage.page_type     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiPage.deployed_at   IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiPage (page_id) UNIQUE",

        "CREATE VERTEX TYPE BragiCampaign IF NOT EXISTS",
        "CREATE PROPERTY BragiCampaign.campaign_id    IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiCampaign.utm_source     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiCampaign.utm_medium     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiCampaign.utm_campaign   IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiCampaign.target_url     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiCampaign.period         IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiCampaign (campaign_id) UNIQUE",

        "CREATE VERTEX TYPE BragiCompetitor IF NOT EXISTS",
        "CREATE PROPERTY BragiCompetitor.competitor_id IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiCompetitor.name          IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiCompetitor (competitor_id) UNIQUE",

        "CREATE VERTEX TYPE BragiInsight IF NOT EXISTS",
        "CREATE PROPERTY BragiInsight.insight_id     IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiInsight.statement_md   IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiInsight.insight_date   IF NOT EXISTS STRING",
        // Обоснование (замеры) — MetricSnapshot живёт в отдельном TIMESERIES-движке
        // и не участвует в графовых рёбрах; ссылка на обоснование хранится текстом
        // (диапазон дат/метрика/объект), не рёбрами.
        "CREATE PROPERTY BragiInsight.evidence_ref   IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiInsight (insight_id) UNIQUE",

        "CREATE VERTEX TYPE BragiIntegration IF NOT EXISTS",
        "CREATE PROPERTY BragiIntegration.integration_id  IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiIntegration.service          IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiIntegration.purpose          IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiIntegration.endpoint         IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiIntegration.scope            IF NOT EXISTS STRING",
        // Ссылка на секрет (env/vault key name) — НИКОГДА значение токена.
        "CREATE PROPERTY BragiIntegration.secret_ref       IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiIntegration.status           IF NOT EXISTS STRING",
        "CREATE PROPERTY BragiIntegration.last_called_at   IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON BragiIntegration (integration_id) UNIQUE",

        // Edges — 7 из заметки ARC-01 + 2 доп. для полноты ER-модели спеки v0.4
        // (Keyword→Page целевая страница, Campaign→Variant вариация)
        "CREATE EDGE TYPE HAS_VARIANT      IF NOT EXISTS",
        "CREATE EDGE TYPE HAS_ASSET        IF NOT EXISTS",
        "CREATE EDGE TYPE TARGETS_KEY      IF NOT EXISTS",
        "CREATE EDGE TYPE IN_CHANNEL       IF NOT EXISTS",
        "CREATE EDGE TYPE PRODUCED_BY      IF NOT EXISTS",
        "CREATE EDGE TYPE SHIPPED_IN       IF NOT EXISTS",
        "CREATE EDGE TYPE LED_TO           IF NOT EXISTS",
        "CREATE EDGE TYPE TARGETS_PAGE     IF NOT EXISTS",
        "CREATE EDGE TYPE FOR_VARIANT      IF NOT EXISTS",

        // ── ARC-02: MetricSnapshot — native ArcadeDB time-series (not a graph
        // vertex/edge; separate storage engine, hence no HAS_STATE/edges to it).
        // Real syntax confirmed against ArcadeDB docs — spec's "LSM_TIMESERIES"
        // literal does not exist, actual keyword is CREATE TIMESERIES TYPE.
        "CREATE TIMESERIES TYPE MetricSnapshot " +
            "TIMESTAMP ts " +
            "TAGS (object_type STRING, object_id STRING, metric STRING, source STRING, segment STRING) " +
            "FIELDS (value DOUBLE)",

        // ── ARC-03: secondary indexes (площадка — via IN_CHANNEL edge traversal,
        // no property index needed; статус/дата/ключ are direct properties) ────
        "CREATE INDEX IF NOT EXISTS ON BragiVariant     (status)       NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON BragiVariant     (published_at) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON BragiPublication (status_general) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON BragiKeyword     (cluster)      NOTUNIQUE"
    );
}
