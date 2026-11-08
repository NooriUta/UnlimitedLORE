package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Spins up a throwaway ArcadeDB container (same image tag as the live
 * Ygg/frigg instances) for tests that need real SCD2/A1-transaction behavior.
 * Creates a fresh database and points the app at it with lore.bootstrap=true so
 * LoreSchemaInitializer/LoreComponentSeeder run their normal startup DDL —
 * no hand-duplicated schema here.
 *
 * CI-fallback (решение владельца 2026-07-17): на self-hosted Forgejo-раннере
 * Testcontainers/Ryuk не работает (DooD), и live-DB тесты годами скипались —
 * регрессия схемы на чистой БД там не ловилась ВООБЩЕ. Если задан
 * LORE_TEST_DB_URL — контейнер не поднимается, тесты идут в ПОСТОЯННУЮ БД
 * (обычно lore_ci_test на живом :2480). Изоляция от system_aida_lore —
 * отдельным именем БД; сам system_aida_lore тесты не трогают никогда.
 *
 * <h2>Схема — один раз за прогон (SPRINT_LORE_PIPELINE_HOST/PL-01, ADR-LORE-046 §2,
 * D-2026-LORE-CI-SCHEMA-ONCE-PER-RUN)</h2>
 *
 * Классы подключают ресурс с {@code restrictToAnnotatedClass = true}, поэтому
 * Quarkus поднимает приложение заново на КАЖДЫЙ класс. Раньше каждый подъём
 * пересоздавал базу и гонял весь bootstrap (≈410 DDL) и все шаги миграций —
 * замер SPRINT_UXR_S11_TEST_OPT/CI-01: ~30 с × 83 класса, 43–48 мин бэкенд-CI.
 *
 * Теперь (только для постоянной внешней БД, режим LORE_TEST_DB_URL):
 * <ul>
 *   <li><b>fresh</b> — первый старт в JVM: drop + create + bootstrap + migrate,
 *       как раньше. Это fresh-путь ADR-LORE-023, он остаётся в каждой сборке.
 *       Сразу после подъёма приложения {@link LoreTestDbBaselineCapture}
 *       снимает СНИМОК ДАННЫХ, которые положили bootstrap/сидер/шаги миграций
 *       (справочники KnowDictEntry, LoreComponent и т.п.).</li>
 *   <li><b>reuse</b> — следующие старты: база и схема остаются, удаляются
 *       ДАННЫЕ всех типов (рёбра, потом вершины, потом документы), кроме
 *       реестра версий LoreSchemaVersion, затем снимок кладётся обратно.
 *       Приложению отдаётся lore.bootstrap=false: инициализатор видит ядро и
 *       пропускает DDL, раннер видит ledger на текущей версии и ничего не катит.</li>
 *   <li>Любой сбой reuse-пути (нет снимка, ошибка удаления/восстановления) —
 *       ГРОМКО в лог и fresh-путь: медленнее, но правильно.</li>
 *   <li>Классы, которые сами меняют схему/ledger, подключают
 *       {@link LoreArcadeDbFreshTestResource}: всегда fresh, и после них
 *       «схема готова» сбрасывается — следующий класс тоже идёт fresh.</li>
 * </ul>
 *
 * Состояние «схема готова»/снимок/счётчики живут в System properties, а не в
 * static-полях: Quarkus грузит тестовые классы в разных загрузчиках на разные
 * приложения, и static мог бы обнулиться между классами молча.
 * Каждый старт печатает строку {@code [LORE TEST DB] ...} (её пробрасывает в лог
 * CI build.gradle) — по ней видно число fresh-инициализаций за прогон.
 */
public class LoreArcadeDbTestResource implements QuarkusTestResourceLifecycleManager {

    static final String ROOT_PASSWORD_CONTAINER = "lore_test_root_pw";
    static String ROOT_PASSWORD = ROOT_PASSWORD_CONTAINER; // фактический (external → из env)
    static String TEST_DB = "lore_c5_test";                // фактическое имя БД этого запуска

    // Exposed so live-DB test classes can run their own verification queries
    // (SCD2 row/edge state) straight against the DB — the app's own REST
    // surface has no "dump me the raw Hist rows" endpoint, nor should it.
    static volatile String BASE_URL;

    /** Реестр версий схемы: его не чистим никогда, иначе миграции покатятся заново. */
    static final String LEDGER_TYPE = "LoreSchemaVersion";

    // ── JVM-глобальное состояние (System properties: переживает смену загрузчика) ──
    static final String P_READY        = "lore.test.db.schemaReady";     // ключ url|db, где схема готова и снимок снят
    static final String P_PENDING      = "lore.test.db.baselinePending"; // ключ url|db, ждущий снимка после fresh-подъёма
    static final String P_BASELINE     = "lore.test.db.baseline";        // снимок данных (JSON)
    static final String P_STARTS       = "lore.test.db.starts";          // всего стартов ресурса за прогон
    static final String P_FRESH        = "lore.test.db.freshInits";      // из них fresh (полная инициализация схемы)
    static final String P_URL          = "lore.test.db.url";
    static final String P_DB           = "lore.test.db.name";
    static final String P_PW           = "lore.test.db.password";

    private GenericContainer<?> arcade;

    // ── швы для unit-теста (LoreArcadeDbTestResourceReuseTest): без живой БД ──
    Function<String, String> env = System::getenv;
    Function<Conn, Db> dbFactory = HttpDb::new;

    /** Режим «чистая база»: переопределяет {@link LoreArcadeDbFreshTestResource}. */
    boolean forceFresh() { return false; }

    /**
     * Встроенный сервер вместо контейнера: явно {@code LORE_TEST_DB_EMBEDDED=true},
     * явно выключен {@code =false}; без настройки — когда Docker недоступен
     * (машина без Docker раньше не могла гонять live-DB тесты вовсе).
     */
    boolean embeddedMode() {
        String v = env.apply("LORE_TEST_DB_EMBEDDED");
        if ("true".equalsIgnoreCase(v)) return true;
        if ("false".equalsIgnoreCase(v)) return false;
        return !dockerAvailable();
    }

    static boolean dockerAvailable() {
        try {
            return org.testcontainers.DockerClientFactory.instance().isDockerAvailable();
        } catch (Throwable t) {
            return false;
        }
    }

    record Conn(String baseUrl, String db, String password) {
        String key() { return baseUrl + "|" + db; }
    }

    /** Операции над сервером/базой — интерфейс ради unit-теста ресурса. */
    interface Db {
        void awaitReady();
        void serverCommand(String command, boolean ignoreError);
        List<Map<String, Object>> query(String sql);
        void command(String sql);
        void script(String sqlscript);
    }

    @Override
    public Map<String, String> start() {
        String externalUrl = env.apply("LORE_TEST_DB_URL");
        boolean externalUrlSet = externalUrl != null && !externalUrl.isBlank();
        boolean embedded = !externalUrlSet && embeddedMode();
        // «Постоянная» база — переживает классы в пределах прогона: внешняя по URL
        // или встроенный сервер (один на JVM). Для неё работает reuse-путь.
        boolean external = externalUrlSet || embedded;
        String baseUrl;
        if (externalUrlSet) {
            baseUrl = externalUrl.replaceAll("/+$", "");
            TEST_DB = orDefault(env.apply("LORE_TEST_DB_NAME"), "lore_ci_test");
            ROOT_PASSWORD = orDefault(env.apply("LORE_TEST_DB_PASSWORD"), "playwithdata");
        } else if (embedded) {
            baseUrl = LoreEmbeddedArcadeDb.url(ROOT_PASSWORD_CONTAINER);
            TEST_DB = "lore_embedded_test";
            ROOT_PASSWORD = ROOT_PASSWORD_CONTAINER;
            log("встроенный сервер ArcadeDB: " + baseUrl + " (без Docker и без общей базы)");
        } else {
            arcade = new GenericContainer<>(DockerImageName.parse("arcadedata/arcadedb:26.10.2"))
                .withEnv("JAVA_OPTS", "-Darcadedb.server.rootPassword=" + ROOT_PASSWORD_CONTAINER)
                .withExposedPorts(2480)
                .waitingFor(Wait.forListeningPort().withStartupTimeout(Duration.ofSeconds(60)));
            arcade.start();
            baseUrl = "http://" + arcade.getHost() + ":" + arcade.getMappedPort(2480);
            TEST_DB = "lore_c5_test";
            ROOT_PASSWORD = ROOT_PASSWORD_CONTAINER;
        }
        BASE_URL = baseUrl;
        Conn conn = new Conn(baseUrl, TEST_DB, ROOT_PASSWORD);
        System.setProperty(P_URL, conn.baseUrl());
        System.setProperty(P_DB, conn.db());
        System.setProperty(P_PW, conn.password());

        Db db = dbFactory.apply(conn);
        db.awaitReady();

        int start = bump(P_STARTS);
        String why = null;
        boolean reuse = false;
        if (!external) {
            why = "свой контейнер на класс — переиспользовать нечего";
        } else if (forceFresh()) {
            why = "класс помечен «чистая база» (меняет схему/ledger)";
        } else if (!conn.key().equals(System.getProperty(P_READY))) {
            why = System.getProperty(P_PENDING) != null
                ? "снимок данных после fresh-старта НЕ снят (LoreTestDbBaselineCapture не отработал)"
                : "первый старт в прогоне или после класса «чистая база»";
        } else {
            try {
                resetData(db, System.getProperty(P_BASELINE));
                reuse = true;
            } catch (RuntimeException e) {
                why = "reuse не удался: " + e.getMessage();
                log("ВНИМАНИЕ: " + why + " — откат на fresh-путь");
            }
        }

        if (!reuse) {
            System.clearProperty(P_READY);
            System.clearProperty(P_BASELINE);
            System.clearProperty(P_PENDING);
            recreateDatabase(db);
            // Снимок после подъёма снимает LoreTestDbBaselineCapture; для класса
            // «чистая база» не снимаем: он испортит схему, и следующий класс
            // всё равно обязан пойти fresh.
            if (external && !forceFresh()) System.setProperty(P_PENDING, conn.key());
        }
        int fresh = reuse ? count(P_FRESH) : bump(P_FRESH);
        log(String.format("инициализация схемы №%d за прогон (%s); полных (fresh) за прогон: %d%s",
            start, reuse ? "reuse" : "fresh", fresh,
            why == null ? "" : "; причина fresh: " + why));

        Map<String, String> cfg = new HashMap<>();
        cfg.put("quarkus.rest-client.mart-api.url", baseUrl);
        cfg.put("lore.db", TEST_DB);
        // reuse: ядро на месте, DDL инициализатора не нужен (он сам скажет
        // «schema init skipped (ядро есть)»), сидер тоже молчит — его данные
        // вернул снимок. fresh: полный bootstrap, как раньше.
        cfg.put("lore.bootstrap", reuse ? "false" : "true");
        // ADR-LORE-023: раннер миграций включён на каждом тестовом старте. На
        // fresh — полный путь bootstrap → шаги → ledger (доказывается на каждой
        // сборке первым классом); на reuse он видит ledger на текущей версии.
        cfg.put("lore.migrate", "true");
        // DBR-06: в тестовом профиле сверка версии выключена по умолчанию
        // (классы без живой БД падали бы на чтении ledger). Здесь БД есть,
        // поэтому включаем обратно ЯВНО — иначе выключенная ради чужих
        // тестов проверка тихо не работала бы и там, где её проверяют.
        cfg.put("lore.schema.verify", "true");
        cfg.put("bench.mart.user", "root");
        cfg.put("bench.mart.password", ROOT_PASSWORD);
        return cfg;
    }

    /** drop-if-exists + create: внешняя постоянная БД чистится между прогонами. */
    private void recreateDatabase(Db db) {
        db.serverCommand("drop database " + TEST_DB, true);
        db.serverCommand("create database " + TEST_DB, false);
    }

    // ── снимок данных после fresh-подъёма ─────────────────────────────────

    /**
     * Зовётся из {@link LoreTestDbBaselineCapture} в конце StartupEvent приложения:
     * bootstrap, шаги миграций и сидер уже отработали, тесты ещё не начались.
     */
    static void captureBaselineIfPending(String appDb) {
        String pending = System.getProperty(P_PENDING);
        if (pending == null) return;
        Conn conn = new Conn(System.getProperty(P_URL), System.getProperty(P_DB), System.getProperty(P_PW));
        if (!pending.equals(conn.key()) || !conn.db().equals(appDb)) return;
        captureBaseline(new HttpDb(conn), conn.key());
    }

    static void captureBaseline(Db db, String key) {
        try {
            JsonArray records = dumpData(db);
            System.setProperty(P_BASELINE, records.encode());
            System.setProperty(P_READY, key);
            Set<String> types = new HashSet<>();
            for (int i = 0; i < records.size(); i++) types.add(records.getJsonObject(i).getString("type"));
            log("снимок данных после fresh-старта: " + records.size() + " записей в " + types.size()
                + " типах — следующие классы пойдут reuse");
        } catch (RuntimeException e) {
            System.clearProperty(P_READY);
            System.clearProperty(P_BASELINE);
            log("ВНИМАНИЕ: снимок данных после fresh-старта не снят (" + e.getMessage()
                + ") — следующий класс пойдёт fresh");
        } finally {
            System.clearProperty(P_PENDING);
        }
    }

    /** Типы схемы по видам. Неизвестные виды (не vertex/edge/document) не трогаем. */
    record Types(List<String> edges, List<String> vertices, List<String> documents, Set<String> protectedTypes) {}

    static Types readTypes(Db db) {
        List<Map<String, Object>> rows = db.query("SELECT FROM schema:types");
        List<String> edges = new ArrayList<>(), vertices = new ArrayList<>(), documents = new ArrayList<>();
        // Реестр версий и его предки: DELETE FROM полиморфен, удаление из предка
        // унесло бы и ledger.
        Set<String> protectedTypes = new HashSet<>();
        protectedTypes.add(LEDGER_TYPE);
        for (Map<String, Object> r : rows) {
            if (LEDGER_TYPE.equals(String.valueOf(r.get("name"))) && r.get("parentTypes") instanceof List<?> ps) {
                for (Object p : ps) protectedTypes.add(String.valueOf(p));
            }
        }
        for (Map<String, Object> r : rows) {
            String name = String.valueOf(r.get("name"));
            if (protectedTypes.contains(name)) continue;
            String kind = String.valueOf(r.get("type")).toLowerCase(Locale.ROOT);
            switch (kind) {
                case "edge" -> edges.add(name);
                case "vertex" -> vertices.add(name);
                case "document" -> documents.add(name);
                default -> { /* timeseries и пр. — не наши данные, не трогаем */ }
            }
        }
        // Положительный контроль: если разбор вида типа не сработал (поле
        // переименовано в новой версии ArcadeDB), список вершин пуст — и
        // «очистка» молча не чистила бы ничего. Это отказ, а не «данных нет».
        if (!vertices.containsAll(LoreSchemaInitializer.CORE_TYPES)) {
            throw new IllegalStateException("schema:types не дал ядровых вершинных типов "
                + LoreSchemaInitializer.CORE_TYPES + " (вершин распознано: " + vertices.size() + ")");
        }
        return new Types(edges, vertices, documents, protectedTypes);
    }

    /** Все записи всех типов (кроме ledger): вершины/документы, затем рёбра — со своими @rid. */
    static JsonArray dumpData(Db db) {
        Types t = readTypes(db);
        JsonArray out = new JsonArray();
        dumpKind(db, t.vertices(), "vertex", out);
        dumpKind(db, t.documents(), "document", out);
        dumpKind(db, t.edges(), "edge", out);
        return out;
    }

    private static void dumpKind(Db db, List<String> types, String kind, JsonArray out) {
        for (String type : types) {
            for (Map<String, Object> r : db.query("SELECT FROM `" + type + "`")) {
                // SELECT FROM полиморфен: запись дочернего типа берём под её собственным типом.
                if (!type.equals(String.valueOf(r.get("@type")))) continue;
                JsonObject content = new JsonObject();
                for (Map.Entry<String, Object> e : r.entrySet()) {
                    if (!e.getKey().startsWith("@")) content.put(e.getKey(), e.getValue());
                }
                JsonObject rec = new JsonObject().put("type", type).put("kind", kind)
                    .put("rid", String.valueOf(r.get("@rid"))).put("content", content);
                if ("edge".equals(kind)) {
                    rec.put("out", String.valueOf(r.getOrDefault("@out", r.get("out"))))
                       .put("in", String.valueOf(r.getOrDefault("@in", r.get("in"))));
                }
                out.add(rec);
            }
        }
    }

    // ── reuse: очистка данных + возврат снимка ────────────────────────────

    static void resetData(Db db, String baselineJson) {
        if (baselineJson == null) throw new IllegalStateException("снимка данных нет");
        Types t = readTypes(db);
        List<String> deletes = new ArrayList<>();
        // Рёбра раньше вершин: DELETE вершины и так уносит её рёбра, но порядок
        // «рёбра → вершины → документы» не зависит от этой семантики.
        for (String e : t.edges()) deletes.add("DELETE FROM `" + e + "`");
        for (String v : t.vertices()) deletes.add("DELETE FROM `" + v + "`");
        for (String d : t.documents()) deletes.add("DELETE FROM `" + d + "`");
        try {
            db.script(String.join(";\n", deletes) + ";");
        } catch (RuntimeException batch) {
            // Пакет упал целиком — по одному, чтобы назвать виновника.
            for (String sql : deletes) {
                try {
                    db.command(sql);
                } catch (RuntimeException one) {
                    throw new IllegalStateException("очистка '" + sql + "': " + one.getMessage(), one);
                }
            }
        }
        String restore = restoreScript(new JsonArray(baselineJson));
        if (!restore.isEmpty()) {
            try {
                db.script(restore);
            } catch (RuntimeException e) {
                throw new IllegalStateException("восстановление снимка: " + e.getMessage(), e);
            }
        }
    }

    /** sqlscript, кладущий снимок обратно; рёбра — к НОВЫМ @rid своих концов через LET. */
    static String restoreScript(JsonArray records) {
        StringBuilder sb = new StringBuilder();
        Map<String, String> ridVar = new HashMap<>();
        int n = 0;
        for (int i = 0; i < records.size(); i++) {
            JsonObject rec = records.getJsonObject(i);
            String kind = rec.getString("kind");
            if ("edge".equals(kind)) continue;
            String var = "$r" + (n++);
            ridVar.put(rec.getString("rid"), var);
            String verb = "vertex".equals(kind) ? "CREATE VERTEX `" : "INSERT INTO `";
            sb.append("LET ").append(var).append(" = ").append(verb).append(rec.getString("type"))
              .append("` CONTENT ").append(rec.getJsonObject("content").encode()).append(";\n");
        }
        for (int i = 0; i < records.size(); i++) {
            JsonObject rec = records.getJsonObject(i);
            if (!"edge".equals(rec.getString("kind"))) continue;
            String from = ridVar.get(rec.getString("out"));
            String to = ridVar.get(rec.getString("in"));
            if (from == null || to == null) {
                throw new IllegalStateException("ребро " + rec.getString("type") + " " + rec.getString("rid")
                    + " ссылается на вершину вне снимка");
            }
            JsonObject content = rec.getJsonObject("content");
            sb.append("CREATE EDGE `").append(rec.getString("type")).append("` FROM ").append(from)
              .append(" TO ").append(to);
            if (!content.isEmpty()) sb.append(" CONTENT ").append(content.encode());
            sb.append(";\n");
        }
        return sb.toString();
    }

    // ── мелочи ─────────────────────────────────────────────────────────────

    private static String orDefault(String v, String def) {
        return v == null || v.isBlank() ? def : v;
    }

    private static int count(String prop) {
        return Integer.parseInt(System.getProperty(prop, "0"));
    }

    private static int bump(String prop) {
        int v = count(prop) + 1;
        System.setProperty(prop, Integer.toString(v));
        return v;
    }

    /** stdout, а не логгер: строку пробрасывает в лог CI build.gradle (onOutput). */
    static void log(String msg) {
        System.out.println("[LORE TEST DB] " + msg);
    }

    @Override
    public void stop() {
        if (arcade != null) arcade.stop();
    }

    // ── HTTP-реализация ────────────────────────────────────────────────────

    static final class HttpDb implements Db {
        private final Conn c;
        private final HttpClient http = HttpClient.newHttpClient();

        HttpDb(Conn c) { this.c = c; }

        private String auth() {
            return "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + c.password()).getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public void awaitReady() {
            HttpRequest req = HttpRequest.newBuilder(URI.create(c.baseUrl() + "/api/v1/ready"))
                .timeout(Duration.ofSeconds(3)).GET().build();
            long deadline = System.currentTimeMillis() + 30_000;
            Exception last = null;
            while (System.currentTimeMillis() < deadline) {
                try {
                    HttpResponse<Void> resp = http.send(req, HttpResponse.BodyHandlers.discarding());
                    if (resp.statusCode() < 300) return;
                } catch (Exception e) {
                    last = e;
                }
                try { Thread.sleep(500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            }
            throw new IllegalStateException("ArcadeDB test DB never became ready: " + c.baseUrl(), last);
        }

        @Override
        public void serverCommand(String command, boolean ignoreError) {
            try {
                String body = new JsonObject().put("command", command).encode();
                HttpRequest req = HttpRequest.newBuilder(URI.create(c.baseUrl() + "/api/v1/server"))
                    .header("Authorization", auth())
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
                HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() >= 300 && !ignoreError) {
                    throw new IllegalStateException("'" + command + "' failed: " + resp.statusCode() + " " + resp.body());
                }
            } catch (Exception e) {
                if (!ignoreError) throw new RuntimeException("ArcadeDB server command failed: " + command, e);
            }
        }

        private JsonObject post(String language, String text) {
            try {
                String body = new JsonObject().put("language", language).put("command", text).encode();
                HttpRequest req = HttpRequest.newBuilder(URI.create(c.baseUrl() + "/api/v1/command/" + c.db()))
                    .header("Authorization", auth())
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
                HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (resp.statusCode() >= 300) {
                    String b = resp.body();
                    throw new IllegalStateException(language + " → HTTP " + resp.statusCode() + ": "
                        + (b.length() > 500 ? b.substring(0, 500) + "…" : b));
                }
                return new JsonObject(resp.body());
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalStateException(language + " не выполнен: " + e.getMessage(), e);
            }
        }

        @Override
        public List<Map<String, Object>> query(String sql) {
            JsonArray arr = post("sql", sql).getJsonArray("result", new JsonArray());
            List<Map<String, Object>> out = new ArrayList<>();
            for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
            return out;
        }

        @Override
        public void command(String sql) { post("sql", sql); }

        @Override
        public void script(String sqlscript) { post("sqlscript", sqlscript); }
    }
}
