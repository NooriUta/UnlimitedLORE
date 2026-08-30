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
import java.util.ArrayList;
import java.util.LinkedHashMap;

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
    /**
     * DBR-06: сверка версии схемы — ОТДЕЛЬНО от права её менять.
     *
     * <p>До этого гарды (несовместимый major и дрейф checksum) лежали под тем
     * же {@code lore.migrate}, что и сама накатка. Выключение флага, ради
     * которого вся задача — чтобы рантайм ходил токеном без {@code updateSchema} —
     * заодно снимало и проверки: приложение молча стартовало на любой схеме,
     * включая несовместимую. Это хуже отказа: работающий сервис на чужой схеме
     * пишет данные не туда, и обнаруживается это не при старте, а по кривым
     * выдачам.
     *
     * <p>По умолчанию ВКЛЮЧЕНА: сверка ничего не меняет в БД, только читает
     * ledger, и выключать её осмысленно лишь там, где живой БД нет вовсе.
     */
    @ConfigProperty(name = "lore.schema.verify", defaultValue = "true")
    boolean verifySchema;
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
                String detail = LoreUpstream.detail(e);
                LOG.warnf("[LORE MIGRATE] %s: попытка %d/5 не удалась (%s)", what, attempt, detail);
                try { Thread.sleep(700L * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
            }
        }
        throw new IllegalStateException("[LORE MIGRATE] " + what + " не удалось после 5 попыток", last);
    }

    /**
     * Явная точка синхронизации для LoreComponentSeeder (MIG-31): тот же приём,
     * что LoreSchemaInitializer.ensureReady() — вызов на ленивом CDI-прокси
     * гарантирует, что @PostConstruct раннера (весь DDL-шторм миграций) завершён
     * ДО первого UPSERT'а сидера. Без этого на свежей БД конкурентные UPSERT'ы
     * ловили 500 «Error on transaction commit», и корпус жил без компонентов.
     */
    public void ensureReady() { /* всё делает @PostConstruct при создании бина */ }

    /**
     * DBR-06: сверить версию схемы в БД с той, которую ждёт этот бинарь, и
     * упасть при рассинхроне. Ничего не пишет — только читает ledger.
     *
     * <p>Правила отказа те же, что у полного пути, и это не случайность: при
     * выключенной накатке «догнать» схему приложение не может, значит любое
     * расхождение, кроме форвард-совместимого, — повод не стартовать.
     *
     * <ul>
     *   <li>major БД новее кода — {@code INCOMPATIBLE}, отказ (как и раньше);
     *   <li>есть неприменённые шаги — отказ: раньше их накатил бы сам старт,
     *       теперь накатывать некому, и работа на старой схеме означала бы
     *       запись не в те структуры;
     *   <li>дрейф checksum применённого шага — отказ;
     *   <li>БД впереди по аддитивным шагам того же major — предупреждение,
     *       старт разрешён (форвард-совместимость, ADR-LORE-023).
     * </ul>
     *
     * <p>Отсутствие типа {@code LoreSchemaVersion} — не ошибка чтения, а
     * «схема не накатывалась ни разу». Отличать обязательно: иначе пустая БД
     * выглядела бы как отказ связи, а отказ связи — как пустая БД.
     */
    /** package-private ради теста: гейт проверяется вызовом, а не через профиль. */
    void verifySchemaOrFail() {
        Map<Integer, String> applied = new HashMap<>();
        Map<Integer, Integer> appliedCompat = new HashMap<>();
        readLedgerTolerantly(applied, appliedCompat);

        int dbVersion = applied.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int dbCompatMajor = appliedCompat.values().stream().mapToInt(Integer::intValue).max().orElse(0);
        int codeVersion = LoreSchemaMigrations.codeVersion();
        int codeCompatMajor = LoreSchemaMigrations.codeCompatMajor();

        if (dbVersion == 0) {
            throw new IllegalStateException("[LORE MIGRATE] Отказ старта: схема НЕ накатана "
                + "(в " + db + " нет ни одной строки LoreSchemaVersion), а накатка выключена "
                + "(lore.migrate=false). Накатите схему отдельным запуском с lore.migrate=true.");
        }

        switch (LoreSchemaMigrations.decide(dbVersion, dbCompatMajor, codeVersion, codeCompatMajor)) {
            case INCOMPATIBLE -> throw new IllegalStateException("[LORE MIGRATE] Отказ старта: major схемы БД ("
                + dbCompatMajor + ") НОВЕЕ кода (" + codeCompatMajor + ") — в БД применён НЕСОВМЕСТИМЫЙ шаг, "
                + "которого нет в коде. Обновите приложение; миграции назад не откатываются (ADR-LORE-023).");
            case FORWARD_COMPAT -> LOG.warnf("[LORE MIGRATE] БД впереди кода по аддитивным шагам "
                + "(db v%d > code v%d, major %d) — форвард-совместимый режим", dbVersion, codeVersion, dbCompatMajor);
            case UP_TO_DATE, RUN_PENDING -> { /* дальше — checksum и список недостающих */ }
        }

        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            String was = applied.get(s.version());
            if (was != null && !was.equals(s.checksum())) {
                throw new IllegalStateException("[LORE MIGRATE] Отказ старта: шаг V" + s.version()
                    + " (" + s.name() + ") изменён после применения (checksum " + was + " → " + s.checksum()
                    + "). Выпущенные шаги неизменяемы — оформите правку новым шагом.");
            }
        }

        List<Integer> pending = LoreSchemaMigrations.STEPS.stream()
            .map(LoreSchemaMigrations.Step::version)
            .filter(v -> !applied.containsKey(v))
            .toList();
        if (!pending.isEmpty()) {
            throw new IllegalStateException("[LORE MIGRATE] Отказ старта: схема БД v" + dbVersion
                + ", приложение ждёт v" + codeVersion + "; не накатаны шаги " + pending
                + ". Накатка выключена (lore.migrate=false) — накатите их отдельным запуском, "
                + "иначе приложение писало бы в структуры, которых нет.");
        }
        // Материальная сверка (SELF-PROVISION-VERIFY-GAP): ledger заявляет
        // актуальную версию — но пишется он отдельным INSERT ПОСЛЕ шага, не
        // атомарно. Шаг, чья часть сделала no-op/прервалась, оставляет «версия
        // есть, типов нет» — и приложение молча отдаёт 500 по продуктовым
        // слайсам. Читаем схему (не мутируем) и падаем ГРОМКО, если чего-то нет.
        List<String> missing = LoreSchemaMigrations.REQUIRED_LIVE_TYPES.stream()
            .filter(t -> !typeExists(t))
            .toList();
        if (!missing.isEmpty()) {
            throw new IllegalStateException("[LORE MIGRATE] Отказ старта: ledger заявляет схему v"
                + dbVersion + " (актуальна), но в " + db + " ФИЗИЧЕСКИ НЕТ типов " + missing
                + " — ledger разошёлся с реальной схемой (шаг записан, DDL не материализовался). "
                + "Приложение бы стартовало и отдавало 500 по продуктовым слайсам. "
                + "Накатите схему заново с lore.migrate=true (шаги идемпотентны, снимается BACKUP).");
        }
        LOG.infof("[LORE MIGRATE] схема сверена: БД v%d = код v%d, продуктовые типы на месте, накатка не требуется", dbVersion, codeVersion);
    }

    /**
     * Чтение ledger, терпимое к его отсутствию.
     *
     * <p>На БД, где схему ещё не накатывали, типа {@code LoreSchemaVersion}
     * просто нет, и запрос к нему — законная ошибка, а не сбой. Отличаем по
     * тексту ответа: сообщать «БД недоступна» там, где она доступна и пуста,
     * значит отправить читающего чинить не то.
     */
    private void readLedgerTolerantly(Map<Integer, String> applied, Map<Integer, Integer> appliedCompat) {
        List<Map<String, Object>> rows;
        try {
            rows = ingest.queryPublic("SELECT version, checksum, compat_major FROM LoreSchemaVersion", Map.of());
        } catch (RuntimeException e) {
            String detail = LoreUpstream.detail(e);
            String d = String.valueOf(detail);
            boolean noSuchType = d.contains("LoreSchemaVersion")
                && (d.contains("not found") || d.contains("does not exist") || d.contains("was not found"));
            if (noSuchType) return;   // схему не накатывали — dbVersion останется 0
            throw new IllegalStateException("[LORE MIGRATE] не удалось прочитать ledger схемы: " + d, e);
        }
        for (Map<String, Object> r : rows) {
            int v = ((Number) r.get("version")).intValue();
            applied.put(v, String.valueOf(r.get("checksum")));
            Object cm = r.get("compat_major");
            appliedCompat.put(v, cm != null ? ((Number) cm).intValue() : v);
        }
    }

    @PostConstruct
    void run() {
        if (!enabled) {
            LOG.info("[LORE MIGRATE] skipped (lore.enabled=false)");
            return;
        }
        if (!migrate) {
            // DBR-06: накатки нет, но и молча стартовать на неизвестной схеме
            // нельзя. Сверяем версию и падаем при рассинхроне — единственная
            // альтернатива этому «работать на старой схеме и не сказать».
            LOG.info("[LORE MIGRATE] накатка выключена (lore.migrate=false)");
            if (verifySchema) verifySchemaOrFail();
            else LOG.warn("[LORE MIGRATE] сверка версии схемы ТОЖЕ выключена "
                + "(lore.schema.verify=false) — приложение стартует на любой схеме");
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
            retireLegacyFullTextIndexes();
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
            try {
                javaStep(s.version());
            } catch (RuntimeException e) {
                // SQL-часть шага падает с контекстом (шаг + стейтмент), а
                // java-часть падала голым стеком: в присланном логе было видно
                // createFullTextIndexes и «Index 1 out of bounds», но НЕ было
                // видно ни версии БД, ни того, сколько шагов ещё впереди, ни
                // какие индексы уже стоят. По такому логу причину не отличить
                // от следствия, что и произошло.
                dumpSchemaDiagnostics("V" + s.version() + "__" + s.name(), dbVersion, codeVersion, pending);
                throw e;
            }
            Map<String, Object> p = Map.of("v", s.version(), "cm", s.compatMajor(), "n", s.name(),
                "c", s.checksum(), "t", Instant.now().toString());
            command("INSERT INTO LoreSchemaVersion SET version=:v, compat_major=:cm, name=:n, checksum=:c, applied_at=:t", p);
        }
        LOG.infof("[LORE MIGRATE] готово: схема на версии %s (ordinal v%d)", LoreSchemaMigrations.codeHuman(), codeVersion);
        retireLegacyFullTextIndexes();
    }

    /**
     * Паспорт состояния схемы на момент падения миграции. Пишется ОДНИМ блоком,
     * чтобы его можно было целиком приложить к обращению, не собирая по стеку.
     *
     * Каждый запрос обёрнут отдельно и молчит про свою ошибку в одну строку:
     * это путь аварийного разбора, и он не имеет права заслонить собой
     * исходное исключение. Недоступный кусок диагностики — это «неизвестно»,
     * а не новая ошибка поверх старой.
     */
    private void dumpSchemaDiagnostics(String step, long dbVersion, int codeVersion,
                                       List<LoreSchemaMigrations.Step> pending) {
        StringBuilder sb = new StringBuilder("\n[LORE MIGRATE] ── состояние схемы на момент падения ──\n");
        sb.append("  упавший шаг:      ").append(step).append('\n');
        sb.append("  версия БД:        ordinal v").append(dbVersion).append('\n');
        sb.append("  версия кода:      ").append(LoreSchemaMigrations.codeHuman())
          .append(" (ordinal v").append(codeVersion).append(")\n");
        sb.append("  шагов в очереди:  ").append(pending.size()).append(' ')
          .append(pending.stream().map(p -> "V" + p.version()).toList()).append('\n');

        try {
            sb.append("  типов в схеме:    ")
              .append(ingest.queryPublic("SELECT name FROM schema:types", Map.of()).size()).append('\n');
        } catch (Exception q) {
            sb.append("  типов в схеме:    неизвестно (").append(q.getMessage()).append(")\n");
        }

        try {
            Set<String> have = new HashSet<>();
            for (Map<String, Object> r : ingest.queryPublic("SELECT name FROM schema:indexes", Map.of())) {
                have.add(String.valueOf(r.get("name")));
            }
            List<String> missing = LoreSchemaMigrations.FT_INDEXES.stream()
                .map(LoreSchemaMigrations.FtIndex::name).filter(n -> !have.contains(n)).toList();
            sb.append("  индексов всего:   ").append(have.size()).append('\n');
            sb.append("  FT из реестра:    есть ")
              .append(LoreSchemaMigrations.FT_INDEXES.size() - missing.size())
              .append(" из ").append(LoreSchemaMigrations.FT_INDEXES.size()).append('\n');
            sb.append("  FT отсутствуют:   ").append(missing.isEmpty() ? "нет таких" : missing).append('\n');
        } catch (Exception q) {
            sb.append("  индексы:          неизвестно (").append(q.getMessage()).append(")\n");
        }

        sb.append("  что делать:       миграция идемпотентна — устранив причину, перезапустите старт; ")
          .append("шаг в ledger не записан, повтор пойдёт с него же (RUNBOOK-LORE-SCHEMA-UPGRADE).");
        LOG.error(sb.toString());
    }

    /** Java-шаги (то, что SQL не умеет). Нумерация совпадает с реестром. */
    private void javaStep(int version) {
        if (version == 4 || version == 5) backfillContentHash(version);
        if (version == 11 || version == 12) createFullTextIndexes();
        // V13 меняет набор полей ftKnowUseCase (в него влились body_md/context_md
        // бывшей фичи). Пересоздание живёт в createFullTextIndexes, но зовётся
        // оно только из javaStep — а шаги 11/12 на проде давно применены и
        // повторно не пойдут. Без этого вызова прод остался бы со СТАРЫМ
        // охватом индекса: поиск по контексту корня молча перестал бы находить.
        // Ровно тот сценарий, на котором уже обожглись с ретайром легаси-индексов.
        if (version == 13) { mergeFeaturesIntoUseCases(); createFullTextIndexes(); }
        if (version == 17) mergeLoreTagIntoKnowTag();
        if (version == 20) backfillProjectEdges();
        if (version == 26) backfillReleaseProjectEdges();
        // Тот же капкан, что описан выше для V13, и он сработал: шаг 30 заводит
        // НОВЫЙ тип KnowProjectActor, а createFullTextIndexes зовётся только из
        // шагов 11/12/13 — давно применённых и на проде, и на свежей базе к
        // моменту, когда тип появляется. Без этого вызова ftKnowProjectActor не
        // создался бы НИГДЕ: на свежей БД индексный шаг проходит раньше типа
        // («тип отсутствует — индекс пропущен» в логе), на проде — вообще не
        // повторяется. Поиск по акторам молча перестал бы их находить, и
        // выглядело бы это как «таких акторов нет».
        //
        // Порядок внутри шага существенный: SQL шага 30 создаёт тип ДО javaStep,
        // поэтому к моменту вызова индексировать уже есть что.
        if (version == 30) { splitProjectActors(); createFullTextIndexes(); }
        // AC-04: повторный развод. Шаг 30 оставил ноль, но форма в UI ещё писала
        // в реестр личностей — см. комментарий к шагу 32. Идемпотентен.
        if (version == 32) splitProjectActors();
        // 31 — семь типов, 33 — те же плюс два QG-типа (NM-07). Добор
        // идемпотентен, повторный проход по уже обработанным безвреден.
        if (version == 31 || version == 33) backfillComponentEdges();
        if (version == 28) recreateFtIndexes();
    }

    // DBU-09/DBR-12 (#5321): пересоздать FULL_TEXT-индексы свежими после апгрейда
    // на 26.8.1. НЕ REBUILD (он на 26.8.1 теряет имя индекса — DBR-12), а DROP по
    // имени из реестра + createFullTextIndexes (пересоздаёт свежими → корректный
    // порядок ключей для кириллицы; клэши по полям чистит сам). Идемпотентно:
    // повторный прогон снова снесёт и создаст, результат тот же.
    private void recreateFtIndexes() {
        Set<String> existing = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic("SELECT name FROM schema:indexes", Map.of())) {
            existing.add(String.valueOf(r.get("name")));
        }
        int dropped = 0;
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) {
            if (existing.contains(ix.name())) {
                try { exec("DROP INDEX `" + ix.name() + "`"); dropped++; }
                catch (Exception e) { LOG.warnf("[LORE MIGRATE] V28 DROP %s: %s", ix.name(), e.getMessage()); }
            }
        }
        LOG.infof("[LORE MIGRATE] V28 (#5321): снято %d FT-индексов, пересоздаю свежими", dropped);
        createFullTextIndexes();
    }

    // PS-20: добор рёбер BELONGS_TO_PROJECT у релизов, оставшихся без ребра после
    // V20 (создано/перенесено позже). Та же идемпотентная логика size()=0, что во
    // 2-й категории backfillProjectEdges: ребро выравнивается по полю git_project,
    // матч источника по @rid (release_id не уникален между проектами). Существующие
    // рёбра не трогаем — write-path (relinkReleaseProjectEdge) держит их в синхроне.
    private void backfillReleaseProjectEdges() {
        int relEdges = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT @rid AS rid, git_project FROM KnowRelease "
                + "WHERE out('BELONGS_TO_PROJECT').size() = 0 AND git_project IS NOT NULL", Map.of())) {
            command("CREATE EDGE BELONGS_TO_PROJECT FROM " + r.get("rid")
                + " TO (SELECT FROM KnowGitProject WHERE slug = :p) IF NOT EXISTS",
                Map.of("p", r.get("git_project")));
            relEdges++;
        }
        LOG.infof("[LORE MIGRATE] V26 backfill Release→project (хвост после V20): %d рёбер", relEdges);
    }

    /**
     * V30 (решение владельца 30.08.2026): проектируемая роль уезжает из
     * {@code KnowActor} в {@code KnowProjectActor}. RBAC не трогается вовсе —
     * это прямое требование: «MCP, RBAC остаётся на старой ноде, весь
     * бизнес-анализ переезжает на новую».
     *
     * <h3>Что считается личностью, а что описанием</h3>
     *
     * Личность — актор, у которого есть {@code client_id} ЛИБО ребро
     * {@code OWNED_BY}. Проверяются оба признака, а не один: клиент могли ещё не
     * прописать, а владельца уже назначить, и наоборот. Ошибка в эту сторону
     * дороже — уехавшая личность разорвала бы цепочку прав.
     *
     * Всё остальное — описание, и уезжает целиком со своими рёбрами.
     *
     * <h3>Почему Java, а не SQL шага</h3>
     *
     * У ребра в ArcadeDB неизменяемые концы: перецепить нельзя, только создать
     * новое и удалить старое по {@code @rid}. Плюс {@code DELETE EDGE} в этой
     * сборке отсутствует — работает лишь {@code DELETE FROM <Тип> WHERE @rid=…}.
     * Тот же приём, что в V13.
     *
     * <h3>Идемпотентность</h3>
     *
     * Ledger пишется ПОСЛЕ javaStep, поэтому падение между ними оставляет шаг
     * pending и повтор обязан пройти чисто: вершина создаётся только если её
     * ещё нет, рёбра переносятся с {@code IF NOT EXISTS}, старое удаляется сразу
     * после создания нового.
     */
    /**
     * Словарь вида роли в ПРОЕКТИРУЕМОМ реестре: {@code agent} становится
     * {@code automation} (решение владельца 30.08.2026, «переименуй
     * automation (agent scheme)»).
     *
     * <p>Причина не косметическая. После развода слово {@code agent} жило бы в
     * ДВУХ реестрах сразу: в {@link KnowActor} — как учётная запись с
     * {@code client_id}, владельцем и журналом сессий, а здесь — как роль агента
     * в сценарии («Агент сессии», 14 сценариев). Формально их различает тип
     * вершины; человека — нет. Ровно тот же вид ловушки, что {@code architect}
     * как роль в проекте против {@code architect} как профиля агента, и что
     * {@code SKIP}, читавшийся и «в порядке», и «не измерено».
     *
     * <p>Переименование делается ЗДЕСЬ, потому что миграция и так переписывает
     * эти строки. Отдельно потом — это отдельная миграция и отдельный деплой
     * ради одного слова.
     */
    static String projectActorKind(String kind) {
        return "agent".equals(kind) ? "automation" : kind;
    }

    private void splitProjectActors() {
        if (!typeExists("KnowActor")) {
            LOG.info("[LORE MIGRATE] V30: типа KnowActor нет — свежая БД, переносить нечего");
            return;
        }

        // Рёбра ОПИСАТЕЛЬНОЙ стороны. OWNED_BY и LOGGED_BY здесь отсутствуют
        // НАМЕРЕННО: первое — цепочка прав, второе — журнал сессий, обе остаются
        // на личности. Если такое ребро окажется у описательной вершины, это
        // значит, что признак личности определён неверно, и шаг обязан упасть,
        // а не тихо оставить ребро висеть на удалённой вершине.
        final List<String> inEdges  = List.of("HAS_ACTOR", "PERFORMED_BY", "DESIRED_BY", "FELT_BY");
        final List<String> outEdges = List.of("BELONGS_TO_PROJECT", "TAGGED_WITH", "ATTACHED_TO");

        List<Map<String, Object>> design = ingest.queryPublic(
            "SELECT @rid AS rid, actor_id, name, kind, body_md FROM KnowActor "
            + "WHERE (client_id IS NULL OR client_id = '') AND out('OWNED_BY').size() = 0", Map.of());

        int moved = 0, movedEdges = 0;
        for (Map<String, Object> a : design) {
            String actorId = str(a.get("actor_id"));
            if (actorId == null || actorId.isBlank()) {
                // Вершина без идентификатора: переносить не за что зацепиться при
                // повторе. Валим громко — молчаливый пропуск потерял бы описание.
                throw new IllegalStateException("[LORE MIGRATE] V30: KnowActor " + a.get("rid")
                    + " без actor_id — перенос невозможен, проставьте идентификатор и повторите старт.");
            }
            // Журнал сессий на описательной вершине означал бы, что она всё-таки
            // личность, а признак определён неверно. Лучше остановиться.
            List<Map<String, Object>> logged = ingest.queryPublic(
                "SELECT @rid FROM LOGGED_BY WHERE @in = " + a.get("rid") + " LIMIT 1", Map.of());
            if (!logged.isEmpty()) {
                throw new IllegalStateException("[LORE MIGRATE] V30: у актора " + actorId
                    + " нет client_id и владельца, но есть записи сессий (LOGGED_BY) — "
                    + "это личность с неполными полями, а не проектируемая роль. Перенос прерван.");
            }

            boolean already = !ingest.queryPublic(
                "SELECT @rid FROM KnowProjectActor WHERE actor_id = :id", Map.of("id", actorId)).isEmpty();
            if (!already) {
                Map<String, Object> p = new HashMap<>();
                p.put("id", actorId);
                p.put("n",  str(a.get("name")));
                p.put("k",  projectActorKind(str(a.get("kind"))));
                p.put("b",  str(a.get("body_md")));
                command("INSERT INTO KnowProjectActor SET actor_id=:id, name=:n, kind=:k, body_md=:b", p);
                moved++;
            }

            String newRid = firstRid("SELECT @rid AS rid FROM KnowProjectActor WHERE actor_id = :id",
                Map.of("id", actorId));
            if (newRid == null) {
                throw new IllegalStateException("[LORE MIGRATE] V30: роль " + actorId
                    + " не найдена сразу после создания — перенос прерван.");
            }

            for (String edge : inEdges) {
                if (!typeExists(edge)) continue;
                for (Map<String, Object> e : ingest.queryPublic(
                        "SELECT @rid AS rid, @out AS src FROM " + edge + " WHERE @in = " + a.get("rid"), Map.of())) {
                    exec(String.format("CREATE EDGE %s FROM %s TO %s IF NOT EXISTS",
                        edge, str(e.get("src")), newRid));
                    exec("DELETE FROM " + edge + " WHERE @rid = " + e.get("rid"));
                    movedEdges++;
                }
            }
            for (String edge : outEdges) {
                if (!typeExists(edge)) continue;
                for (Map<String, Object> e : ingest.queryPublic(
                        "SELECT @rid AS rid, @in AS target FROM " + edge + " WHERE @out = " + a.get("rid"), Map.of())) {
                    exec(String.format("CREATE EDGE %s FROM %s TO %s IF NOT EXISTS",
                        edge, newRid, str(e.get("target"))));
                    exec("DELETE FROM " + edge + " WHERE @rid = " + e.get("rid"));
                    movedEdges++;
                }
            }

            exec("DELETE VERTEX FROM KnowActor WHERE @rid = " + a.get("rid"));
        }

        // Контроль, а не вера: в KnowActor обязаны остаться ТОЛЬКО личности.
        List<Map<String, Object>> leftovers = ingest.queryPublic(
            "SELECT actor_id FROM KnowActor "
            + "WHERE (client_id IS NULL OR client_id = '') AND out('OWNED_BY').size() = 0", Map.of());
        if (!leftovers.isEmpty()) {
            throw new IllegalStateException("[LORE MIGRATE] V30: в KnowActor остались описательные "
                + "акторы после переноса (" + leftovers.size() + ") — разберитесь вручную, бэкап снят.");
        }

        LOG.infof("[LORE MIGRATE] V30: ролей перенесено %d, рёбер перевешено %d; "
            + "KnowActor остаётся личностью, RBAC не тронут", moved, movedEdges);
    }

    /**
     * PL-28 (решение владельца №141): KnowFeature растворяется в KnowUseCase.
     * Фича становится КОРНЕВЫМ сценарием — той же вершиной на верхнем уровне
     * шкалы Коберна, а не отдельным типом.
     *
     * Почему Java, а не SQL-стейтменты шага. У ребра в ArcadeDB неизменяемые
     * концы: «перецепить» ADDRESSES с фичи на сценарий одним UPDATE нельзя,
     * нужно создать новое и удалить старое поимённо по @rid. Плюс DELETE EDGE
     * в этой сборке не работает вовсе — только `SELECT outE(...).@rid` и затем
     * `DELETE FROM <ТипРебра> WHERE @rid = #x:y` (проверено ранее на этой же БД).
     *
     * Идемпотентность. Шаг обязан переживать повтор: ledger пишется ПОСЛЕ
     * javaStep, и падение между ними оставит шаг pending. Поэтому каждое
     * действие проверяет своё «уже сделано»: тип может отсутствовать, сценарий
     * с таким uc_id уже существовать, рёбра — быть перевешены на прошлом заходе.
     *
     * Пары рёбер НЕ схлопываются (решение ADR-LORE-022-D20): ADDRESSES/RELIEVES,
     * PROMISES/DELIVERS, HELPS_WITH/PERFORMS кодируют «заявлено vs доставлено»,
     * а не «фича vs сценарий». Меняется только тип вершины-источника — сами
     * рёбра переезжают как есть.
     */
    private void mergeFeaturesIntoUseCases() {
        if (!typeExists("KnowFeature")) {
            LOG.info("[LORE MIGRATE] V13: типа KnowFeature нет — свежая БД, переносить нечего");
            return;
        }

        // Рёбра, исходящие ИЗ фичи. Каждое переезжает на новый корневой сценарий
        // с тем же дальним концом. DECOMPOSES_INTO из Feature→UC становится
        // UC→UC — это и есть само-иерархия.
        final List<String> outEdges = List.of(
            "DECOMPOSES_INTO", "ADDRESSES", "PROMISES", "HELPS_WITH",
            "BELONGS_TO", "BELONGS_TO_PROJECT", "TARGETS_MILESTONE",
            "TAGGED_WITH", "ATTACHED_TO", "TRACED_TO"
        );

        List<Map<String, Object>> features = ingest.queryPublic(
            "SELECT @rid AS rid, feature_id, title, body_md, context_md, status,"
            + " goal_level, shipped_at, date_created FROM KnowFeature", Map.of());

        int created = 0;
        int movedEdges = 0;
        for (Map<String, Object> f : features) {
            String featureId = str(f.get("feature_id"));
            if (featureId == null || featureId.isBlank()) {
                // Вершина без идентификатора — переносить некуда и не за что
                // зацепиться при повторе. Валим громко: молчаливый пропуск
                // потерял бы данные, а это ровно то, чего миграция не вправе.
                throw new IllegalStateException("[LORE MIGRATE] V13: KnowFeature "
                    + f.get("rid") + " без feature_id — перенос невозможен, "
                    + "проставьте идентификатор вручную и повторите старт.");
            }

            // uc_id совпадает с feature_id: ссылки в телах ([[FEAT-…]]),
            // денормализованный feature_id у детей и уже выданные URL остаются
            // рабочими. Переименование сделало бы миграцию невосстановимой.
            boolean already = !ingest.queryPublic(
                "SELECT @rid FROM KnowUseCase WHERE uc_id = :id", Map.of("id", featureId)).isEmpty();

            if (!already) {
                Map<String, Object> p = new HashMap<>();
                p.put("id", featureId);
                p.put("t",  str(f.get("title")));
                p.put("b",  str(f.get("body_md")));
                p.put("c",  str(f.get("context_md")));
                // Уровень цели у фич уже заполнен (cloud|kite). Если пусто —
                // cloud: корень без уровня иначе провалился бы в фильтры UC.
                String lvl = str(f.get("goal_level"));
                p.put("g",  lvl == null || lvl.isBlank() ? "cloud" : lvl);
                p.put("d",  str(f.get("date_created")));
                // Статус: у фичи хранились только намерения (proposed|dropped),
                // остальное вычисляется (D17) — переносим как есть.
                p.put("s",  str(f.get("status")));
                p.put("sa", str(f.get("shipped_at")));
                command("INSERT INTO KnowUseCase SET uc_id=:id, title=:t, body_md=:b,"
                    + " context_md=:c, goal_level=:g, date_created=:d, status=:s, shipped_at=:sa", p);
                created++;
            }

            String ucRid = firstRid("SELECT @rid AS rid FROM KnowUseCase WHERE uc_id = :id",
                Map.of("id", featureId));
            if (ucRid == null) {
                throw new IllegalStateException("[LORE MIGRATE] V13: сценарий " + featureId
                    + " не найден сразу после создания — перенос прерван.");
            }

            for (String edge : outEdges) {
                if (!typeExists(edge)) continue;
                List<Map<String, Object>> rows = ingest.queryPublic(
                    "SELECT @rid AS rid, @in AS target FROM " + edge + " WHERE @out = " + f.get("rid"),
                    Map.of());
                for (Map<String, Object> e : rows) {
                    String target = str(e.get("target"));
                    // String.format, а не именованные параметры: на CREATE EDGE
                    // они в этой сборке ненадёжны (зафиксировано в LORE_DB_SPEC).
                    exec(String.format("CREATE EDGE %s FROM %s TO %s IF NOT EXISTS",
                        edge, ucRid, target));
                    exec("DELETE FROM " + edge + " WHERE @rid = " + e.get("rid"));
                    movedEdges++;
                }
            }

            // Денормализованный указатель на родителя: тот же идентификатор,
            // но теперь он ведёт в свой же тип.
            command("UPDATE KnowUseCase SET parent_uc_id = :id WHERE feature_id = :id",
                Map.of("id", featureId));

            exec("DELETE VERTEX FROM KnowFeature WHERE @rid = " + f.get("rid"));
        }

        // Тип сносится только когда он пуст. Непустой — значит выше что-то не
        // доехало, и молча потерять это нельзя.
        boolean empty = ingest.queryPublic("SELECT @rid FROM KnowFeature LIMIT 1", Map.of()).isEmpty();
        if (empty) {
            exec("DROP TYPE KnowFeature IF EXISTS UNSAFE");
        } else {
            throw new IllegalStateException("[LORE MIGRATE] V13: в KnowFeature остались вершины "
                + "после переноса — тип не снесён, разберитесь вручную (бэкап снят).");
        }

        LOG.infof("[LORE MIGRATE] V13: фич перенесено %d, рёбер перевешено %d, тип KnowFeature снят",
            created, movedEdges);
    }

    /**
     * AL-29 (OQ-ADMIN-TAG-SPLIT): LoreTag и KnowTag несли одни и те же теги
     * под двумя разными вершинами в зависимости от того, откуда пришёл тег —
     * вопросам (LoreTag) или ADR/decision/task (KnowTag). Схлопывается в
     * KnowTag — она шире по охвату типов сущностей.
     *
     * Почему Java, а не SQL-стейтменты шага — та же причина, что у V13
     * (mergeFeaturesIntoUseCases): у рёбер TAGGED_WITH неизменяемые концы,
     * «перецепить» дальний конец одним UPDATE нельзя, нужна @rid-адресация
     * поимённо; DELETE EDGE в этой сборке не работает — только
     * `SELECT outE/inE(...).@rid` и затем `DELETE FROM <ТипРебра> WHERE @rid=#x:y`.
     *
     * Идемпотентность: тип LoreTag может отсутствовать (свежая БД — нечего
     * переносить); тег с таким tag_id может уже существовать в KnowTag
     * (переиспользуем, не дублируем); рёбра — быть перевешены на прошлом
     * заходе (IF NOT EXISTS на CREATE EDGE).
     */
    private void mergeLoreTagIntoKnowTag() {
        if (!typeExists("LoreTag")) {
            LOG.info("[LORE MIGRATE] V17: типа LoreTag нет — свежая БД, переносить нечего");
            return;
        }

        List<Map<String, Object>> tags = ingest.queryPublic("SELECT @rid AS rid, tag_id FROM LoreTag", Map.of());

        int reused = 0, created = 0, movedEdges = 0;
        for (Map<String, Object> t : tags) {
            String tagId = str(t.get("tag_id"));
            if (tagId == null || tagId.isBlank()) {
                throw new IllegalStateException("[LORE MIGRATE] V17: LoreTag " + t.get("rid")
                    + " без tag_id — перенос невозможен, проставьте вручную и повторите старт.");
            }

            boolean already = !ingest.queryPublic(
                "SELECT @rid FROM KnowTag WHERE tag_id = :id", Map.of("id", tagId)).isEmpty();
            if (already) {
                reused++;
            } else {
                command("INSERT INTO KnowTag SET tag_id=:id", Map.of("id", tagId));
                created++;
            }

            String knowTagRid = firstRid("SELECT @rid AS rid FROM KnowTag WHERE tag_id = :id", Map.of("id", tagId));
            if (knowTagRid == null) {
                throw new IllegalStateException("[LORE MIGRATE] V17: тег " + tagId
                    + " не найден в KnowTag сразу после создания — перенос прерван.");
            }

            // Рёбра TAGGED_WITH ВХОДЯТ в LoreTag (сущность --TAGGED_WITH--> тег) —
            // перецепляем дальний конец (@out) на тот же KnowTag.
            List<Map<String, Object>> edges = ingest.queryPublic(
                "SELECT @rid AS rid, @out AS src FROM TAGGED_WITH WHERE @in = " + t.get("rid"), Map.of());
            for (Map<String, Object> e : edges) {
                String src = str(e.get("src"));
                exec(String.format("CREATE EDGE TAGGED_WITH FROM %s TO %s IF NOT EXISTS", src, knowTagRid));
                exec("DELETE FROM TAGGED_WITH WHERE @rid = " + e.get("rid"));
                movedEdges++;
            }

            exec("DELETE VERTEX FROM LoreTag WHERE @rid = " + t.get("rid"));
        }

        boolean empty = ingest.queryPublic("SELECT @rid FROM LoreTag LIMIT 1", Map.of()).isEmpty();
        if (empty) {
            exec("DROP TYPE LoreTag IF EXISTS UNSAFE");
        } else {
            throw new IllegalStateException("[LORE MIGRATE] V17: в LoreTag остались вершины "
                + "после переноса — тип не снесён, разберитесь вручную (бэкап снят).");
        }

        LOG.infof("[LORE MIGRATE] V17: тегов перенесено (переиспользовано %d, создано %d), рёбер перевешено %d, тип LoreTag снят",
            reused, created, movedEdges);
    }

    /**
     * Тип, его ключ и КАКИМ ребром он связан с компонентом.
     *
     * @param entityToComponent {@code true} — ребро идёт ОТ записи К компоненту
     *        ({@code BELONGS_TO}); {@code false} — наоборот, от компонента к
     *        записи ({@code DOCUMENTED_IN} у спек: «компонент документирован в
     *        спеке»). Направление читается слайсами буквально, поэтому обратное
     *        ребро для них не существует.
     */
    record ComponentLink(String type, String idField, String edge, boolean entityToComponent) {}

    /**
     * Типы, у которых принадлежность компоненту жила ПОЛЕМ {@code component_id}.
     *
     * <p><b>Ребро у спек другое, и это не мелочь.</b> Первый замер шёл по
     * {@code BELONGS_TO} для всех типов и дал у спек 184 «поля без ребра». Число
     * неверно: паспорт компонента читает спеки через {@code DOCUMENTED_IN}
     * (сумма по компонентам — 352 из 390 спек), то есть они в основном связаны,
     * просто другим ребром. Достроить им {@code BELONGS_TO} значило бы завести
     * ТРЕТЬЕ представление там, где боремся со вторым.
     *
     * <p>Отсюда правило: канонично не «ребро вообще», а ребро, которое читают
     * слайсы этого типа. Универсального ответа здесь нет, и делать вид, что
     * есть, — способ размножить ту же болезнь под видом лечения.
     *
     * <p>{@code KnowTask} в списке при шести строках расхождения не ради этих
     * шести: пропустить тип значило бы оставить исключение, о котором придётся
     * помнить, — а гейт NM-04 считает по всем типам, и невключённый тип светился
     * бы в нём вечно.
     */
    private static final List<ComponentLink> COMPONENT_FIELD_TYPES = List.of(
        new ComponentLink("KnowDecision", "decision_id", "BELONGS_TO",    true),
        new ComponentLink("KnowDoc",      "doc_id",      "BELONGS_TO",    true),
        new ComponentLink("KnowQuestion", "question_id", "BELONGS_TO",    true),
        new ComponentLink("KnowADR",      "adr_id",      "BELONGS_TO",    true),
        new ComponentLink("QualityGate",  "qg_id",       "BELONGS_TO",    true),
        new ComponentLink("KnowTask",     "task_uid",    "BELONGS_TO",    true),
        new ComponentLink("KnowSpec",     "spec_id",     "DOCUMENTED_IN", false),
        // NM-07. Эти два типа были пропущены в первой редакции, и отчёт «ноль по
        // всем семи типам» оказался верен буквально и неполон по смыслу:
        // носителей поля девять.
        //
        // Ребра на компонент у них не было ВООБЩЕ — поле единственное
        // представление. Поэтому третьего представления здесь не заводится:
        // BELONGS_TO становится их первым.
        //
        // Рассматривался вывод компонента из родительского гейта (у обоих есть
        // qg_id, и на проде компонент рекомендаций совпадает с компонентом
        // гейта). Отвергнуто: связь с гейтом у них тоже скалярным полем, обхода
        // по графу не построить — вывод пришлось бы считать в Java на каждом
        // чтении, то есть заменить одну денормализацию другой.
        new ComponentLink("QGJobTask",       "job_id", "BELONGS_TO", true),
        new ComponentLink("QGRecommendation", "rec_id", "BELONGS_TO", true));

    /**
     * NM-02: довести рёбра {@code BELONGS_TO} до полей {@code component_id}.
     *
     * <p><b>Шаг только ДОБАВЛЯЕТ.</b> Ни одно ребро и ни одно поле здесь не
     * удаляется и не переписывается. Это не осторожность вообще, а следствие
     * замера: представления расходятся в обе стороны, и «привести к ребру»
     * переписыванием стёрло бы 740+ связей, живущих только полем. После шага обе
     * правды совпадают, и любой следующий шаг можно отменить, вернувшись к полю.
     *
     * <p><b>Идемпотентность обязательна.</b> Ledger пишется ПОСЛЕ java-части,
     * поэтому падение в середине даёт повторный прогон на частично обработанных
     * данных. Ребро ставится только там, где его нет, поэтому повтор ничего не
     * дублирует.
     *
     * <p><b>Несуществующий компонент — не повод промолчать.</b> {@code CREATE
     * EDGE} с пустым TO в этой грамматике тихий no-op: строка «обработана», а
     * ребра нет. Такие поля собираются и перечисляются в логе с числом. Ноль в
     * этом счётчике — тоже результат, который надо увидеть, поэтому он пишется
     * всегда, а не только когда ненулевой.
     */
    private void backfillComponentEdges() {
        Set<String> knownComponents = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT component_id FROM LoreComponent", Map.of())) {
            String c = str(r.get("component_id"));
            if (c != null && !c.isBlank()) knownComponents.add(c);
        }
        if (knownComponents.isEmpty()) {
            LOG.info("[LORE MIGRATE] V31: реестр компонентов пуст — свежая БД, доводить нечего");
            return;
        }

        int totalCreated = 0, totalAlready = 0;
        List<String> dangling = new ArrayList<>();

        for (ComponentLink link : COMPONENT_FIELD_TYPES) {
            String type = link.type(), idField = link.idField();
            if (!typeExists(type)) continue;   // тип мог не дожить до этой версии

            // Направление ребра у типов разное, и читать надо ту же сторону,
            // которую читают слайсы: спека связана ВХОДЯЩИМ DOCUMENTED_IN от
            // компонента, остальные — исходящим BELONGS_TO к компоненту.
            String traverse = link.entityToComponent()
                ? "out('" + link.edge() + "').component_id"
                : "in('"  + link.edge() + "').component_id";

            // Берём ВСЕ строки с непустым полем, а не только «без единого ребра»:
            // у записи может быть ребро на ДРУГОЙ компонент, и тогда связь,
            // записанная полем, всё равно отсутствует. Условие «нет рёбер вовсе»
            // такие строки пропустило бы, а это как раз случай смены компонента,
            // которая уезжала в поле и не доезжала до ребра.
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT " + idField + " AS id, component_id, "
                + traverse + " AS linked "
                + "FROM " + type + " WHERE component_id IS NOT NULL AND component_id <> ''", Map.of());

            int created = 0, already = 0;
            for (Map<String, Object> r : rows) {
                String id = str(r.get("id"));
                String want = str(r.get("component_id"));
                if (id == null || id.isBlank() || want == null || want.isBlank()) continue;
                if (alreadyLinked(r.get("linked"), want)) { already++; continue; }
                if (!knownComponents.contains(want)) {
                    dangling.add(type + '/' + id + " → " + want);
                    continue;
                }
                // String.format, не именованные параметры: в этой грамматике
                // CREATE EDGE с :param молча не подставляет (см. соседние шаги).
                String entity = String.format("(SELECT FROM %s WHERE %s = '%s')", type, idField, esc(id));
                String comp = String.format("(SELECT FROM LoreComponent WHERE component_id = '%s')", esc(want));
                exec(String.format("CREATE EDGE %s FROM %s TO %s IF NOT EXISTS", link.edge(),
                    link.entityToComponent() ? entity : comp,
                    link.entityToComponent() ? comp : entity));
                created++;
            }
            LOG.infof("[LORE MIGRATE] V31: %-13s строк с полем %4d, ребро добавлено %4d, уже было %4d",
                type, rows.size(), created, already);
            totalCreated += created;
            totalAlready += already;
        }

        LOG.infof("[LORE MIGRATE] V31: итого добавлено рёбер %d, уже совпадало %d, "
            + "полей на несуществующий компонент %d", totalCreated, totalAlready, dangling.size());
        if (!dangling.isEmpty()) {
            // Не падаем: это данные, а не поломка шага, и остановка на них
            // заблокировала бы слияние из-за мусора, который чинится отдельно.
            // Но и не молчим — иначе «ноль расхождений» у гейта NM-04 окажется
            // недостижим по причине, о которой никто не узнал.
            LOG.warnf("[LORE MIGRATE] V31: поля, указывающие на незарегистрированный компонент "
                + "(ребро НЕ создано, гейт NM-04 их увидит): %s",
                String.join("; ", dangling.subList(0, Math.min(dangling.size(), 40))));
        }

        // Контроль на месте, а не «посмотрим потом»: пересчитываем то же, что
        // мерили до шага. Отличие от простого «упало/не упало» в том, что здесь
        // видно ИМЕННО остаток — и он обязан объясняться списком выше.
        int leftover = 0;
        for (ComponentLink link : COMPONENT_FIELD_TYPES) {
            if (!typeExists(link.type())) continue;
            String side = (link.entityToComponent() ? "out('" : "in('") + link.edge() + "')";
            List<Map<String, Object>> n = ingest.queryPublic(
                "SELECT count(*) AS n FROM " + link.type()
                + " WHERE component_id IS NOT NULL AND component_id <> '' "
                + "AND " + side + ".size() = 0", Map.of());
            leftover += n.isEmpty() ? 0 : ((Number) n.get(0).getOrDefault("n", 0)).intValue();
        }
        LOG.infof("[LORE MIGRATE] V31: осталось записей с полем и без единого ребра: %d "
            + "(ожидание — только те, чей компонент не зарегистрирован: %d)",
            leftover, dangling.size());
    }

    /**
     * Есть ли уже ребро на ИМЕННО ТОТ компонент, что назван полем.
     *
     * <p>Вынесено отдельно, потому что здесь прячется решающая ошибка шага.
     * Напрашивается условие «у записи вообще нет рёбер» — и оно пропустило бы
     * записи, у которых ребро ведёт на ДРУГОЙ компонент. А это как раз самый
     * частый способ разъехаться: компонент сменили, поле обновилось, ребро
     * осталось на прежнем. Такая запись выглядит связанной, но связана не с тем,
     * и «нет рёбер» её не ловит.
     *
     * <p>Ребро на другой компонент при этом НЕ удаляется: шаг только добавляет.
     * Разбор, какое из двух верное, — работа человека, а не миграции.
     */
    static boolean alreadyLinked(Object linked, String want) {
        return linked instanceof List<?> have && have.contains(want);
    }

    /** Экранирование одинарной кавычки для String.format-путей CREATE EDGE. */
    private static String esc(String v) { return v.replace("'", "''"); }

    private boolean typeExists(String name) {
        return !ingest.queryPublic("SELECT name FROM schema:types WHERE name = :n",
            Map.of("n", name)).isEmpty();
    }

    private String firstRid(String sql, Map<String, Object> params) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, params);
        return rows.isEmpty() ? null : str(rows.get(0).get("rid"));
    }

    private static String str(Object v) { return v == null ? null : String.valueOf(v); }

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
            try {
                exec(ix.createSql());
            } catch (RuntimeException e) {
                // Наблюдавшийся отказ (2026-08-29, база на v10 догоняла v28):
                //   Error on creating index 'KnowADRHist_0_…' ->
                //   Index 1 out of bounds for length 1
                // Что ПРОВЕРЕНО в тот же день на 26.8.1: тот же индекс (3 поля,
                // RussianAnalyzer) создаётся и на пустом типе, и на типе с
                // записями, где часть полей null. То есть ни многополевость, ни
                // пустые значения причиной не были, а та же установка, поднятая
                // С НУЛЯ, взлетела. Остаётся недомигрированное состояние базы.
                // Версию движка называем как ТРЕБОВАНИЕ, а не как диагноз:
                // подтверждения, что дело было в ней, нет.
                LOG.errorf(e, "[LORE MIGRATE] не удалось создать FULL_TEXT-индекс %s на %s%s. "
                    + "Две известные причины. (1) Движок: требуется ArcadeDB 26.8.1 или новее — "
                    + "на 26.8.1 этот индекс создаётся, более старые сборки не проверялись. "
                    + "(2) Недомигрированная база: наблюдалось на БД, догонявшей много версий "
                    + "сразу; та же установка с ЧИСТОЙ базы поднялась без ошибки. "
                    + "Миграция идемпотентна — после обновления движка её можно запустить заново; "
                    + "если база пустая или одноразовая, быстрее пересоздать её.",
                    ix.name(), ix.type(), ix.fields());
                throw e;
            }
            created++;
        }
        LOG.infof("[LORE MIGRATE] полнотекст: создано %d (взамен старых %d), уже было %d, типов нет %d — реестр %d",
            created, replaced, skipped, absent, LoreSchemaMigrations.FT_INDEXES.size());

        int expected = LoreSchemaMigrations.FT_INDEXES.size() - absent;
        if (created + skipped < expected) {
            throw new IllegalStateException("[LORE MIGRATE] полнотекст: создано " + created + " + уже было " + skipped
                + ", ожидалось " + expected + " — часть индексов отсутствует, поиск пошёл бы сканом при «успешной» миграции.");
        }
    }

    /**
     * Ретайр легаси-FT (SRCH-01, ADR-LORE-033 D10): реестр — единственный
     * источник FULL_TEXT-индексов, всё вне его снимается. Легаси-однополевые
     * не читаются никем после перевода слайса на SEARCH_INDEX('ftИмя', …), а
     * каждое поле в них оплачивается на каждой записи дважды.
     *
     * ВЫЗЫВАЕТСЯ НА КАЖДОМ СТАРТЕ, а не из javaStep миграции. Первый вариант
     * жил внутри createFullTextIndexes → javaStep(11|12), и на УЖЕ
     * мигрированной базе не выполнялся никогда: шаги в ledger, javaStep не
     * зовётся — прод после деплоя сохранил 25 bracket-легаси при «работающей»
     * чистке. Тест-БД маскировала это: она свежая, шаги там всегда pending.
     *
     * Новым шагом миграции тоже нельзя: шаги 2/3, создавшие эти индексы,
     * трогать запрещено (checksum в ledger, дрейф-гард), а чистка идемпотентна
     * и должна догонять любые будущие легаси.
     *
     * Критерий — только логическая bracket-форма `Тип[поле]` вне реестра.
     * Бакетные строки (`Тип_0_<ts>`) не трогаются ВООБЩЕ: они принадлежат в
     * т.ч. именованным индексам, и снятие бакета каскадно уничтожает весь
     * индекс — ровно так первый вариант чистки оставил тест-БД без единого
     * FT-индекса (поймано тестом). «Index not found» при DROP — не ошибка:
     * соседняя bracket-форма могла унести эту каскадом. Любая другая ошибка
     * валит старт (урок V11: молчаливая полуправда хуже падения).
     */
    private void retireLegacyFullTextIndexes() {
        Set<String> declared = new HashSet<>();
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) declared.add(ix.name());
        int retired = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT name FROM schema:indexes WHERE indexType = 'FULL_TEXT'", Map.of())) {
            String n = String.valueOf(r.get("name"));
            if (declared.contains(n) || !n.contains("[")) continue;
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

    // AL-92 (V20): бэкфилл BELONGS_TO_PROJECT у исторических вершин трёх типов.
    // Идемпотентно вдвойне: выборка — только вершины БЕЗ единого исходящего
    // ребра проекта, вставка — IF NOT EXISTS. Проекты-цели должны быть
    // зарегистрированы (KnowGitProject) — незарегистрированный slug даёт 0
    // созданных рёбер и попадает в лог, а не падает.
    private void backfillProjectEdges() {
        // 1) KnowADR ← проекты его спринтов (IMPLEMENTED_IN → BELONGS_TO_PROJECT).
        //    Мультипривязка ВСЕХ distinct-проектов: решение владельца — общее
        //    владение на пересечении это норма, не конфликт.
        int adrTouched = 0, adrEdges = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT adr_id, out('IMPLEMENTED_IN').out('BELONGS_TO_PROJECT').slug AS slugs "
                + "FROM KnowADR WHERE out('BELONGS_TO_PROJECT').size() = 0", Map.of())) {
            java.util.Set<String> slugs = distinctSlugs(r.get("slugs"));
            if (slugs.isEmpty()) continue;
            adrTouched++;
            for (String slug : slugs) {
                command("CREATE EDGE BELONGS_TO_PROJECT "
                    + "FROM (SELECT FROM KnowADR WHERE adr_id = :a) "
                    + "TO (SELECT FROM KnowGitProject WHERE slug = :p) IF NOT EXISTS",
                    Map.of("a", r.get("adr_id"), "p", slug));
                adrEdges++;
            }
        }
        LOG.infof("[LORE MIGRATE] V20 backfill ADR→project: %d ADR, %d рёбер", adrTouched, adrEdges);

        // 2) KnowRelease ← плоское поле git_project (двойная правда из аудита
        //    AL-96: ребро выравнивается по полю; поле остаётся как денормализация).
        //    Матч источника по @rid — release_id не уникален между проектами.
        int relEdges = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT @rid AS rid, git_project FROM KnowRelease "
                + "WHERE out('BELONGS_TO_PROJECT').size() = 0 AND git_project IS NOT NULL", Map.of())) {
            command("CREATE EDGE BELONGS_TO_PROJECT FROM " + r.get("rid")
                + " TO (SELECT FROM KnowGitProject WHERE slug = :p) IF NOT EXISTS",
                Map.of("p", r.get("git_project")));
            relEdges++;
        }
        LOG.infof("[LORE MIGRATE] V20 backfill Release→project: %d рёбер", relEdges);

        // 3) KnowSpec ← проекты спринтов его компонентов, ТОЛЬКО при ровно одном
        //    distinct-проекте: цепочка spec→component→sprint→project слишком
        //    косвенная, чтобы мультипривязывать автоматически — неоднозначные
        //    остаются на ручную привязку (spec_link rel=project), и это видно в логе.
        int specEdges = 0, specSkipped = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT spec_id, out('BELONGS_TO').in('BELONGS_TO')[@this INSTANCEOF 'KnowSprint']"
                + ".out('BELONGS_TO_PROJECT').slug AS slugs "
                + "FROM KnowSpec WHERE out('BELONGS_TO_PROJECT').size() = 0", Map.of())) {
            java.util.Set<String> slugs = distinctSlugs(r.get("slugs"));
            if (slugs.size() != 1) {
                if (slugs.size() > 1) {
                    specSkipped++;
                    LOG.infof("[LORE MIGRATE] V20 spec %s: %d проектов через компоненты — пропуск, привязать вручную",
                        r.get("spec_id"), slugs.size());
                }
                continue;
            }
            command("CREATE EDGE BELONGS_TO_PROJECT "
                + "FROM (SELECT FROM KnowSpec WHERE spec_id = :s) "
                + "TO (SELECT FROM KnowGitProject WHERE slug = :p) IF NOT EXISTS",
                Map.of("s", r.get("spec_id"), "p", slugs.iterator().next()));
            specEdges++;
        }
        LOG.infof("[LORE MIGRATE] V20 backfill Spec→project: %d рёбер, %d неоднозначных пропущено",
            specEdges, specSkipped);
    }

    /** Плоский/списочный результат графового траверса → distinct non-null slugs. */
    private static java.util.Set<String> distinctSlugs(Object raw) {
        java.util.Set<String> out = new java.util.LinkedHashSet<>();
        if (raw instanceof java.util.Collection<?> c) {
            for (Object o : c) if (o != null && !o.toString().isBlank()) out.add(o.toString());
        } else if (raw != null && !raw.toString().isBlank()) {
            out.add(raw.toString());
        }
        return out;
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
