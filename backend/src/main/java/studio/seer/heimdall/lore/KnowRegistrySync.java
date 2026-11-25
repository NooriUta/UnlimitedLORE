package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-09 (окно OQ-064-KNOWKIND-IMPORT; KREG-03 — теги) — импорт KnowKind при деплое.
 *
 * <p>SPEC-MODEL-EXPORT-064 §3, правила 2 и 4: KnowKind наполняется из выдачи генератора, собранной на билде
 * ({@code lore-model/know-registry.json} в classpath, KREG-02), и из справочника тегов графа (виды tag:*,
 * «из графа в граф», §3а.3). В рантайме KnowKind только читается: импорт — один проход при старте релиза,
 * дальше ничего не пишет. Идемпотентен ({@link KnowKindImport#plan}): виды с тем же content_hash не трогаются,
 * изменённые получают новую SCD2-версию (KnowKindHist через HAS_STATE), снятые — только в лог.
 *
 * <p>Выключен по умолчанию ({@code lore.know-registry.import=false}): включение на стенде — решение владелицы
 * (переменная окружения {@code LORE_KNOW_REGISTRY_IMPORT=true}). Режим {@code lore.migrate.only} не пишет.
 * Сбой импорта старт не роняет — реестр агентский, UI на него не смотрит — но громкий: строка WARN и
 * {@link #lastError()}.
 */
@ApplicationScoped
@Startup
public class KnowRegistrySync {

    private static final Logger LOG = Logger.getLogger(KnowRegistrySync.class);

    static final String ARTIFACT = "lore-model/know-registry.json";

    /**
     * Префиксы видов, которыми владеет этот импорт: снятые из входа перечисляются в stale. forgejo:* — с
     * SPRINT_FORGEJO_MINIAPP/FJ-01: виды берутся из реестра маршрутов миниаппа ({@link ForgejoRoutes#kinds()}).
     */
    static final Set<String> MANAGED = Set.of("entity:", "ddl:", "slice:", "tag:", "skill:", "forgejo:");

    static final String EXISTING_SQL = "SELECT kind, out('HAS_STATE')[valid_to IS NULL].content_hash AS h FROM KnowKind";

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "lore.know-registry.import", defaultValue = "false")
    boolean importEnabled;

    @ConfigProperty(name = "lore.migrate.only", defaultValue = "false")
    boolean migrateOnly;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient client;

    @Inject
    LoreIngestService ingest;

    @Inject
    LoreSchemaInitializer bootstrapFirst;

    @Inject
    LoreSchemaMigrationRunner migrationsFirst;

    private volatile String lastError;
    private volatile KnowKindImport.Plan lastPlan;

    String lastError() { return lastError; }

    KnowKindImport.Plan lastPlan() { return lastPlan; }

    @PostConstruct
    void sync() {
        if (!enabled || !importEnabled) return;
        if (migrateOnly) {
            LOG.info("[KNOW REGISTRY] импорт пропущен: режим lore.migrate.only");
            return;
        }
        try {
            bootstrapFirst.ensureReady();
            migrationsFirst.ensureReady();
            List<Map<String, Object>> desired = new ArrayList<>(artifactKinds());
            JsonObject model = new JsonObject(LoreModelFile.render(LoreModelFile.content()));
            desired.addAll(KnowRegistry.tagKinds(model, ingest.queryPublic(KnowRegistry.TAGS_SQL, Map.of()),
                AgentScopeFilter.FAMILY_AGENTS));
            desired.addAll(ForgejoRoutes.load().kinds());   // FJ-01: forgejo:* — данными реестра маршрутов
            Map<String, String> existing = new HashMap<>();
            for (Map<String, Object> r : ingest.queryPublic(EXISTING_SQL, Map.of())) {
                Object h = r.get("h");
                if (h instanceof List<?> l) h = l.isEmpty() ? null : l.get(0);
                existing.put(String.valueOf(r.get("kind")), h == null ? null : String.valueOf(h));
            }
            KnowKindImport.Plan plan = KnowKindImport.plan(existing, desired, MANAGED);
            String now = Instant.now().toString();
            for (Map<String, Object> k : plan.inserts()) write(k, now);
            for (Map<String, Object> k : plan.updates()) write(k, now);
            lastPlan = plan;
            lastError = null;
            LOG.infof("[KNOW REGISTRY] импорт: +%d, ~%d, =%d, снятых во входе %d %s", plan.inserts().size(),
                plan.updates().size(), plan.unchanged().size(), plan.stale().size(), plan.stale().isEmpty() ? "" : plan.stale());
        } catch (RuntimeException e) {
            lastError = e.getMessage();
            LOG.warnf("[KNOW REGISTRY] импорт KnowKind не выполнен — реестр агентов остался прежним: %s", e.getMessage());
        }
    }

    /** Одна транзакция на вид: вершина по kind, прежняя версия закрыта, новая открыта и привязана. */
    private void write(Map<String, Object> k, String now) {
        Map<String, Object> row = vertexRow(k);
        StringBuilder set = new StringBuilder();
        for (String c : row.keySet()) set.append(set.length() == 0 ? "" : ", ").append(c).append(" = :v_").append(c);
        String script = "UPDATE KnowKind SET " + set + " UPSERT WHERE kind = :kind;"
            + "UPDATE KnowKindHist SET valid_to = :now WHERE kind = :kind AND valid_to IS NULL;"
            + "INSERT INTO KnowKindHist SET kind = :kind, valid_from = :now, content_hash = :hash,"
            + " changed_by = :changed_by, changed_by_kind = :changed_by_kind;"
            + "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowKind WHERE kind = :kind) "
            + "TO (SELECT FROM KnowKindHist WHERE kind = :kind AND valid_to IS NULL AND in('HAS_STATE').size() = 0);";
        Map<String, Object> p = new LinkedHashMap<>();
        row.forEach((c, v) -> p.put("v_" + c, v));
        p.put("kind", k.get("kind"));
        p.put("now", now);
        p.put("hash", k.get("content_hash"));
        p.put("changed_by", "know-registry-import");
        p.put("changed_by_kind", ChangeAuthor.KIND_UNKNOWN);
        client.command(db, mart.basicAuth(), new LoreCommandClient.LoreCommand("sqlscript", script, p)).await().indefinitely();
    }

    /** Свойства вершины — только колонки DDL V94; null-колонки не пишутся. */
    static Map<String, Object> vertexRow(Map<String, Object> k) {
        Map<String, Object> row = new LinkedHashMap<>();
        for (String c : KnowKindImport.COLUMNS) if (k.get(c) != null) row.put(c, k.get(c));
        return row;
    }

    static String artifactText() {
        try (InputStream in = KnowRegistrySync.class.getClassLoader().getResourceAsStream(ARTIFACT)) {
            if (in == null) throw new IllegalStateException("нет выдачи генератора " + ARTIFACT + " в classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("выдача генератора " + ARTIFACT + " не прочитана: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> artifactKinds() {
        JsonObject doc = new JsonObject(artifactText());
        if (!KnowRegistry.FORMAT.equals(doc.getString("format")))
            throw new IllegalStateException("выдача генератора: формат " + doc.getString("format") + ", ждали " + KnowRegistry.FORMAT);
        List<Map<String, Object>> out = new ArrayList<>();
        JsonArray kinds = doc.getJsonArray("kinds");
        if (kinds != null) for (Object o : kinds) out.add(((JsonObject) o).getMap());
        return out;
    }
}
