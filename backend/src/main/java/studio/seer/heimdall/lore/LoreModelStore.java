package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 — SPEC-LORE-MODEL-CONFIG-STORE: модель LORE хранится записью в LORE
 * с историей SCD2 (вершина KnowModelConfig, версии KnowModelConfigHist через HAS_STATE). Файл
 * репозитория — семя и эталон MC-01.
 *
 * <ul>
 *   <li>Старт: открытая версия есть — модель из неё (источник правды — LORE), расхождение с файлом
 *       видно ({@code seed_drift}); версии нет — семя из файла; LORE недоступна — модель из файла с
 *       предупреждением, а не молча.</li>
 *   <li>Запись: разбор → согласованность ({@link LoreModelConsistency}) → оптимистичная блокировка по
 *       hash → новая версия, прежняя закрыта → модель заменяется без рестарта. Отказ — ничего не записано.</li>
 * </ul>
 */
@ApplicationScoped
@Startup
public class LoreModelStore {

    private static final Logger LOG = Logger.getLogger(LoreModelStore.class);

    static final String CONFIG_ID = "lore-model";

    /**
     * V84 (major 17, аддитивно): DDL рядом с логикой, как у V79–V81. Типы БЕЗ «EXTENDS V» — в прод-базе
     * базового V нет (только bootstrap инициализатора), накатка падала «Supertype V not found»
     * (PL-MIGRATE-LIVE-CHECK 13.11); сторож — MigrationStepsNoBaseSupertypeTest.
     */
    static final List<String> SCHEMA_SQL = List.of(
        "CREATE VERTEX TYPE KnowModelConfig IF NOT EXISTS",
        "CREATE VERTEX TYPE KnowModelConfigHist IF NOT EXISTS",
        "CREATE PROPERTY KnowModelConfig.config_id IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowModelConfig.format IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowModelConfig (config_id) UNIQUE",
        "CREATE PROPERTY KnowModelConfigHist.state_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowModelConfigHist.valid_from IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowModelConfigHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowModelConfigHist.content IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowModelConfigHist.content_hash IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowModelConfigHist.reason IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowModelConfigHist.changed_by IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowModelConfigHist.changed_by_kind IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowModelConfigHist (valid_to) NOTUNIQUE");

    static final String OPEN_SQL = "SELECT state_uid, content, content_hash, changed_by FROM KnowModelConfigHist "
        + "WHERE in('HAS_STATE').config_id CONTAINS :id AND valid_to IS NULL";

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient client;

    @Inject
    LoreIngestService ingest;

    /** Порядок старта как у сидера компонентов (MIG-31): ядро и все шаги миграций — до чтения. */
    @Inject
    LoreSchemaInitializer bootstrapFirst;

    @Inject
    LoreSchemaMigrationRunner migrationsFirst;

    private volatile String source = "file";
    private volatile String hash = hashOf(LoreModelFile.render(LoreModelFile.content()));
    private volatile String warning;

    @PostConstruct
    void load() {
        if (!enabled) return;
        try {
            bootstrapFirst.ensureReady();
            migrationsFirst.ensureReady();
            List<Map<String, Object>> open = ingest.queryPublic(OPEN_SQL, Map.of("id", CONFIG_ID));
            if (open.size() > 1) throw new IllegalStateException("открытых версий модели " + open.size() + " — ждали одну");
            if (open.isEmpty()) {
                seed();
                return;
            }
            String text = String.valueOf(open.get(0).get("content"));
            // MC-07/MC-08: семя, которое никто не правил, следует за файлом; правку человека не трогаем,
            // ей только досеваются недостающие разделы нового формата.
            Upgrade up = reconcile(text, String.valueOf(open.get(0).get("changed_by")), LoreModelFile.render(LoreModelFile.load()));
            if (!up.added().isEmpty()) {
                write(up.text(), hashOf(up.text()), up.added().equals(List.of("*")) ? "обновление семени из файла репозитория"
                    : "досев разделов из файла: " + String.join(", ", up.added()),
                    new ChangeAuthor("seed", ChangeAuthor.KIND_UNKNOWN));
                text = up.text();
                LOG.infof("[LORE MODEL] досеяны разделы из файла: %s", up.added());
            }
            LoreModelFile.Content c = LoreModelFile.parse(text);
            LoreModelFile.replace(c);
            hash = hashOf(LoreModelFile.render(c));
            source = "lore";
            warning = null;
            LOG.infof("[LORE MODEL] модель из LORE, версия %s%s", hash, seedDrift() ? " (расходится с файлом репозитория)" : "");
        } catch (RuntimeException e) {
            warning = "модель из LORE не прочитана — работаю по файлу репозитория: " + e.getMessage();
            source = "file";
            LOG.warnf("[LORE MODEL] %s", warning);
        }
    }

    /** Семя: версия из файла репозитория (copy в classpath), автор — seed. */
    private void seed() {
        String text = LoreModelFile.render(LoreModelFile.load());
        write(text, hashOf(text), "семя из файла репозитория", new ChangeAuthor("seed", ChangeAuthor.KIND_UNKNOWN));
        hash = hashOf(text);
        source = "lore";
        warning = null;
        LOG.infof("[LORE MODEL] модель засеяна из файла, версия %s", hash);
    }

    /** Досев: текст модели и разделы верхнего уровня, взятые из файла. */
    record Upgrade(String text, List<String> added) {}

    /**
     * MC-07: разделы верхнего уровня, которых нет в сохранённой модели, берутся из файла (новый формат —
     * nav, audience); всё, что в сохранённой есть, остаётся как есть — правки в LORE не перетираются.
     */
    /**
     * Решение на старте: версию писало семя ({@code changed_by = seed}) и она отличается от файла —
     * пересев целиком ({@code added = ["*"]}); иначе — досев недостающих разделов ({@link #upgrade}).
     */
    static Upgrade reconcile(String stored, String storedBy, String file) {
        if (SEED.equals(storedBy) && !hashOf(LoreModelFile.render(LoreModelFile.parse(upgrade(stored, file).text()))).equals(hashOf(file)))
            return new Upgrade(file, List.of("*"));
        return upgrade(stored, file);
    }

    static final String SEED = "seed";

    static Upgrade upgrade(String stored, String file) {
        io.vertx.core.json.JsonObject s = new io.vertx.core.json.JsonObject(stored);
        io.vertx.core.json.JsonObject f = new io.vertx.core.json.JsonObject(file);
        List<String> added = new ArrayList<>();
        for (String k : new java.util.TreeSet<>(f.fieldNames()))
            if (!s.containsKey(k)) { s.put(k, f.getValue(k)); added.add(k); }
        if (added.isEmpty()) return new Upgrade(stored, List.of());
        return new Upgrade(LoreModelFile.render(LoreModelFile.parse(s.encode())), List.copyOf(added));
    }

    // ── Состояние для /lore/model ───────────────────────────────────────

    String source() { return source; }

    String hash() { return hash; }

    String warning() { return warning; }

    /** Действующая модель (из LORE) отличается от файла репозитория. */
    boolean seedDrift() {
        return "lore".equals(source) && !hashOf(LoreModelFile.render(LoreModelFile.load())).equals(hash);
    }

    // ── Запись ──────────────────────────────────────────────────────────

    /** Итог сохранения: HTTP-код и тело ответа. */
    record Result(int status, Map<String, Object> body) {}

    Result save(String content, String reason, String expectedHash, boolean dryRun, ChangeAuthor by) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (content == null || content.isBlank()) return refuse(400, "BAD_PARAMS", List.of("content пуст"));
        if (!dryRun && (reason == null || reason.isBlank())) return refuse(400, "BAD_PARAMS", List.of("reason обязателен: зачем правка"));
        LoreModelFile.Content c;
        try {
            c = LoreModelFile.parse(content);
        } catch (IllegalStateException e) {
            return refuse(422, "MODEL_INCONSISTENT", List.of(e.getMessage()));
        }
        List<String> problems = LoreModelConsistency.problems(c, schemaNames(), declared(), id -> LoreSlices.get(id) != null);
        if (!problems.isEmpty()) return refuse(422, "MODEL_INCONSISTENT", problems);
        String text = LoreModelFile.render(c);
        String newHash = hashOf(text);
        if (expectedHash != null && !expectedHash.isBlank() && !expectedHash.equals(hash)) {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("error", "CONFLICT");
            b.put("detail", "модель изменилась с тех пор, как вы её открыли");
            b.put("current_hash", hash);
            return new Result(409, b);
        }
        body.put("ok", true);
        body.put("dry_run", dryRun);
        body.put("hash_before", hash);
        body.put("hash", newHash);
        body.put("changed", !newHash.equals(hash));
        body.put("types_changed", typesChanged(LoreModelFile.content(), c));
        if (dryRun || newHash.equals(hash)) return new Result(200, body);
        write(text, newHash, reason, by);
        LoreModelFile.replace(c);
        hash = newHash;
        source = "lore";
        warning = null;
        return new Result(200, body);
    }

    /** Типы, у которых описание отличается — короткий дифф для ответа и журнала. */
    static List<String> typesChanged(LoreModelFile.Content a, LoreModelFile.Content b) {
        List<String> out = new ArrayList<>();
        Set<String> all = new java.util.LinkedHashSet<>(a.types());
        all.addAll(b.types());
        for (String t : all)
            if (!java.util.Objects.equals(a.typeDefs().get(t), b.typeDefs().get(t))) out.add(t);
        return out;
    }

    /** Одна транзакция: вершина есть, прежняя версия закрыта, новая открыта и привязана. */
    private void write(String text, String newHash, String reason, ChangeAuthor by) {
        String now = Instant.now().toString();
        String sid = UUID.randomUUID().toString();
        String script = "UPDATE KnowModelConfig SET config_id = :id, format = :fmt UPSERT WHERE config_id = :id;"
            + "UPDATE KnowModelConfigHist SET valid_to = :now WHERE in('HAS_STATE').config_id CONTAINS :id AND valid_to IS NULL;"
            + "INSERT INTO KnowModelConfigHist SET state_uid = :sid, valid_from = :now, content = :content, "
            + "content_hash = :hash, reason = :reason" + ChangeAuthor.SET_SQL + ";"
            + "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowModelConfig WHERE config_id = :id) "
            + "TO (SELECT FROM KnowModelConfigHist WHERE state_uid = :sid AND in('HAS_STATE').size() = 0);";
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("id", CONFIG_ID);
        p.put("fmt", LoreModelFile.FORMAT);
        p.put("now", now);
        p.put("sid", sid);
        p.put("content", text);
        p.put("hash", newHash);
        p.put("reason", reason);
        by.bind(p);
        client.command(db, mart.basicAuth(), new LoreCommandClient.LoreCommand("sqlscript", script, p)).await().indefinitely();
    }

    /** Тело версии по state_uid (для диффа и отката в админке); null — версии нет. */
    String versionContent(String stateUid) {
        List<Map<String, Object>> r = ingest.queryPublic(
            "SELECT content FROM KnowModelConfigHist WHERE state_uid = :s LIMIT 1", Map.of("s", stateUid));
        return r.isEmpty() ? null : String.valueOf(r.get(0).get("content"));
    }

    // ── Факты схемы для проверки согласованности ────────────────────────

    private List<Map<String, Object>> schemaRows() {
        try {
            return ingest.queryPublic("SELECT name, properties FROM schema:types", Map.of());
        } catch (RuntimeException e) {
            LOG.warnf("[LORE MODEL] схема не прочитана — правило «ребро есть в схеме» не проверено: %s", e.getMessage());
            return null;
        }
    }

    private Set<String> schemaNames() {
        List<Map<String, Object>> rows = schemaRows();
        if (rows == null) return null;
        Set<String> out = new java.util.HashSet<>();
        for (Map<String, Object> r : rows) if (r.get("name") != null) out.add(String.valueOf(r.get("name")));
        return out;
    }

    private Map<String, Map<String, String>> declared() {
        List<Map<String, Object>> rows = schemaRows();
        if (rows == null) return null;
        Map<String, Map<String, String>> out = new java.util.HashMap<>();
        for (Map<String, Object> t : rows) {
            Map<String, String> types = new java.util.HashMap<>();
            if (t.get("properties") instanceof List<?> l)
                for (Object o : l)
                    if (o instanceof Map<?, ?> pm && pm.get("name") != null && pm.get("type") != null)
                        types.put(String.valueOf(pm.get("name")), String.valueOf(pm.get("type")));
            out.put(String.valueOf(t.get("name")), types);
        }
        return out;
    }

    private static Result refuse(int status, String code, List<String> problems) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("error", code);
        b.put("problems", problems);
        b.put("written", false);
        return new Result(status, b);
    }

    static String hashOf(String text) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(h).substring(0, 16);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 недоступен", e);
        }
    }
}
