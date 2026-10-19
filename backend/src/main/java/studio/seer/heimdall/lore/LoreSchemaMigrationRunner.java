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
        List<String> missing = LoreSchemaMigrations.requiredLiveTypes().stream()
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
        if (hasData && backupRequired) backupOnceOrDie(dbVersion);
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
        if (version == 34) dropComponentField();
        if (version == 36 || version == 37) backfillTaskRoleEdges();
        if (version == 38) preserveRoleFieldsIntoNote();
        if (version == 39) dropTaskRoleFields();
        if (version == 28) recreateFtIndexes();
        if (version == 41) normalizeHistValidFrom();
        if (version == 46) backfillDroppedRoleNotes();
        if (version == 47) backfillDocProjectEdgesByProduct();
    }

    /**
     * Карта «продукт → проект» для шага V47.
     *
     * <p><b>Выведена из данных, а не назначена.</b> По записям, у которых проект
     * УЖЕ стоит, посчитано, куда корпус относит документы каждого продукта
     * (замер 19.10.2026): AIDA 87/91, HEIMDALL 10/10, HOUND 1/1, MT 7/7,
     * SEIDR 10/10 → {@code NooriUta/AIDA}; MIDGARD 87/89 → {@code AIDA/MIDGARD};
     * MINILORE 31/31 → {@code AIDA/miniLORE}; OMILORE 2/2 →
     * {@code NooriUta/UnlimitedLORE}; VOLVA 1/1 → {@code NooriUta/volva}.
     *
     * <p>Карта зашита ЗДЕСЬ, а не вычисляется на ходу, намеренно: вычисляемая
     * карта меняла бы смысл шага от прогона к прогону, и повторный запуск на
     * другой базе привязал бы иначе. Решение должно быть читаемым на ревью.
     *
     * <p><b>TYR, BRAGI, ODIN — со слов владелицы 19.10.2026</b>, не из данных:
     * у этих трёх продуктов нет ни одной уже привязанной записи, учиться было
     * не на чем. TYR показывает, почему такие случаи нельзя оставлять
     * алгоритму: код продукта {@code TYR}, а репозиторий —
     * {@code NooriUta/AIDA-TestPlayGround}, совпадения имён нет вовсе. Угадай
     * мы BRAGI и ODIN «по совпадению имени» и окажись они правы — правило всё
     * равно осталось бы негодным, потому что на TYR оно уже ошиблось. Слаги
     * сверены по реестру {@code KnowGitProject} (срез {@code git_projects}),
     * а не взяты из переписки: у {@code NooriUta/BRAGI} и {@code NooriUta/ODIN}
     * вершины есть, {@code hosts} пустой — для {@code BELONGS_TO_PROJECT}
     * этого достаточно, ребро ведёт в вершину, а не в URL.
     *
     * <p><b>Чего в карте нет и почему.</b> MIGGEN исключён ОСОЗНАННО:
     * данные дают {@code ciadmin/udwe-mig-gen}, но проект помечен «переехал в
     * AIDA 17.08», и рядом есть {@code AIDA/udwe-mig-gen}. Обучение на истории
     * повторило бы ошибку истории — эти записи привязываются вручную.
     */
    private static final Map<String, String> PRODUCT_TO_PROJECT = Map.ofEntries(
        Map.entry("AIDA",     "NooriUta/AIDA"),
        Map.entry("HEIMDALL", "NooriUta/AIDA"),
        Map.entry("HOUND",    "NooriUta/AIDA"),
        Map.entry("MT",       "NooriUta/AIDA"),
        Map.entry("SEIDR",    "NooriUta/AIDA"),
        Map.entry("MIDGARD",  "AIDA/MIDGARD"),
        Map.entry("MINILORE", "AIDA/miniLORE"),
        Map.entry("OMILORE",  "NooriUta/UnlimitedLORE"),
        Map.entry("VOLVA",    "NooriUta/volva"),
        // Ниже — со слов владелицы, выше — выведено из уже привязанных записей.
        Map.entry("TYR",      "NooriUta/AIDA-TestPlayGround"),
        Map.entry("BRAGI",    "NooriUta/BRAGI"),
        Map.entry("ODIN",     "NooriUta/ODIN"));

    /**
     * RM-P9: спеки, доки и ранбуки без проекта получают его через ПРОДУКТ
     * своего компонента.
     *
     * <p><b>Зачем отдельный шаг, если V20 это уже делал.</b> V20 выводил проект
     * по цепочке «компонент → спринты компонента → их проекты» и брал результат
     * только при ровно одном distinct-проекте. Замер 19.10.2026 показал, что на
     * сегодняшних данных это правило закрывает <b>15 записей из 499</b>: путь
     * отвечает на вопрос «в каких репозиториях трогали компонент», а не «чей
     * это документ». У {@code DALI_OVERVIEW} кандидатов четыре, и все четыре
     * «верны» — компонент DALI живёт в нескольких репозиториях.
     *
     * <p>Путь через продукт однозначен: у 457 спек и доков <b>ни одной</b>
     * записи со смешанным набором продуктов не нашлось — либо все компоненты в
     * семье одного продукта, либо ни один. Поэтому здесь нет развилки
     * «мультипривязать или пропустить», которая была у V20.
     *
     * <p>Ранбуки идут своим путём — проект ADR, на который ранбук ссылается:
     * у ADR проект есть всегда (218 из 218), а компонента у ранбука нет вовсе.
     *
     * <p>Идемпотентен: отбираются только вершины без единого
     * {@code BELONGS_TO_PROJECT}, ребро создаётся с {@code IF NOT EXISTS}.
     * Повторный прогон не найдёт ничего и скажет об этом.
     *
     * <p><b>Что шаг НЕ делает.</b> Не трогает записи, чьи продукты в карте
     * отсутствуют, и записи без компонента вовсе. Их число печатается в лог —
     * «пропущено» здесь содержательный результат, а не тишина: по нему видно,
     * сколько осталось ручной работы.
     *
     * <p><b>Два исключения по решению владелицы 19.10.2026</b> («Claude rules
     * infra пока ни к чему не привязывай»): доки вида {@code claude-rules} и
     * ранбуки области {@code infra} остаются без проекта. Причина содержательная,
     * а не отсрочка: и те и другие описывают МАШИНУ и стенд, а не продукт —
     * правила {@code ~/.claude/CLAUDE.md}, доступ по SSH, DNS, Traefik, секреты.
     * Привязка к одному проекту сделала бы общее знание чужим для остальных.
     *
     * <p>Исключения выражены условием запроса, а не оставлены на самотёк. Девять
     * доков {@code claude-rules} сегодня и так без компонента, то есть шаг
     * пропустил бы их сам — но это защита случайная: стоит кому-то привязать
     * такому доку компонент, и следующий прогон утащил бы его в проект. Два
     * инфраструктурных ранбука ({@code RUNBOOK-LOCAL-DNS} через
     * {@code ADR-INFRA-002}, {@code RUNBOOK-SECRETS-HASHICORP-VAULT} через
     * {@code ADR-LORE-024}) шаг привязал бы уже сейчас.
     *
     * <p>Условие написано как {@code (kind IS NULL OR kind <> 'claude-rules')}
     * намеренно: голое {@code <>} в ArcadeDB отбрасывает и строки с {@code NULL},
     * то есть «фильтр» заодно выкинул бы все доки без вида — и выглядел бы при
     * этом работающим.
     *
     * <p>Тела этих записей читаются всеми, и {@code admin}/{@code superadmin}
     * в частности: обнуление тела (AL-96) не трогает записи без проекта вовсе,
     * а обе админские роли вдобавок обходят его через
     * {@code AidaLoreResource.bypassesScope}.
     */
    private void backfillDocProjectEdgesByProduct() {
        // Компонент → проект, через продукт. Собирается один раз: иначе на
        // каждую запись шёл бы отдельный обход графа.
        Map<String, String> compToProject = new java.util.HashMap<>();
        int compsSkipped = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT component_id, out('IN_PRODUCT').code AS products FROM LoreComponent "
                + "WHERE out('IN_PRODUCT').size() > 0", Map.of())) {
            java.util.Set<String> targets = new java.util.HashSet<>();
            for (String p : distinctSlugs(r.get("products"))) {
                String proj = PRODUCT_TO_PROJECT.get(p);
                if (proj != null) targets.add(proj);
            }
            // Компонент, ведущий в два РАЗНЫХ проекта, пропускается: привязать
            // по нему значило бы выбрать за человека.
            if (targets.size() == 1) compToProject.put(String.valueOf(r.get("component_id")),
                targets.iterator().next());
            else if (targets.size() > 1) compsSkipped++;
        }
        LOG.infof("[LORE MIGRATE] V47: компонентов с однозначным проектом %d, "
            + "с расхождением %d (пропущены)", compToProject.size(), compsSkipped);

        int edges = 0;
        // Спеки и доки — компонент у них читается разными рёбрами, поэтому
        // запрос на каждый тип свой, а правило одно. Разбор пропусков печатает
        // сам linkByComponent: счётчики нужны там, где решение принимается.
        edges += linkByComponent("KnowSpec", "spec_id",
            "SELECT spec_id AS id, in('DOCUMENTED_IN').component_id AS c1, "
            + "out('BELONGS_TO').component_id AS c2 FROM KnowSpec "
            + "WHERE out('BELONGS_TO_PROJECT').size() = 0", compToProject);
        edges += linkByComponent("KnowDoc", "doc_id",
            "SELECT doc_id AS id, out('BELONGS_TO').component_id AS c1, "
            + "null AS c2 FROM KnowDoc WHERE out('BELONGS_TO_PROJECT').size() = 0 "
            + "AND (kind IS NULL OR kind <> 'claude-rules')", compToProject);

        // Ранбуки — через ADR. Своим путём, потому что компонента у них нет.
        int rbEdges = 0, rbSkipped = 0;
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT runbook_id, out('REFERENCES_ADR').out('BELONGS_TO_PROJECT').slug AS slugs "
                + "FROM KnowRunbook WHERE out('BELONGS_TO_PROJECT').size() = 0 "
                + "AND (area IS NULL OR area <> 'infra')", Map.of())) {
            java.util.Set<String> slugs = distinctSlugs(r.get("slugs"));
            if (slugs.size() != 1) { if (!slugs.isEmpty()) rbSkipped++; continue; }
            command("CREATE EDGE BELONGS_TO_PROJECT "
                + "FROM (SELECT FROM KnowRunbook WHERE runbook_id = :r) "
                + "TO (SELECT FROM KnowGitProject WHERE slug = :p) IF NOT EXISTS",
                Map.of("r", r.get("runbook_id"), "p", slugs.iterator().next()));
            rbEdges++;
        }
        LOG.infof("[LORE MIGRATE] V47 ранбуки через ADR: %d рёбер, %d с ADR разных проектов пропущено",
            rbEdges, rbSkipped);
        LOG.infof("[LORE MIGRATE] V47 ИТОГО: %d рёбер. Непривязанное остаётся видно "
            + "срезом scope_orphans — там же ручной остаток", edges + rbEdges);
    }

    /** Одна форма на спеки и доки: компонент → проект по готовой карте. */
    private int linkByComponent(String type, String idField, String sql,
                                Map<String, String> compToProject) {
        int edges = 0, ambiguous = 0, noRule = 0, noComp = 0;
        for (Map<String, Object> r : ingest.queryPublic(sql, Map.of())) {
            java.util.Set<String> comps = new java.util.HashSet<>();
            comps.addAll(distinctSlugs(r.get("c1")));
            comps.addAll(distinctSlugs(r.get("c2")));
            if (comps.isEmpty()) { noComp++; continue; }
            java.util.Set<String> targets = new java.util.HashSet<>();
            boolean unknown = false;
            for (String c : comps) {
                String proj = compToProject.get(c);
                if (proj == null) unknown = true; else targets.add(proj);
            }
            // Хотя бы один компонент без правила — пропускаем ВСЮ запись:
            // привязать по части компонентов значило бы отнести документ туда,
            // где он лишь частично живёт.
            if (unknown) { noRule++; continue; }
            if (targets.size() != 1) { ambiguous++; continue; }
            command("CREATE EDGE BELONGS_TO_PROJECT "
                + "FROM (SELECT FROM " + type + " WHERE " + idField + " = :i) "
                + "TO (SELECT FROM KnowGitProject WHERE slug = :p) IF NOT EXISTS",
                Map.of("i", r.get("id"), "p", targets.iterator().next()));
            edges++;
        }
        LOG.infof("[LORE MIGRATE] V47 %s: %d рёбер; пропущено — без компонента %d, "
            + "продукт без правила %d, компоненты в разные проекты %d",
            type, edges, noComp, noRule, ambiguous);
        return edges;
    }

    /**
     * RM-P12: приводит {@code valid_from} у *Hist к ISO-8601 UTC.
     *
     * <p>Идёт ДО объявления свойства (V42) — см. комментарий к шагу V41: SQL
     * шага выполняется раньше его javaStep, поэтому объявление и приведение
     * разнесены по двум шагам, а не сделаны одним.
     *
     * <p>Идемпотентен: канонические строки {@link #toIsoUtc} возвращает как
     * {@code null}, и такая строка не переписывается. Повторный прогон шага
     * (или его прогон на свежей БД, где приводить нечего) безвреден.
     *
     * <p>Неизвестная форма НЕ трогается и НЕ проглатывается: она попадает в
     * отдельный счётчик и в лог с примером. Молчаливый пропуск здесь был бы
     * тем же «пустой ответ вместо непроверенного», на котором в этом корпусе
     * уже обжигались: строка осталась бы кривой, а шаг отчитался бы успехом.
     */
    private void normalizeHistValidFrom() {
        for (String type : LoreSchemaMigrations.HIST_VALID_FROM_TEXT) {
            int seen = 0, fixed = 0, unknown = 0;
            String unknownSample = null;
            while (true) {
                List<Map<String, Object>> rows = ingest.queryPublic(
                    "SELECT @rid AS rid, valid_from FROM " + type
                    + " WHERE valid_from IS NOT NULL SKIP " + seen + " LIMIT 5000", Map.of());
                if (rows.isEmpty()) break;
                seen += rows.size();
                for (Map<String, Object> r : rows) {
                    Object raw = r.get("valid_from");
                    String iso = toIsoUtc(raw);
                    if (iso == null) {
                        if (!isCanonicalIsoUtc(raw)) {
                            unknown++;
                            if (unknownSample == null) unknownSample = String.valueOf(raw);
                        }
                        continue;
                    }
                    command("UPDATE " + r.get("rid") + " SET valid_from = :vf", Map.of("vf", iso));
                    fixed++;
                }
                if (rows.size() < 5000) break;
            }
            if (unknown > 0) {
                LOG.warnf("[LORE MIGRATE] V41 %s: %d из %d строк непонятной формы — оставлены как есть "
                    + "(пример: %s). Их valid_from по-прежнему не сравним с остальными.",
                    type, unknown, seen, unknownSample);
            }
            LOG.infof("[LORE MIGRATE] V41 %s: приведено %d из %d (непонятных %d)", type, fixed, seen, unknown);
        }
    }

    /** Уже канонический вид — переписывать нечего. */
    private static boolean isCanonicalIsoUtc(Object v) {
        return v instanceof String s && s.length() > 11 && s.charAt(10) == 'T' && s.endsWith("Z");
    }

    /**
     * Одно значение {@code valid_from} → ISO-8601 UTC, или {@code null}, если
     * переписывать не надо (уже канонично) либо не по чему (форма неизвестна).
     *
     * <p>Замеренные на проде 04.09.2026 виды и что с ними делаем:
     * <pre>
     *   "2026-08-31T12:34:56.789Z"     уже канон              → null
     *   "2026-06-11 22:26:41[.nnn]"    пробел вместо T, без Z → T + "Z"
     *   "2026-06-14"                   только дата            → полночь UTC
     *   "2026-06-23T18:19:56.359765"   ISO без зоны           → + "Z"
     *   1781569369738                  эпоха числом           → Instant
     * </pre>
     *
     * <p>Эпоха разбирается по разрядности, и это не педантизм: сессия шлюза
     * miniLORE прочитала ровно это значение как СЕКУНДЫ и получила 12.06.2026
     * вместо 16.06.2026 — ошибка в отчёте родилась из той же неоднозначности,
     * что и сам баг. Порог 1e11 разводит секунды (до 5138 года) и миллисекунды
     * (с 1973 года) без пересечения на любых живых датах.
     */
    static String toIsoUtc(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) {
            long l = n.longValue();
            return (l < 100_000_000_000L ? Instant.ofEpochSecond(l) : Instant.ofEpochMilli(l)).toString();
        }
        if (!(v instanceof String)) return null;
        String s = ((String) v).trim();
        if (s.length() == 10 && s.charAt(4) == '-' && s.charAt(7) == '-') return s + "T00:00:00Z";
        if (s.length() < 19 || s.charAt(4) != '-' || s.charAt(7) != '-') return null;
        char sep = s.charAt(10);
        if (sep != 'T' && sep != ' ') return null;
        if (sep == 'T' && s.endsWith("Z")) return null;              // канон
        String body = sep == ' ' ? s.substring(0, 10) + 'T' + s.substring(11) : s;
        return body.endsWith("Z") ? body : body + "Z";
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

    /**
     * NM-05: снять поле {@code component_id} с вершин (ADR-LORE-041 §2, шаг 5).
     *
     * <p><b>Единственный необратимый шаг.</b> До него обе правды держались
     * синхронно и работу можно было остановить где угодно; после него связь
     * живёт только ребром, и восстанавливать её будет неоткуда.
     *
     * <p><b>Шаг отказывается работать, если предусловие не выполнено.</b> Перед
     * снятием пересчитывается то же, что мерил срез расхождения: сколько записей
     * имеют непустое поле и НЕ имеют канонического ребра. Ненулевой остаток
     * означает, что связь существует только в поле — и снятие её сотрёт. Тогда
     * шаг падает и называет тип и число, а не снимает поле «раз уж дошли».
     *
     * <p>Это не перестраховка ради перестраховки: ровно такая проверка на
     * предыдущем шаге показала, что замер по спекам шёл по чужому ребру. Ошибка
     * там была правдоподобной и обнаружилась только счётом.
     *
     * <p><b>Контроль после.</b> Считаем рёбра до и после снятия: снятие поля не
     * имеет права трогать рёбра, и равенство этих чисел — единственное, что
     * отличает «поле снято» от «снесено вместе со связями».
     */
    private void dropComponentField() {
        // 1. Предусловие: ни одной записи, чья связь живёт ТОЛЬКО в поле.
        List<String> blocking = new ArrayList<>();
        int edgesBefore = 0;
        for (ComponentLink link : COMPONENT_FIELD_TYPES) {
            if (!typeExists(link.type())) continue;
            String side = (link.entityToComponent() ? "out('" : "in('") + link.edge() + "')";
            List<Map<String, Object>> orphan = ingest.queryPublic(
                "SELECT count(*) AS n FROM " + link.type()
                + " WHERE component_id IS NOT NULL AND component_id <> '' "
                + "AND " + side + ".size() = 0", Map.of());
            int n = orphan.isEmpty() ? 0 : ((Number) orphan.get(0).getOrDefault("n", 0)).intValue();
            if (n > 0) blocking.add(link.type() + ": " + n);

            List<Map<String, Object>> linked = ingest.queryPublic(
                "SELECT count(*) AS n FROM " + link.type() + " WHERE " + side + ".size() > 0", Map.of());
            edgesBefore += linked.isEmpty() ? 0 : ((Number) linked.get(0).getOrDefault("n", 0)).intValue();
        }
        if (!blocking.isEmpty()) {
            throw new IllegalStateException("[LORE MIGRATE] V34: снятие поля component_id ПРЕРВАНО — "
                + "есть записи, у которых связь существует только полем, и снятие её сотрёт: "
                + String.join("; ", blocking)
                + ". Сначала доберите рёбра (шаги V31/V33), затем повторите старт.");
        }

        // 2. Снятие. Свойство объявлено не у всех типов: у части оно жило как
        //    schemaless-значение. DROP PROPERTY у необъявленного свойства —
        //    ошибка, поэтому спрашиваем схему, а не гадаем.
        Set<String> declared = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT name, properties FROM schema:types", Map.of())) {
            String type = String.valueOf(r.get("name"));
            if (String.valueOf(r.get("properties")).contains("component_id")) declared.add(type);
        }

        int dropped = 0, cleared = 0;
        for (ComponentLink link : COMPONENT_FIELD_TYPES) {
            if (!typeExists(link.type())) continue;
            // Значения снимаются всегда: объявление свойства и наличие значений —
            // разные вещи, и schemaless-значение переживёт DROP PROPERTY.
            command("UPDATE " + link.type() + " REMOVE component_id", Map.of());
            cleared++;
            if (declared.contains(link.type())) {
                exec("DROP PROPERTY " + link.type() + ".component_id FORCE");
                dropped++;
            }
        }

        // 3. Контроль: рёбра не тронуты. Снятие поля не имеет права их менять,
        //    и это единственное, что отличает «поле снято» от «снесено вместе
        //    со связями».
        int edgesAfter = 0;
        for (ComponentLink link : COMPONENT_FIELD_TYPES) {
            if (!typeExists(link.type())) continue;
            String side = (link.entityToComponent() ? "out('" : "in('") + link.edge() + "')";
            List<Map<String, Object>> linked = ingest.queryPublic(
                "SELECT count(*) AS n FROM " + link.type() + " WHERE " + side + ".size() > 0", Map.of());
            edgesAfter += linked.isEmpty() ? 0 : ((Number) linked.get(0).getOrDefault("n", 0)).intValue();
        }
        if (edgesAfter != edgesBefore) {
            throw new IllegalStateException("[LORE MIGRATE] V34: число связанных записей изменилось "
                + "при снятии поля (" + edgesBefore + " → " + edgesAfter + "). Поле снимается, рёбра "
                + "трогать оно не должно — расхождение означает потерю связей.");
        }
        LOG.infof("[LORE MIGRATE] V34: поле component_id снято (значения у %d типов, объявление у %d); "
            + "связанных записей %d, до и после совпало", cleared, dropped, edgesAfter);
    }

    /** Поле задачи → роль на ребре. */
    private static final Map<String, String> ROLE_FIELDS = new LinkedHashMap<>(Map.of(
        "author_agent",   TaskRole.AUTHOR,
        "executor_agent", TaskRole.EXECUTOR,
        "reviewer_agent", TaskRole.REVIEWER));

    /**
     * TR-03: довести рёбра ролей до полей (ADR-LORE-042).
     *
     * <p><b>Шаг только ДОБАВЛЯЕТ.</b> Поля остаются нетронутыми: пока обе правды
     * держатся синхронно, работу можно остановить на любом шаге без потерь.
     * Снятие полей — отдельный шаг и последний.
     *
     * <p><b>Несопоставимое НЕ угадывается.</b> Сессии, проекты и проза (замер:
     * 438 записей) остаются в поле без ребра, и их число печатается по группам.
     * Ноль в этом счётчике был бы подозрителен — он означал бы, что шаг
     * сопоставил то, о чём решения не было.
     *
     * <p><b>Идемпотентность обязательна:</b> ledger пишется ПОСЛЕ java-части,
     * поэтому падение в середине даёт повторный прогон по частично обработанным
     * данным. Ребро ставится только там, где активного ребра этой роли ещё нет.
     */
    /**
     * V38: сохранить в примечание задачи те значения полей роли, которые НЕ
     * стали ребром, — перед тем как поля снять (TR-05).
     *
     * <p>Согласовано владельцем: «сохранить исходное значение в примечание».
     * Из 4159 заполненных значений таблица сопоставления и префиксное правило
     * покрывают 4035; оставшиеся 124 — это сессии, проекты, команды и составные
     * строки вроде «claude-full + соседняя сессия». Сопоставить их значило бы
     * записать догадку как факт, а снять поле без сохранения — потерять их
     * молча. Примечание не теряет ничего и остаётся на глазах у человека.
     *
     * <p>Сохраняются ТОЛЬКО непредставленные значения. Если у роли уже есть
     * открытое ребро, поле дублирует его, и переносить дубль в текст значило бы
     * засорить примечания тем, что и так читается.
     *
     * <p>Идемпотентность — по маркеру в тексте: повторный прогон видит свою же
     * пометку и не дописывает вторую. Матч строки истории по {@code @rid}, а не
     * по {@code state_uid}: у легаси-строк он null, и UPDATE по нему тихо
     * не находил бы ничего, отвечая при этом успехом.
     */
    private void preserveRoleFieldsIntoNote() {
        if (!typeExists("KnowTask")) {
            LOG.info("[LORE MIGRATE] V38: типа KnowTask нет — сохранять нечего");
            return;
        }
        final String marker = "<!-- roles-from-dropped-fields -->";
        int preserved = 0, alreadyEdge = 0, alreadyNoted = 0, noHistRow = 0;

        List<Map<String, Object>> tasks = ingest.queryPublic(
            "SELECT task_uid, author_agent, executor_agent, reviewer_agent FROM KnowTask "
            + "WHERE author_agent IS NOT NULL OR executor_agent IS NOT NULL "
            + "OR reviewer_agent IS NOT NULL", Map.of());

        for (Map<String, Object> t : tasks) {
            String uid = str(t.get("task_uid"));
            if (uid == null || uid.isBlank()) continue;

            List<String> lost = new ArrayList<>();
            for (Map.Entry<String, String> fr : ROLE_FIELDS.entrySet()) {
                String raw = str(t.get(fr.getKey()));
                if (raw == null || raw.isBlank()) continue;
                if (hasOpenRoleEdge(uid, fr.getValue())) { alreadyEdge++; continue; }
                lost.add(fr.getValue() + " = " + raw);
            }
            if (lost.isEmpty()) continue;

            List<Map<String, Object>> hist = ingest.queryPublic(
                "SELECT @rid AS rid, note_md FROM KnowTaskHist "
                + "WHERE in('HAS_STATE').task_uid[0] = :u AND valid_to IS NULL LIMIT 1",
                Map.of("u", uid));
            if (hist.isEmpty()) { noHistRow++; continue; }

            String note = str(hist.get(0).get("note_md"));
            if (note != null && note.contains(marker)) { alreadyNoted++; continue; }

            String addition = (note == null || note.isBlank() ? "" : note + "\n\n")
                + marker + "\n**Роли из снятых полей** (не сопоставлены с заявленными "
                + "личностями, сохранены при переходе на рёбра): " + String.join("; ", lost) + ".";
            command("UPDATE KnowTaskHist SET note_md = :n WHERE @rid = " + hist.get(0).get("rid"),
                Map.of("n", addition));
            preserved++;
        }

        LOG.infof("[LORE MIGRATE] V38: примечаний дописано %d, значений покрыто ребром %d, "
            + "уже помечено ранее %d, без открытой строки истории %d",
            preserved, alreadyEdge, alreadyNoted, noHistRow);

        if (noHistRow > 0) {
            // Молчать нельзя: у этих задач значение поля исчезнет вместе с полем,
            // и записать его оказалось некуда. Это не отказ шага, но и не норма.
            LOG.warnf("[LORE MIGRATE] V38: у %d задач нет ОТКРЫТОЙ строки истории — "
                + "их значения полей роли сохранить было НЕКУДА", noHistRow);
        }
    }

    /** Есть ли у задачи открытое ребро этой роли. */
    private boolean hasOpenRoleEdge(String taskUid, String role) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT count(*) AS n FROM ROLE_HELD_BY "
            + "WHERE @out.task_uid = :u AND role = :r AND valid_to IS NULL",
            Map.of("u", taskUid, "r", role));
        return !rows.isEmpty() && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0;
    }

    /**
     * V39: снять поля роли с KnowTask — последний шаг перехода на рёбра (TR-05).
     *
     * <p>Тем же порядком, что снятие поля компонента в V34, и по той же причине:
     * снятие безопасно ровно тогда, когда ни одна связь не живёт ТОЛЬКО полем.
     *
     * <h3>Предусловие, без которого шаг отказывается работать</h3>
     *
     * Значение поля роли считается сохранённым, если у роли есть открытое ребро
     * ЛИБО значение перенесено в примечание задачи шагом V38. Если найдётся
     * хоть одно, для которого неверно ни то, ни другое, шаг ПРЕРЫВАЕТСЯ и
     * называет число: снять поле в этом состоянии значит потерять данные молча.
     *
     * <p>Это не перестраховка. Ровно так V34 поймал бы восемь экранов без
     * компонента, если бы добор рёбер не отработал.
     *
     * <h3>Почему DROP идёт через java, а не строкой шага</h3>
     *
     * Сторож идемпотентности требует у SQL-стейтментов форму {@code IF NOT
     * EXISTS} или {@code UPSERT WHERE}; у DROP такой формы нет. Кроме того
     * свойство объявлено не у всех документов одинаково: часть значений живёт
     * schemaless и переживает {@code DROP PROPERTY}. Поэтому значения снимаются
     * отдельно от объявления — как в V34.
     */
    private void dropTaskRoleFields() {
        if (!typeExists("KnowTask")) {
            LOG.info("[LORE MIGRATE] V39: типа KnowTask нет — снимать нечего");
            return;
        }
        final String marker = "<!-- roles-from-dropped-fields -->";

        // 1. Предусловие: ничего, что живёт только полем.
        List<String> unsaved = new ArrayList<>();
        for (Map<String, Object> t : ingest.queryPublic(
                "SELECT task_uid, author_agent, executor_agent, reviewer_agent FROM KnowTask "
                + "WHERE author_agent IS NOT NULL OR executor_agent IS NOT NULL "
                + "OR reviewer_agent IS NOT NULL", Map.of())) {
            String uid = str(t.get("task_uid"));
            if (uid == null || uid.isBlank()) continue;
            for (Map.Entry<String, String> fr : ROLE_FIELDS.entrySet()) {
                String raw = str(t.get(fr.getKey()));
                if (raw == null || raw.isBlank()) continue;
                if (hasOpenRoleEdge(uid, fr.getValue())) continue;
                List<Map<String, Object>> hist = ingest.queryPublic(
                    "SELECT note_md FROM KnowTaskHist "
                    + "WHERE in('HAS_STATE').task_uid[0] = :u AND valid_to IS NULL LIMIT 1",
                    Map.of("u", uid));
                String note = hist.isEmpty() ? null : str(hist.get(0).get("note_md"));
                if (note == null || !note.contains(marker)) {
                    if (unsaved.size() < 20) unsaved.add(uid + "." + fr.getValue() + " = " + raw);
                    else if (unsaved.size() == 20) unsaved.add("…");
                }
            }
        }
        if (!unsaved.isEmpty()) {
            throw new IllegalStateException("[LORE MIGRATE] V39: снятие полей роли ПРЕРВАНО — "
                + "есть значения, которые не стали ребром и не сохранены в примечании, "
                + "снятие стёрло бы их молча: " + String.join("; ", unsaved)
                + ". Сначала отработайте шаг V38, затем повторите старт.");
        }

        // 2. Снятие. Значения убираем всегда, объявление — только где оно есть.
        Set<String> declared = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT name, properties FROM schema:types WHERE name = 'KnowTask'", Map.of())) {
            declared.add(String.valueOf(r.get("properties")));
        }
        String props = String.join(" ", declared);

        int edgesBefore = countRoleEdges();
        for (String field : ROLE_FIELDS.keySet()) {
            command("UPDATE KnowTask REMOVE " + field, Map.of());
            if (props.contains(field)) exec("DROP PROPERTY KnowTask." + field + " FORCE");
        }

        // 3. Контроль: рёбра не тронуты. Снятие поля не имеет права их менять,
        //    и это единственное, что отличает «поле снято» от «снесено вместе
        //    со связями».
        int edgesAfter = countRoleEdges();
        if (edgesAfter != edgesBefore) {
            throw new IllegalStateException("[LORE MIGRATE] V39: после снятия полей число рёбер роли "
                + "изменилось (" + edgesBefore + " → " + edgesAfter + ") — снятие задело связи");
        }
        LOG.infof("[LORE MIGRATE] V39: поля роли сняты, рёбер роли %d (не изменилось)", edgesAfter);
    }


    /**
     * V46 (AO-05): значения роли, сохранённые шагом V38 в примечаниях, становятся
     * рёбрами на единственного агента AGENT-FULL; исходная строка уезжает в
     * атрибут ребра {@code origin} — ДОСЛОВНО.
     *
     * <h3>Почему один агент и почему дословно</h3>
     *
     * Решение владельца 31.08.2026: «все агент full, атрибуты за тобой». Заявленная
     * агентная личность одна, значит на вопрос «кто» ответ один — включая
     * volva-team (похоже на команду) и ui-design (похоже на дисциплину): завести
     * под них личность значило бы повторить ошибку, из которой выросли 73
     * написания. Что различалось — ГДЕ работала сессия, и это кладётся в origin
     * как есть; «gateway-session ≈ серверная часть» — вывод, а не факт.
     *
     * <h3>Что считается</h3>
     *
     * В лог идёт число ЗНАЧЕНИЙ (рёбер), а не примечаний: расхождение «124 против
     * 123» родилось ровно на смешении этих единиц. Разбирается только блок V38 на
     * своей строке ({@link DroppedRoleNote}), метка в прозе не считается.
     *
     * <h3>Идемпотентность и отказ</h3>
     *
     * Ребро ставится только там, где для пары «задача + роль» открытого ребра нет;
     * повторный прогон ничего не добавляет. Блоки в примечаниях НЕ удаляются — это
     * след происхождения. Личности AGENT-FULL нет в графе — шаг ПРЕРЫВАЕТСЯ:
     * CREATE EDGE с пустым TO — тихий no-op, и «создано 0» выглядело бы успехом.
     */
    void backfillDroppedRoleNotes() {
        if (!typeExists("KnowTask")) {
            LOG.info("[LORE MIGRATE] V46: типа KnowTask нет — свежая БД, доводить нечего");
            return;
        }
        TaskRoleMapping.Target full = TaskRoleMapping.of("claude-full");
        if (full == null || !full.isAgent()) {
            throw new IllegalStateException("[LORE MIGRATE] V46: таблица сопоставления не знает "
                + "личность полного агента — шаг не может выбрать цель ребра");
        }
        final String agent = full.identity();
        List<Map<String, Object>> who = ingest.queryPublic(
            "SELECT count(*) AS n FROM KnowActor WHERE actor_id = :a", Map.of("a", agent));
        long present = who.isEmpty() ? 0 : ((Number) who.get(0).getOrDefault("n", 0)).longValue();
        if (present == 0) {
            List<Map<String, Object>> any = ingest.queryPublic(
                "SELECT count(*) AS n FROM KnowTaskHist WHERE valid_to IS NULL AND note_md LIKE :m",
                Map.of("m", "%" + DroppedRoleNote.MARKER + "%"));
            long candidates = any.isEmpty() ? 0 : ((Number) any.get(0).getOrDefault("n", 0)).longValue();
            if (candidates == 0) {
                LOG.infof("[LORE MIGRATE] V46: личности %s нет и блоков V38 нет — доводить нечего", agent);
                return;
            }
            throw new IllegalStateException("[LORE MIGRATE] V46: в графе НЕТ личности " + agent
                + ", а примечаний с блоком V38 — " + candidates
                + ". Ребро на отсутствующую вершину не создаётся молча; сначала заведите личность.");
        }

        String now = Instant.now().toString();
        int values = 0, created = 0, already = 0, notes = 0;
        Map<String, Integer> byOrigin = new LinkedHashMap<>();

        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT in('HAS_STATE').task_uid[0] AS task_uid, note_md FROM KnowTaskHist "
            + "WHERE valid_to IS NULL AND note_md LIKE :m",
            Map.of("m", "%" + DroppedRoleNote.MARKER + "%"));

        for (Map<String, Object> r : rows) {
            String uid = str(r.get("task_uid"));
            if (uid == null || uid.isBlank()) continue;
            List<DroppedRoleNote.Entry> entries = DroppedRoleNote.parse(str(r.get("note_md")));
            if (entries.isEmpty()) continue; // метка в прозе — не блок
            notes++;
            for (DroppedRoleNote.Entry e : entries) {
                values++;
                if (hasOpenRoleEdge(uid, e.role())) { already++; continue; }
                exec(String.format(
                    "CREATE EDGE ROLE_HELD_BY FROM (SELECT FROM KnowTask WHERE task_uid = '%s') "
                    + "TO (SELECT FROM KnowActor WHERE actor_id = '%s') "
                    + "SET role = '%s', valid_from = '%s', origin = '%s'",
                    esc(uid), esc(agent), esc(e.role()), now, esc(e.origin())));
                created++;
                byOrigin.merge(e.origin(), 1, Integer::sum);
            }
        }

        LOG.infof("[LORE MIGRATE] V46: значений в блоках %d (примечаний %d): рёбер на %s создано %d, "
            + "уже было %d", values, notes, agent, created, already);
        if (created > 0) {
            StringBuilder sb = new StringBuilder();
            int shown = 0;
            for (Map.Entry<String, Integer> o : byOrigin.entrySet()) {
                if (shown++ >= 40) { sb.append("…"); break; }
                sb.append(o.getKey()).append(" ×").append(o.getValue()).append("; ");
            }
            LOG.infof("[LORE MIGRATE] V46: origin по написаниям (%d): %s", byOrigin.size(), sb);
        }
    }
    private int countRoleEdges() {
        List<Map<String, Object>> r = ingest.queryPublic(
            "SELECT count(*) AS n FROM ROLE_HELD_BY WHERE valid_to IS NULL", Map.of());
        return r.isEmpty() ? 0 : ((Number) r.get(0).getOrDefault("n", 0)).intValue();
    }

    private void backfillTaskRoleEdges() {
        if (!typeExists("KnowTask")) {
            LOG.info("[LORE MIGRATE] V36: типа KnowTask нет — свежая БД, доводить нечего");
            return;
        }

        // Личности, на которые вообще можно сослаться. Спрашиваем граф, а не
        // доверяем таблице: если личность переименовали или снесли, ребро
        // молча не создастся (CREATE EDGE с пустым TO — тихий no-op), и мы
        // получили бы «добавлено 0» под видом успеха.
        Set<String> agents = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT actor_id FROM KnowActor", Map.of())) {
            String v = str(r.get("actor_id"));
            if (v != null) agents.add(v);
        }
        Set<String> users = new HashSet<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT display_name FROM KnowUser", Map.of())) {
            String v = str(r.get("display_name"));
            if (v != null) users.add(v);
        }

        String now = Instant.now().toString();
        int created = 0, already = 0, unmapped = 0, missingIdentity = 0;
        Map<String, Integer> unmappedByValue = new LinkedHashMap<>();

        List<Map<String, Object>> tasks = ingest.queryPublic(
            "SELECT task_uid, author_agent, executor_agent, reviewer_agent FROM KnowTask", Map.of());

        for (Map<String, Object> t : tasks) {
            String uid = str(t.get("task_uid"));
            if (uid == null || uid.isBlank()) continue;

            for (Map.Entry<String, String> fr : ROLE_FIELDS.entrySet()) {
                String raw = str(t.get(fr.getKey()));
                if (raw == null || raw.isBlank()) continue;

                TaskRoleMapping.Target target = TaskRoleMapping.of(raw);
                if (target == null) {
                    unmapped++;
                    unmappedByValue.merge(raw, 1, Integer::sum);
                    continue;
                }

                String vertexType = target.isAgent() ? "KnowActor" : "KnowUser";
                String keyField = target.isAgent() ? "actor_id" : "display_name";
                Set<String> known = target.isAgent() ? agents : users;
                if (!known.contains(target.identity())) {
                    // Личность из таблицы не найдена в графе. Молчать нельзя:
                    // ребро не создастся, а счётчик «добавлено» будет расти за
                    // счёт других строк и скроет пропажу.
                    missingIdentity++;
                    continue;
                }

                String role = fr.getValue();
                List<Map<String, Object>> exists = ingest.queryPublic(
                    "SELECT count(*) AS n FROM ROLE_HELD_BY "
                    + "WHERE @out.task_uid = :u AND role = :r AND valid_to IS NULL",
                    Map.of("u", uid, "r", role));
                long n = exists.isEmpty() ? 0 : ((Number) exists.get(0).getOrDefault("n", 0)).longValue();
                if (n > 0) { already++; continue; }

                StringBuilder set = new StringBuilder();
                set.append(" SET role = '").append(role).append('\'')
                   .append(", valid_from = '").append(now).append('\'');
                if (target.profile() != null) set.append(", profile = '").append(target.profile()).append('\'');
                if (target.model() != null)   set.append(", model = '").append(target.model()).append('\'');

                exec(String.format(
                    "CREATE EDGE ROLE_HELD_BY FROM (SELECT FROM KnowTask WHERE task_uid = '%s') "
                    + "TO (SELECT FROM %s WHERE %s = '%s')%s",
                    esc(uid), vertexType, keyField, esc(target.identity()), set));
                created++;
            }
        }

        LOG.infof("[LORE MIGRATE] V36: рёбер ролей создано %d, уже было %d, "
            + "не сопоставлено %d (значений %d), личность не найдена %d",
            created, already, unmapped, unmappedByValue.size(), missingIdentity);

        if (missingIdentity > 0) {
            // Это НЕ данные, а расхождение таблицы сопоставления с графом:
            // значение считалось однозначным, а цели нет. Громко, потому что
            // тихо оно выглядело бы как «нечего доводить».
            LOG.warnf("[LORE MIGRATE] V36: %d значений сопоставлены на личность, которой НЕТ в "
                + "графе — таблица TaskRoleMapping разошлась с реестром личностей", missingIdentity);
        }

        // Остаток печатается ПОИМЁННО и с числами: это рабочий список для
        // разбора, а не строка отчёта. Верхние 40 — чтобы лог оставался
        // читаемым; полный список даёт срез.
        int shown = 0;
        StringBuilder rest = new StringBuilder();
        for (Map.Entry<String, Integer> e : unmappedByValue.entrySet()) {
            if (shown++ >= 40) break;
            rest.append(e.getKey()).append(" ×").append(e.getValue()).append("; ");
        }
        LOG.infof("[LORE MIGRATE] V36: остались в поле (сессии, проекты, проза): %s", rest);
    }

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
        java.util.List<String> absentTypes = new java.util.ArrayList<>();
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
                absentTypes.add(ix.type() + "/" + ix.name());
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
        if (!absentTypes.isEmpty()) {
            // ОДНОЙ строкой, а не по строке на каждый пропуск.
            //
            // Раньше печаталось внутри цикла и на КАЖДЫЙ подъём приложения в
            // тестах: сотни одинаковых строк хоронили сообщения упавших
            // тестов, и причину красного прогона приходилось выводить из кода,
            // а не из лога. Печатать проверку так, чтобы её результат нельзя
            // было прочитать, — та же беда, что мы ловим в данных.
            //
            // Находка не заглушена: перечень здесь же и он полнее прежнего —
            // раньше имена были размазаны по сотням строк.
            LOG.warnf("[LORE MIGRATE] полнотекст: типов нет для %d индексов — %s",
                absentTypes.size(), String.join(", ", absentTypes));
        }

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

    /**
     * RM-P14: один бэкап на НАБОР непринятых шагов, а не на попытку старта.
     *
     * <p>Замерено 04.09.2026 на аварии стенда: шаг V43 падал, раннер намеренно
     * ронял старт, docker перезапускал контейнер — и каждый заход снова снимал
     * бэкап. За 15 минут накопился <b>51 бэкап на 1.2 ГБ</b>, все — копии
     * одного и того же состояния: упавший шаг ничего не записал, ledger не
     * тронут, между попытками база не менялась.
     *
     * <p>Множитель максимален там, где он опаснее всего. Ошибка в миграции —
     * это как раз долгая авария (разбор, правка, CI, выкат), и если она
     * случится при заполненном диске, к отказу миграции добавится отказ по
     * месту, а второй замаскирует первый.
     *
     * <p><b>Метка — файл в контейнере, а не запись в БД.</b> Её время жизни
     * должно совпадать с окном цикла перезапуска, и у файла оно совпадает
     * ТОЧНО: {@code docker restart} сохраняет слой записи, а выкат создаёт
     * контейнер заново и метку теряет. Метка в БД пережила бы и выкат — то
     * есть могла бы пропустить бэкап через неделю, когда данные уже другие.
     * Имя несёт версию схемы: применился хоть один шаг — версия сдвинулась,
     * метка перестала подходить, следующий бэкап снимется.
     *
     * <p>Не смогли прочитать или записать метку — снимаем бэкап. Лишняя копия
     * дешевле пропущенной.
     */
    private void backupOnceOrDie(int dbVersion) {
        java.nio.file.Path marker = java.nio.file.Path.of(
            System.getProperty("java.io.tmpdir", "/tmp"), ".lore-backup-v" + dbVersion);
        try {
            if (java.nio.file.Files.exists(marker)) {
                LOG.infof("[LORE MIGRATE] бэкап уже снят в этом контейнере для схемы v%d "
                    + "(%s) — повторный не снимаем: между попытками база не менялась", dbVersion, marker);
                return;
            }
        } catch (Exception e) {
            LOG.warnf("[LORE MIGRATE] метку бэкапа не прочитать (%s) — снимаем бэкап", e.getMessage());
        }
        backupOrDie();
        try {
            java.nio.file.Files.writeString(marker, Instant.now().toString());
        } catch (Exception e) {
            // Не записалась — следующий заход снимет бэкап снова. Это возврат к
            // прежнему поведению, а не поломка; говорим об этом вслух, чтобы
            // «опять 50 копий» не искали заново.
            LOG.warnf("[LORE MIGRATE] метку бэкапа не записать (%s) — при перезапуске "
                + "бэкап снимется повторно", e.getMessage());
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
