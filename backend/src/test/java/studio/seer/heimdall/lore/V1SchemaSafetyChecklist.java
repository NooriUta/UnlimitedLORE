package studio.seer.heimdall.lore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-07 — чек-лист аддитивности миграций для v1.
 *
 * <p><b>Почему.</b> v1 (папка {@code src/}, заморожена решением
 * D-2026-UXR-V2-FOLDER-V1-FROZEN) и v2 ходят в ОДНУ базу (ADR-LORE-045), а
 * любой {@code ./gradlew test} мигрирует общую схему. Шаг, который v2 считает
 * безобидным, может молча сломать v1: переименованное поле v1 перестанет
 * читать, NOT NULL на старом типе уронит запись v1, UNIQUE-индекс откажет её
 * дублям. Ловить это на стенде поздно — поэтому чек-лист проверяется в CI на
 * каждом шаге, появившемся ПОСЛЕ схемы, на которой v1 заморожен.
 *
 * <p><b>Пункты чек-листа</b> (для каждого шага с version &gt; {@link #V1_BASELINE_VERSION}):
 * <ol>
 *   <li>major совместимости не поднимается (иначе дрейф-гард откажет старту
 *       бинаря, собранного под v1);</li>
 *   <li>Java-шаг запрещён: он делает с данными что угодно, и разбором SQL его
 *       не проверить. Исключение — только именное, с причиной, в
 *       {@link #JAVA_STEPS_REVIEWED};</li>
 *   <li>разрешены ТОЛЬКО формы: новый тип / новое свойство / новый индекс,
 *       все с {@code IF NOT EXISTS}, и посев НОВОЙ строки справочника.
 *       Всё прочее (DROP, ALTER, RENAME, DELETE, TRUNCATE, произвольный UPDATE)
 *       — нарушение;</li>
 *   <li>на типах, существующих в v1, новое свойство не может быть
 *       MANDATORY / NOTNULL / READONLY, а новый индекс — UNIQUE: v1 о них не
 *       знает и начнёт получать отказы записи;</li>
 *   <li>свойство, уже объявленное в v1, нельзя «переобъявить» другим типом:
 *       {@code IF NOT EXISTS} сделает это no-op, и код v2 будет ждать тип,
 *       которого в базе нет;</li>
 *   <li>строку справочника, посеянную до v1, перезаписывать нельзя
 *       (UPSERT по той же паре dict_type+code поменял бы подписи v1).</li>
 * </ol>
 *
 * <p>Сам базис (шаги 1..{@value #V1_BASELINE_VERSION}) заморожен отпечатком:
 * правка уже выпущенного шага — это не аддитивность, а переписывание истории.
 */
final class V1SchemaSafetyChecklist {

    private V1SchemaSafetyChecklist() {}

    /** Последний шаг схемы, на которой заморожен v1 (develop 0d74e46d, 07.11.2026). */
    static final int V1_BASELINE_VERSION = 62;

    /**
     * Java-шаги после базиса, прошедшие ручной разбор на аддитивность.
     * Ключ — имя шага, значение — причина, почему он не задевает v1.
     * Пусто: в S2 Java-шагов нет. Добавлять строку только вместе с тестом,
     * доказывающим аддитивность именно этого шага.
     */
    static final Map<String, String> JAVA_STEPS_REVIEWED = Map.of(
        // S2-13, V68. Доказательство — StatusHistoryServiceTest
        // (backfill_writes_only_v67_properties_and_never_moves_version_dates):
        // UPDATE ставит только свойства V67 с условием «ещё не стоит»; INSERT
        // открывает версию лишь элементу без истории (v1 такие строки читает как
        // обычные версии без статуса); valid_from/valid_to существующих строк и
        // поля v1 не трогаются.
        "java__status_history_backfill",
        "только новые свойства V67 на открытых версиях + первая версия у элементов без истории",
        // S2-11, V71. Доказательство — StatusHistoryServiceTest
        // (task_backfill_opens_one_honest_version_for_tasks_without_history) и
        // LoreHistHygieneLiveDbTest: только INSERT первой версии задаче без
        // HAS_STATE, с условием «версий нет»; существующие строки не трогаются.
        "java__task_history_backfill",
        "только первая версия у задач без истории (INSERT, существующее не трогается)",
        // S7B-15, V76. Доказательство — LoreActorHarnessTest.backfillPlanAssignsOnlyUnambiguous:
        // UPDATE ставит только новое свойство V75 harness с условием «ещё не стоит»;
        // поля v1 не трогаются.
        "java__actor_harness_backfill",
        "только новое свойство V75 harness у агентов, где оно пусто и имя однозначно",
        // S2-11, V77. Доказательство — LoreHistHygieneLiveDbTest.sharedStateIsSplitByV77AndHistoryOfBothOwnersIsVisible:
        // INSERT копии версии (те же поля v1, новый state_uid) и перевод ребра HAS_STATE второго
        // владельца на копию; исходная версия и её первый владелец не меняются.
        "java__shared_state_split",
        "копия общей версии второму владельцу и перевод его ребра; исходная строка не меняется",
        // SPRINT_UXR_POLISH_UAT_1113/PU-18, V82. Доказательство — MachineCanonMergeLiveDbTest
        // (слияние + повтор без изменений) и MachineCanonMergeTest (план). Схема не меняется;
        // вершины/рёбра — типы V79 (KnowMachine, USES_MACHINE), v1 о них не знает; у
        // KnowActor.machine_id меняется только значение (регистр, адресная опечатка) — тип и
        // форма поля те же, v1 читает его как строку по-прежнему.
        "java__machine_id_canon",
        "слияние вершин V79 KnowMachine по регистру; значение KnowActor.machine_id → канон, схема не меняется");

    private static final Pattern CREATE_TYPE = Pattern.compile(
        "(?is)^\\s*CREATE\\s+(VERTEX|EDGE|DOCUMENT)\\s+TYPE\\s+`?(\\w+)`?\\s+IF\\s+NOT\\s+EXISTS(\\s+EXTENDS\\s+`?\\w+`?)?\\s*$");
    private static final Pattern CREATE_TYPE_ANY = Pattern.compile(
        "(?i)CREATE\\s+(?:VERTEX|EDGE|DOCUMENT)\\s+TYPE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?`?(\\w+)`?");

    /** CREATE PROPERTY T.p IF NOT EXISTS TYPE [OF X] [(constraints)] */
    private static final Pattern CREATE_PROPERTY = Pattern.compile(
        "(?is)^\\s*CREATE\\s+PROPERTY\\s+`?(\\w+)`?\\.`?(\\w+)`?\\s+IF\\s+NOT\\s+EXISTS\\s+(\\w+)(\\s+OF\\s+`?\\w+`?)?\\s*(\\(.*\\))?\\s*$");
    /** Тот же разбор, но и без IF NOT EXISTS — для базиса, где формы бывали разные. */
    private static final Pattern CREATE_PROPERTY_ANY = Pattern.compile(
        "(?is)^\\s*CREATE\\s+PROPERTY\\s+`?(\\w+)`?\\.`?(\\w+)`?\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(\\w+)");

    private static final Pattern CREATE_INDEX = Pattern.compile(
        "(?is)^\\s*CREATE\\s+INDEX\\s+(?:`?\\w+`?\\s+)?IF\\s+NOT\\s+EXISTS\\s+ON\\s+`?(\\w+)`?\\s*\\(([^)]*)\\)\\s*(\\w+)(\\s+.*)?$");

    private static final Pattern DICT_SEED = Pattern.compile(
        "(?is)^\\s*UPDATE\\s+KnowDictEntry\\s+SET\\s+.*\\s+UPSERT\\s+WHERE\\s+dict_type\\s*=\\s*'([^']+)'\\s+AND\\s+code\\s*=\\s*'([^']+)'\\s*$");

    private static final Pattern RISKY_CONSTRAINT = Pattern.compile(
        "(?i)\\b(MANDATORY|NOTNULL|READONLY)\\s+true\\b");

    /** Отпечаток базиса: version|major|name|checksum всех шагов ≤ базиса. */
    static String baselineFingerprint(List<LoreSchemaMigrations.Step> steps) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (LoreSchemaMigrations.Step s : steps) {
                if (s.version() > V1_BASELINE_VERSION) continue;
                md.update((s.version() + "|" + s.compatMajor() + "|" + s.name() + "|" + s.checksum() + "\n")
                    .getBytes(StandardCharsets.UTF_8));
            }
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder(16);
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** Схема v1, выведенная из шагов базиса: типы, свойства с типом, строки справочников. */
    record V1Schema(Set<String> types, Map<String, String> propertyTypes, Set<String> dictRows, int compatMajor) {}

    static V1Schema v1Schema(List<LoreSchemaMigrations.Step> steps) {
        Set<String> types = new LinkedHashSet<>();
        Map<String, String> props = new HashMap<>();
        Set<String> dict = new LinkedHashSet<>();
        int major = 0;
        for (LoreSchemaMigrations.Step s : steps) {
            if (s.version() > V1_BASELINE_VERSION) continue;
            major = Math.max(major, s.compatMajor());
            for (String sql : s.sql()) {
                Matcher t = CREATE_TYPE_ANY.matcher(sql);
                while (t.find()) types.add(t.group(1));
                Matcher p = CREATE_PROPERTY_ANY.matcher(sql);
                if (p.find()) props.putIfAbsent(p.group(1) + "." + p.group(2), p.group(3).toUpperCase());
                Matcher d = DICT_SEED.matcher(sql);
                if (d.matches()) dict.add(d.group(1) + "/" + d.group(2));
            }
        }
        return new V1Schema(types, props, dict, major);
    }

    /** Нарушения чек-листа в шагах после базиса; пустой список = v1 в безопасности. */
    static List<String> violations(V1Schema v1, List<LoreSchemaMigrations.Step> steps) {
        List<String> out = new ArrayList<>();
        // «Новый» тип — только тот, что создан шагом ПОСЛЕ базиса. Всё остальное
        // считается типом v1, включая созданные бутстрапом (LoreSchemaInitializer)
        // мимо реестра: незнакомое имя по умолчанию принадлежит v1, а не v2.
        Set<String> newTypes = new LinkedHashSet<>();
        for (LoreSchemaMigrations.Step s : steps) {
            if (s.version() <= V1_BASELINE_VERSION) continue;
            for (String sql : s.sql()) {
                Matcher t = CREATE_TYPE_ANY.matcher(sql);
                while (t.find()) if (!v1.types().contains(t.group(1))) newTypes.add(t.group(1));
            }
        }
        for (LoreSchemaMigrations.Step s : steps) {
            if (s.version() <= V1_BASELINE_VERSION) continue;
            String at = "V" + s.version() + " " + s.name() + ": ";
            if (s.compatMajor() != v1.compatMajor()) {
                out.add(at + "поднят major совместимости " + v1.compatMajor() + " → " + s.compatMajor()
                    + " — бинарь v1 откажет в старте");
            }
            if (s.name().startsWith("java__") && !JAVA_STEPS_REVIEWED.containsKey(s.name())) {
                out.add(at + "Java-шаг без разбора на аддитивность (JAVA_STEPS_REVIEWED)");
            }
            for (String sql : s.sql()) out.addAll(statementViolations(v1, newTypes, at, sql));
        }
        return out;
    }

    private static List<String> statementViolations(V1Schema v1, Set<String> newTypes, String at, String sql) {
        List<String> out = new ArrayList<>();
        String q = "«" + sql.strip() + "»";

        if (CREATE_TYPE.matcher(sql).matches()) return out;

        Matcher p = CREATE_PROPERTY.matcher(sql);
        if (p.matches()) {
            String type = p.group(1), key = type + "." + p.group(2), declared = p.group(3).toUpperCase();
            String constraints = p.group(5) == null ? "" : p.group(5);
            if (!newTypes.contains(type) && RISKY_CONSTRAINT.matcher(constraints).find()) {
                out.add(at + "ограничение на типе v1 " + type + " — запись v1 начнёт получать отказ: " + q);
            }
            String was = v1.propertyTypes().get(key);
            if (was != null && !was.equals(declared)) {
                out.add(at + key + " в v1 объявлено " + was + ", здесь " + declared
                    + " — IF NOT EXISTS сделает это no-op, код будет ждать не тот тип: " + q);
            }
            return out;
        }

        Matcher i = CREATE_INDEX.matcher(sql);
        if (i.matches()) {
            String type = i.group(1), kind = i.group(3).toUpperCase();
            if (kind.equals("UNIQUE") && !newTypes.contains(type)) {
                out.add(at + "UNIQUE-индекс на типе v1 " + type + " — v1 не знает о нём и упрётся в отказ записи: " + q);
            }
            return out;
        }

        Matcher d = DICT_SEED.matcher(sql);
        if (d.matches()) {
            String row = d.group(1) + "/" + d.group(2);
            if (v1.dictRows().contains(row)) {
                out.add(at + "перезапись строки справочника v1 " + row + " — подписи v1 поменяются: " + q);
            }
            return out;
        }

        out.add(at + "неаддитивная или нераспознанная форма (разрешены только CREATE TYPE/PROPERTY/INDEX "
            + "IF NOT EXISTS и посев новой строки справочника): " + q);
        return out;
    }
}
