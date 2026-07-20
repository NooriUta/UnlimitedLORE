package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;

/**
 * ADR-LORE-023: раннер миграций схемы. Свой, не ADR-HND-022 (OQ-023-RUNNER):
 * принципы те же (ledger, checksum, порядок), исполнение — под LORE.
 *
 * Ключевое отличие от LoreSchemaInitializer: миграции НЕ глотают ошибки.
 * execIgnoreError на bootstrap-DDL уже дважды прятал реальные баги (см. комменты
 * в инициализаторе) — здесь упавший шаг валит старт с внятным сообщением,
 * потому что «схема наполовину мигрирована» хуже, чем «не стартовали».
 *
 * Режимы (ADR-023 п.4):
 * - fresh (пустая БД, bootstrap только что создал схему) — шаги проигрываются
 *   идемпотентно, ledger ставится; бэкап не нужен — терять нечего.
 * - upgrade (в БД есть данные) — ОБЯЗАТЕЛЬНЫЙ бэкап (SV-04) перед применением
 *   недостающих шагов; бэкап не снялся → миграция не стартует.
 * - db-версия ВПЕРЕДИ кода → отказ старта (старый код на новой схеме).
 * - checksum применённого шага разошёлся с кодом → отказ старта (дрейф истории).
 *
 * Гейт: lore.migrate=true (default false — общий dev-стенд живёт как жил,
 * пока владелец не включит явно; OQ-023-DEVSTAND).
 */
@Startup
@ApplicationScoped
public class LoreSchemaMigrationRunner {

    private static final Logger LOG = Logger.getLogger(LoreSchemaMigrationRunner.class);

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;
    @ConfigProperty(name = "lore.migrate", defaultValue = "false")
    boolean migrate;
    @ConfigProperty(name = "lore.migrate.backup", defaultValue = "true")
    boolean backupRequired;
    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;
    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient client;

    @Inject
    LoreIngestService ingest;

    /** Инъекция гарантирует: bootstrap-DDL инициализатора отработал ДО миграций. */
    @Inject
    LoreSchemaInitializer bootstrapFirst;

    /**
     * Свежеподнятый ArcadeDB первые секунды может отдавать транзиентные 500
     * (гонка готовности — те же 500 ловит LoreComponentSeeder на testcontainers).
     * Миграции обязаны падать громко на НАСТОЯЩИХ ошибках, но не на этой гонке —
     * до 5 попыток с паузой, потом честный отказ.
     */
    private <T> T withRetry(String what, java.util.function.Supplier<T> op) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= 5; attempt++) {
            try { return op.get(); }
            catch (RuntimeException e) {
                last = e;
                String detail = e.getMessage();
                if (e instanceof jakarta.ws.rs.WebApplicationException w) {
                    try { detail = w.getResponse().readEntity(String.class); } catch (Exception ignored) { /* keep msg */ }
                }
                LOG.warnf("[LORE MIGRATE] %s: попытка %d/5 не удалась (%s)", what, attempt, detail);
                try { Thread.sleep(700L * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
            }
        }
        throw new IllegalStateException("[LORE MIGRATE] " + what + " не удалось после 5 попыток", last);
    }

    @PostConstruct
    void run() {
        if (!enabled || !migrate) {
            LOG.info("[LORE MIGRATE] skipped (lore.migrate=false)");
            return;
        }
        // Реальный вызов на прокси → bootstrap-DDL гарантированно отработал (см. javadoc).
        bootstrapFirst.ensureReady();
        withRetry("ledger DDL", () -> {
            exec("CREATE VERTEX TYPE LoreSchemaVersion IF NOT EXISTS");
            exec("CREATE PROPERTY LoreSchemaVersion.version    IF NOT EXISTS INTEGER");
            exec("CREATE PROPERTY LoreSchemaVersion.name       IF NOT EXISTS STRING");
            exec("CREATE PROPERTY LoreSchemaVersion.checksum   IF NOT EXISTS STRING");
            exec("CREATE PROPERTY LoreSchemaVersion.applied_at IF NOT EXISTS STRING");
            // Ось совместимости (ADR-023): major аддитивных шагов не растёт, ломающий — растит.
            exec("CREATE PROPERTY LoreSchemaVersion.compat_major IF NOT EXISTS INTEGER");
            exec("CREATE INDEX IF NOT EXISTS ON LoreSchemaVersion (version) UNIQUE");
            return null;
        });

        Map<Integer, String> applied = new HashMap<>();
        Map<Integer, Integer> appliedCompat = new HashMap<>();
        withRetry("чтение ledger", () -> ingest.queryPublic("SELECT version, checksum, compat_major FROM LoreSchemaVersion", Map.of()))
            .forEach(r -> {
                int v = ((Number) r.get("version")).intValue();
                applied.put(v, String.valueOf(r.get("checksum")));
                // Легаси-строка без compat_major: major = ordinal (историческая семантика).
                Object cm = r.get("compat_major");
                appliedCompat.put(v, cm != null ? ((Number) cm).intValue() : v);
            });

        int dbVersion = applied.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int dbCompatMajor = appliedCompat.values().stream().mapToInt(Integer::intValue).max().orElse(0);
        int codeVersion = LoreSchemaMigrations.codeVersion();
        int codeCompatMajor = LoreSchemaMigrations.codeCompatMajor();
        long dbMinor = appliedCompat.entrySet().stream()
            .filter(e -> e.getValue() == dbCompatMajor && e.getKey() <= dbVersion).count() - 1;
        LOG.infof("[LORE MIGRATE] db=%s: db=%d.%d (ordinal v%d), code=%s (ordinal v%d)",
            db, dbCompatMajor, dbMinor, dbVersion, LoreSchemaMigrations.codeHuman(), codeVersion);

        // Хард-стоп ТОЛЬКО на несовместимости: у БД применён major, которого этот
        // бинарь не знает — реально ломающий шаг. Аддитивный отрыв БД по ordinal в
        // пределах ТОГО ЖЕ major — не отказ, а форвард-совместимость (ADR-LORE-023).
        switch (LoreSchemaMigrations.decide(dbVersion, dbCompatMajor, codeVersion, codeCompatMajor)) {
            case INCOMPATIBLE -> throw new IllegalStateException("[LORE MIGRATE] Отказ старта: major схемы БД ("
                + dbCompatMajor + ") НОВЕЕ кода (" + codeCompatMajor + ") — в БД применён НЕСОВМЕСТИМЫЙ шаг, "
                + "которого нет в коде. Обновите приложение; миграции назад не откатываются (ADR-LORE-023).");
            case FORWARD_COMPAT -> LOG.warnf("[LORE MIGRATE] БД впереди кода по аддитивным шагам (db ordinal v%d > "
                + "code v%d, major %d = %d) — форвард-совместимый режим: новых структур этот бинарь не использует, "
                + "но и работать не мешает. Обновите приложение при случае.", dbVersion, codeVersion, dbCompatMajor, codeCompatMajor);
            case UP_TO_DATE, RUN_PENDING -> { /* обычный путь: checksum-verify + недостающие шаги ниже */ }
        }

        // Checksum-verify применённой истории (дрейф выпущенного шага = отказ).
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            String was = applied.get(s.version());
            if (was != null && !was.equals(s.checksum())) {
                throw new IllegalStateException("[LORE MIGRATE] Отказ старта: шаг V" + s.version()
                    + " (" + s.name() + ") изменён после применения (checksum " + was + " → " + s.checksum()
                    + "). Выпущенные шаги неизменяемы — оформите правку новым шагом.");
            }
        }

        List<LoreSchemaMigrations.Step> pending = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> !applied.containsKey(s.version())).toList();
        if (pending.isEmpty()) {
            LOG.info("[LORE MIGRATE] схема актуальна, шагов нет");
            return;
        }

        // fresh vs upgrade: есть ли в БД данные, которые можно потерять.
        boolean hasData = !withRetry("проверка данных",
            () -> ingest.queryPublic("SELECT @rid FROM KnowADR LIMIT 1", Map.of())).isEmpty();
        if (hasData && backupRequired) backupOrDie();
        else LOG.infof("[LORE MIGRATE] бэкап пропущен (%s)", hasData ? "lore.migrate.backup=false" : "fresh БД, терять нечего");

        for (LoreSchemaMigrations.Step s : pending) {
            LOG.infof("[LORE MIGRATE] применяю %s (V%d__%s, %d стейтментов)", s.human(), s.version(), s.name(), s.sql().size());
            for (String sql : s.sql()) {
                try {
                    withRetry("V" + s.version(), () -> { exec(sql); return null; });
                } catch (Exception e) {
                    // Громко и с контекстом: какой шаг, какой стейтмент.
                    throw new IllegalStateException("[LORE MIGRATE] V" + s.version() + "__" + s.name()
                        + " упал на «" + sql + "»: " + e.getMessage()
                        + (hasData ? " — бэкап снят, восстановление: RESTORE DATABASE (RUNBOOK-LORE-SCHEMA-UPGRADE)." : ""), e);
                }
            }
            javaStep(s.version());
            Map<String, Object> p = Map.of("v", s.version(), "cm", s.compatMajor(), "n", s.name(),
                "c", s.checksum(), "t", Instant.now().toString());
            command("INSERT INTO LoreSchemaVersion SET version=:v, compat_major=:cm, name=:n, checksum=:c, applied_at=:t", p);
        }
        LOG.infof("[LORE MIGRATE] готово: схема на версии %s (ordinal v%d)", LoreSchemaMigrations.codeHuman(), codeVersion);
    }

    /** Java-шаги (то, что SQL не умеет). Нумерация совпадает с реестром. */
    private void javaStep(int version) {
        if (version == 4 || version == 5) backfillContentHash(version);
        if (version == 11 || version == 12) createFullTextIndexes();
    }

    /**
     * SRCH-03: именованные мультиполевые FULL_TEXT-индексы.
     *
     * Почему Java, а не список SQL в шаге. Замерено на ArcadeDB 26.7.2:
     * `CREATE INDEX IF NOT EXISTS `имя` …` — синтаксическая ошибка (грамматика
     * ждёт ON сразу после IF NOT EXISTS), а `DROP INDEX IF EXISTS` не
     * поддерживается вовсе. То есть для ИМЕНОВАННОГО индекса нет ни
     * «создай, если нет», ни «удали, если есть», и чисто-SQL шаг падал бы на
     * любом повторе с «already exists». Поэтому существование проверяем сами.
     *
     * Старые однополевые индексы НЕ трогаем: действующий слайс `search` ходит
     * через SEARCH_FIELDS, который на них и опирается. Снимать их можно только
     * после перевода слайса на SEARCH_INDEX, иначе поиск сломается в момент
     * миграции.
     */
    private void createFullTextIndexes() {
        // Какие типы вообще есть: на свежей БД часть может отсутствовать, и это
        // единственная причина, по которой пропуск индекса допустим.
        Set<String> types = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic("SELECT name FROM schema:types", Map.of())) {
            types.add(String.valueOf(r.get("name")));
        }

        Set<String> byName = new HashSet<>();
        Map<String, String> byFields = new HashMap<>();   // "Тип[поле,поле]" → имя индекса
        Map<String, String> nameToKey = new HashMap<>();  // имя индекса → его набор полей
        for (Map<String, Object> r : ingest.queryPublic("SELECT name, typeName, properties FROM schema:indexes", Map.of())) {
            String n = String.valueOf(r.get("name"));
            String key = fieldKey(String.valueOf(r.get("typeName")), r.get("properties"));
            byName.add(n);
            byFields.put(key, n);
            nameToKey.put(n, key);
        }

        int created = 0, skipped = 0, replaced = 0, absent = 0;
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) {
            String want = fieldKey(ix.type(), ix.fields());
            if (byName.contains(ix.name())) {
                // Имя занято, но набор полей мог измениться между версиями кода
                // (напр. в ftKnowDoc добавились content_md_en/ru). Пропустить по
                // имени значило бы тихо оставить старый охват — тот же класс
                // молчаливой полуправды, что уже ловили в V11.
                if (want.equals(nameToKey.get(ix.name()))) { skipped++; continue; }
                LOG.infof("[LORE MIGRATE] %s: набор полей изменился (%s → %s) — пересоздаю",
                    ix.name(), nameToKey.get(ix.name()), want);
                exec("DROP INDEX `" + ix.name() + "`");
                byFields.remove(nameToKey.get(ix.name()));
            }
            if (!types.contains(ix.type())) {
                LOG.warnf("[LORE MIGRATE] тип %s отсутствует — индекс %s пропущен", ix.type(), ix.name());
                absent++;
                continue;
            }
            // ArcadeDB 26.7.2 запрещает ВТОРОЙ индекс на том же наборе полей:
            // «Found the existent index 'KnowTaskHist[note_md]' defined on the
            // properties '[[note_md]]'». Там, где набор совпал с уже имеющимся
            // (однополевые Hist-тела), старый снимаем ОСОЗНАННО: его роль
            // полностью перекрывает именованный, а без имени он бесполезен для
            // SEARCH_INDEX. SEARCH_FIELDS резолвит индекс по полям и продолжает
            // находить новый — старый путь не ломается.
            // Свойства объявляем САМИ, а не полагаемся на то, что они уже есть.
            // На проде часть полей существовала исторически, поэтому V11 там
            // прошёл; на ЧИСТОЙ базе (lore_ci_test пересоздаётся на каждый
            // прогон CI) их нет, и ArcadeDB отказывает:
            //   Cannot create the index on type 'KnowSprint.context_md'
            //   because the property does not exist
            // Делать это SQL-строкой в самом шаге нельзя: checksum V11/V12 уже
            // записан в ledger прода, изменение SQL уронило бы старт по дрейф-
            // гарду. Java-часть в checksum не входит — правка безопасна и делает
            // шаг самодостаточным на любой базе.
            for (String f : ix.fields()) {
                exec("CREATE PROPERTY " + ix.type() + "." + f + " IF NOT EXISTS STRING");
            }

            String clash = byFields.get(want);
            if (clash != null) {
                LOG.infof("[LORE MIGRATE] снимаю %s — тот же набор полей, что у %s", clash, ix.name());
                exec("DROP INDEX `" + clash + "`");
                replaced++;
            }
            // БЕЗ catch: если создание упало по любой другой причине — валим
            // миграцию. Шаг, записанный в ledger как применённый при не созданных
            // индексах, — это молчаливая полуправда: поиск идёт сканом, а версия
            // схемы утверждает, что всё на месте. Ровно этот случай уже произошёл.
            exec(ix.createSql());
            created++;
        }
        LOG.infof("[LORE MIGRATE] полнотекст: создано %d (взамен старых %d), уже было %d, типов нет %d — реестр %d",
            created, replaced, skipped, absent, LoreSchemaMigrations.FT_INDEXES.size());

        // ── Ретайр легаси-FT (SRCH-01, ADR-LORE-033 D10) ─────────────────────
        // Реестр — ЕДИНСТВЕННЫЙ источник FULL_TEXT-индексов: «у типа ровно один».
        // Исторические однополевые (из шагов 2/3 и авто-именованные Тип_0_…)
        // держались, пока слайс искал через SEARCH_FIELDS — он резолвит индекс
        // по полям. После перевода слайса на SEARCH_INDEX('ftИмя', …) безымянные
        // не читаются НИКЕМ, а каждое проиндексированное поле оплачивается на
        // каждой записи дважды (на проде их скопилось 88). Снимаем всё
        // FULL_TEXT, чего нет в реестре.
        //
        // Именно здесь, а не новым шагом миграции: чистка идемпотентна, а шаги
        // 2/3 трогать нельзя — их checksum уже в ledger, правка уронила бы старт
        // по дрейф-гарду. Не-FULL_TEXT индексы (уникальные ключи и т.п.) не
        // затрагиваются по построению — фильтр по indexType.
        // schema:indexes отдаёт ДВА сорта строк одного и того же индекса:
        // логическое имя (`ftKnowTask` или легаси `KnowTask[title]`) и его
        // бакетные части (`KnowTask_0_<ts>`). Бакетные строки НЕ трогаем ВООБЩЕ:
        // они принадлежат либо именованному индексу (снести бакет = каскадно
        // уничтожить сам ftKnow* — ровно так первый вариант этой чистки оставил
        // тест-БД без единого FT-индекса), либо легаси-логическому, который
        // уходит вместе со своим bracket-именем. Поэтому критерий легаси —
        // только логическая bracket-форма `Тип[поле]`, не из реестра.
        Set<String> declared = new HashSet<>();
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) declared.add(ix.name());
        int retired = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT name FROM schema:indexes WHERE indexType = 'FULL_TEXT'", Map.of())) {
            String n = String.valueOf(r.get("name"));
            if (declared.contains(n) || !n.contains("[")) continue;
            // «Index not found» — не ошибка: снятие соседней bracket-формы могло
            // уже унести эту каскадом, цель «индекса нет» достигнута. Любая
            // ДРУГАЯ ошибка валит миграцию (урок V11: шаг в ledger при
            // несделанной работе хуже падения).
            try {
                exec("DROP INDEX `" + n + "`");
                retired++;
            } catch (RuntimeException e) {
                String msg = String.valueOf(e.getMessage());
                if (!msg.contains("Index not found")) throw e;
            }
        }
        if (retired > 0) {
            LOG.infof("[LORE MIGRATE] полнотекст: снято %d легаси-индексов вне реестра", retired);
        }

        int expected = LoreSchemaMigrations.FT_INDEXES.size() - absent;
        if (created + skipped < expected) {
            throw new IllegalStateException("[LORE MIGRATE] полнотекст: создано " + created + " + уже было " + skipped
                + ", ожидалось " + expected + " — часть индексов отсутствует, поиск пошёл бы сканом при «успешной» миграции.");
        }
    }

    /** Ключ «тип + набор полей» — ArcadeDB не разрешает два индекса на одном наборе. */
    @SuppressWarnings("unchecked")
    private static String fieldKey(String type, Object props) {
        List<String> flat = new java.util.ArrayList<>();
        if (props instanceof List<?> l) {
            for (Object o : l) {
                if (o instanceof List<?> inner) inner.forEach(x -> flat.add(String.valueOf(x)));
                else flat.add(String.valueOf(o));
            }
        }
        return type + "[" + String.join(",", flat) + "]";
    }

    // SV-10 backfill: content_hash по существующим Hist-строкам, батчами ДО
    // исчерпания (V4 первой редакции остановился на LIMIT 5000 — отсюда V5).
    // Реестр «тип → поля» общий с LoreHashStamper — представления не разъезжаются.
    private void backfillContentHash(int version) {
        for (Map.Entry<String, String[]> h : LoreHashStamper.HIST_BODIES.entrySet()) {
            int total = 0;
            while (true) {
                List<Map<String, Object>> rows = ingest.queryPublic(
                    "SELECT @rid AS rid, " + String.join(", ", h.getValue())
                    + " FROM " + h.getKey() + " WHERE content_hash IS NULL LIMIT 5000", Map.of());
                if (rows.isEmpty()) break;
                for (Map<String, Object> r : rows) {
                    String[] parts = new String[h.getValue().length];
                    for (int i = 0; i < parts.length; i++) {
                        Object v = r.get(h.getValue()[i]);
                        parts[i] = v == null ? null : String.valueOf(v);
                    }
                    command("UPDATE " + r.get("rid") + " SET content_hash=:ch",
                        Map.of("ch", LoreContentHash.of(parts)));
                    total++;
                }
                if (rows.size() < 5000) break;
            }
            LOG.infof("[LORE MIGRATE] V%d backfill %s: %d строк", version, h.getKey(), total);
        }
    }

    /** SV-04: без снятого бэкапа upgrade не стартует. */
    private void backupOrDie() {
        try {
            command("BACKUP DATABASE", Map.of());
            LOG.infof("[LORE MIGRATE] бэкап %s снят (server backups dir)", db);
        } catch (Exception e) {
            throw new IllegalStateException("[LORE MIGRATE] Отказ: бэкап перед upgrade не снялся ("
                + e.getMessage() + "). Без бэкапа миграция не выполняется (ADR-LORE-023 п.3). "
                + "Обход (осознанный риск): lore.migrate.backup=false.", e);
        }
    }

    private void exec(String sql) { command(sql, Map.of()); }

    private void command(String sql, Map<String, Object> params) {
        try {
            client.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql,
                    params.isEmpty() ? null : params))
                  .await().indefinitely();
        } catch (jakarta.ws.rs.WebApplicationException e) {
            // Тело ответа ArcadeDB — единственное место с настоящей причиной 500.
            String detail;
            try { detail = e.getResponse().readEntity(String.class); }
            catch (Exception ignored) { detail = e.getMessage(); }
            throw new IllegalStateException("SQL «" + sql + "» → " + detail, e);
        }
    }

    private String basicAuth() {
        return mart.basicAuth();
    }
}
