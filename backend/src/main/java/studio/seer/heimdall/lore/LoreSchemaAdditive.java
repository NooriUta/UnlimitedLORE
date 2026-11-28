package studio.seer.heimdall.lore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Доводка схемы кода — ЕДИНСТВЕННЫЙ путь изменений схемы после 1.18 (владелец 25.11.2026: «доделай из модели и
 * подчисти версионирование, а то следующие будут тоже делать»).
 *
 * <h2>Почему</h2>
 * С 1.18 база прода собрана ИЗ МОДЕЛИ (отметка LoreModelSchema, MIG-01/MIG-03): журнала шагов V у неё нет, и шаги V на
 * неё не катятся по построению — они писали бы старую схему поверх новой. А после 1.18 схему продолжали менять шагами
 * V94–V100 (реестр видов KnowKind, поля супертегов, KnowSkill и его рёбра, посев скиллов и областей). На прод и препрод
 * (копию прода) это не доезжало молча: шаг накатки CD писал «накатывать нечего», live-check был зелёным на пустой
 * накатке.
 *
 * <h2>Правило</h2>
 * Новое изменение схемы — тип, поле, индекс, ребро, посев справочника — это запись в {@link #CHANGES} (и подъём
 * {@link #VERSION} с закреплением хэша в {@link #PINNED}). Новых шагов V нет: реестр шагов заморожен на
 * {@link #LAST_V_STEP} (сторож {@code LoreSchemaAdditiveGuardTest}). Доводка одна для всех баз:
 * <ul>
 *   <li>база из модели — шаг накатки CD (lore.migrate.only) и старт с правами на схему (basic);</li>
 *   <li>база шагов V (стенды разработки, тестовые базы) — после шагов V тем же раннером;</li>
 *   <li>свежая установка — установщик собирает базу из модели, дальше как база из модели.</li>
 * </ul>
 *
 * <h2>Что доводка может</h2>
 * Только добавлять: {@code CREATE … IF NOT EXISTS} (тип, свойство, индекс, ребро) и посев «только недостающее»
 * (как {@link StatusDictCoreSeed#plan}). Ничего не удаляет, не переименовывает и не переписывает — правка или снос
 * данных доводкой не делается (это решение с бэкапом и отдельным ADR, не строка в списке). Повтор — ноль изменений.
 *
 * <h2>Отметка</h2>
 * После доводки в базе лежит одна запись {@link #MARKER_TYPE}: номер и хэш схемы кода, какие записи доводки
 * применены. Отметка переписывается, только если номер/хэш сменились — повтор её не трогает. {@code /lore/version}
 * показывает {@code code_schema_version} базы рядом с {@code code_schema_expected} кода.
 */
final class LoreSchemaAdditive {

    private LoreSchemaAdditive() {}

    /**
     * Номер схемы кода. Поднимать при КАЖДОМ изменении {@link #CHANGES} и закреплять новый хэш в {@link #PINNED}
     * (сторож хэша — как у номера модели: «схема сменилась, а номер тот же» — красный).
     */
    static final int VERSION = 7;

    /** Номер → хэш доводки. Прежние номера не правятся: их отметка уже лежит в базах. */
    static final Map<Integer, String> PINNED = Map.of(
        1, "54761523d90deed8",
        2, "1fb90ce03ae56244",
        3, "7f859c257fe15414",
        4, "8db786982331b847",
        5, "a4b19c3f6c60ca04",
        6, "e12f8d031ca6b863",
        7, "dc3748d7fc58f177");

    /** Последний шаг V. Реестр шагов заморожен: новое — только в {@link #CHANGES}. */
    static final int LAST_V_STEP = 100;

    /** Тип отметки схемы кода (одна запись). */
    static final String MARKER_TYPE = "LoreCodeSchema";

    /** Исполнитель SQL: раннер — REST ArcadeDB, тест — встроенная ArcadeDB. */
    @FunctionalInterface
    interface Sql {
        List<Map<String, Object>> run(String sql, Map<String, Object> params);
    }

    /** Посев: вставляет только недостающее, возвращает число вставленных записей. */
    @FunctionalInterface
    interface Seed {
        int apply(Sql sql);
    }

    /**
     * Запись доводки. {@code ddl} — только {@code CREATE … IF NOT EXISTS}; {@code seed} — посев «только недостающее»
     * или null; {@code seedFingerprint} — содержимое посева словами (входит в хэш: новая статья посева — новый номер).
     */
    record Change(String id, String why, List<String> ddl, String seedFingerprint, Seed seed) {}

    // ── V94 · SPRINT_LORE_KNOW_REGISTRY/KREG-01: реестр видов KnowKind + история KnowKindHist ──────────────
    // Подробности — у шага V94 (LoreSchemaMigrations). Тот же список — DDL шага V94 и зеркало инициализатора.
    static final List<String> KNOW_KIND_DDL = List.of(
        "CREATE VERTEX TYPE KnowKind IF NOT EXISTS",
        "CREATE PROPERTY KnowKind.kind      IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowKind.id_field  IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowKind.title     IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowKind.fields    IF NOT EXISTS LIST",
        "CREATE PROPERTY KnowKind.links     IF NOT EXISTS LIST",
        "CREATE PROPERTY KnowKind.guards    IF NOT EXISTS LIST",
        "CREATE PROPERTY KnowKind.roles     IF NOT EXISTS LIST",
        "CREATE PROPERTY KnowKind.replaces  IF NOT EXISTS LIST",
        "CREATE PROPERTY KnowKind.source    IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowKind.lifecycle IF NOT EXISTS MAP",
        "CREATE INDEX IF NOT EXISTS ON KnowKind (kind) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowKind (source) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowKind (replaces) NOTUNIQUE",
        "CREATE VERTEX TYPE KnowKindHist IF NOT EXISTS",
        "CREATE PROPERTY KnowKindHist.valid_from    IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowKindHist.valid_to      IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowKindHist.content_hash  IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowKindHist.changed_by IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowKindHist.changed_by_kind IF NOT EXISTS STRING");

    // ── V95 · SKILL-05: поля супертегов KnowTag ─────────────────────────────────────────────────────────
    static final List<String> KNOWTAG_SUPERTAG_DDL = List.of(
        "CREATE PROPERTY KnowTag.name         IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowTag.title        IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowTag.source       IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowTag.field_schema IF NOT EXISTS MAP",
        "CREATE PROPERTY KnowTag.synonyms     IF NOT EXISTS LIST OF STRING",
        "CREATE PROPERTY KnowTag.owner        IF NOT EXISTS STRING");

    // ── V96 · SKILL-01/02: вид skill:* — KnowSkill и рёбра APPLIES_TO_ROLE, SKILL_EXTENDS ───────────────
    static final List<String> KNOW_SKILL_DDL = List.of(
        "CREATE VERTEX TYPE KnowSkill IF NOT EXISTS",
        "CREATE PROPERTY KnowSkill.skill_id   IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.name       IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.title      IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.body_md    IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.version    IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.status     IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.source     IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.created_at IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowSkill.updated_at IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowSkill (skill_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON KnowSkill (status) NOTUNIQUE",
        "CREATE EDGE TYPE APPLIES_TO_ROLE IF NOT EXISTS",
        "CREATE EDGE TYPE SKILL_EXTENDS IF NOT EXISTS");

    // ── V97 · SKILL-01/03: концы рёбер посева скиллов. На базе шагов V они есть с V20/V30-х; база из модели заводит
    // связи модели, но доводка не полагается на это — ребро посева без типа упало бы.
    static final List<String> SKILL_SEED_EDGES_DDL = List.of(
        "CREATE EDGE TYPE BELONGS_TO_PROJECT IF NOT EXISTS",
        "CREATE EDGE TYPE OWNED_BY IF NOT EXISTS");

    // ── v2 · SPRINT_QG_REBUILD/QG-07: «база» метрики прогона — отпечаток знаменателя (выборка, фильтр, LIMIT). ─────
    // task_done_pct_avg «упала» 99.1% → 78.1% без регресса: было LIMIT 15 спринтов, стало 357 групп. Сравнение с прошлым
    // прогоном честно только при той же базе (src/lib/qgBasis.ts); пишет LoreQgRunWriter, читает срез qg_run_metrics.
    // Тип ClRoutineMetric в модели есть; IF NOT EXISTS — чтобы доводка не полагалась на это (как концы рёбер посева).
    static final List<String> QG_METRIC_BASIS_DDL = List.of(
        "CREATE VERTEX TYPE ClRoutineMetric IF NOT EXISTS",
        "CREATE PROPERTY ClRoutineMetric.basis IF NOT EXISTS STRING");

    // ── v6 · ADR-LORE-066 фаза А: релиз принадлежит репозиторию — ребро KnowRelease → KnowRepository. ─────────────
    // Ставит миграция release-of-repository (LoreReleaseRepositoryMigration); рёбра BELONGS_TO_PROJECT пока остаются.
    static final List<String> RELEASE_OF_DDL = List.of(
        "CREATE EDGE TYPE RELEASE_OF IF NOT EXISTS");

    // ── v7 · ADR-LORE-066 фаза А: PR принадлежит репозиторию — ребро KnowPR → KnowRepository. Репозиторий PR
    // однозначен из его адреса (…/owner/repo/pulls/N); ставит миграция release-of-repository и сверщик PR.
    static final List<String> PR_OF_DDL = List.of(
        "CREATE EDGE TYPE PR_OF IF NOT EXISTS");

    // ── v4 · SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE (1а): свой стиль — статья palette с JSON токенов. Поле и в истории
    // словаря: правка своего стиля — такая же версия статьи, как правка подписи (AL-43). Посев — подписи шести наших
    // палитр (SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS, 5а).
    static final List<String> APPEARANCE_DDL = List.of(
        "CREATE PROPERTY KnowDictEntry.tokens_json IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowDictEntryHist.tokens_json IF NOT EXISTS STRING");

    // ── v5 · SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (владелец 25.11.2026 «историчность доделываем»): SCD2-история боли,
    // выгоды, работы, роли продукта и фичи — по образцу KnowKindHist/KnowDocHist. Цепочка — <Вершина>Hist через HAS_STATE,
    // поля времени DATETIME (RM-P13), автор версии (S2-12), снимок полей версии (ProductHistory.SPECS). Объявления типа и
    // времени — литералами (их читают сторожа реестров valid_from по тексту корпуса), остальные поля — из той же таблицы,
    // что у записи и посева. Посев — начальная версия «как есть» у записей без истории (ProductHistory.seed).
    private static final List<String> PRODUCT_HIST_HEAD = List.of(
        "CREATE EDGE TYPE HAS_STATE IF NOT EXISTS",
        "CREATE VERTEX TYPE KnowPainHist IF NOT EXISTS",
        "CREATE PROPERTY KnowPainHist.valid_from IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowPainHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE VERTEX TYPE KnowGainHist IF NOT EXISTS",
        "CREATE PROPERTY KnowGainHist.valid_from IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowGainHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE VERTEX TYPE KnowJobHist IF NOT EXISTS",
        "CREATE PROPERTY KnowJobHist.valid_from IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowJobHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE VERTEX TYPE KnowProjectActorHist IF NOT EXISTS",
        "CREATE PROPERTY KnowProjectActorHist.valid_from IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowProjectActorHist.valid_to IF NOT EXISTS DATETIME",
        "CREATE VERTEX TYPE KnowUseCaseHist IF NOT EXISTS",
        "CREATE PROPERTY KnowUseCaseHist.valid_from IF NOT EXISTS DATETIME",
        "CREATE PROPERTY KnowUseCaseHist.valid_to IF NOT EXISTS DATETIME");

    /** Служебные поля версии у каждой новой цепочки: ключ, версия, хэш снимка, автор (ChangeAuthor.SET_SQL). */
    private static final List<String> HIST_SERVICE_FIELDS = List.of("state_uid", "content_hash", "changed_by", "changed_by_kind",
        "changed_by_session", "changed_by_harness", "changed_by_harness_note", "changed_by_machine");

    static final List<String> PRODUCT_HIST_DDL = productHistDdl();

    private static List<String> productHistDdl() {
        List<String> out = new ArrayList<>(PRODUCT_HIST_HEAD);
        for (ProductHistory.Spec s : ProductHistory.SPECS) {
            String h = s.hist();
            out.add("CREATE PROPERTY " + h + "." + s.key() + " IF NOT EXISTS STRING");
            for (String f : HIST_SERVICE_FIELDS) out.add("CREATE PROPERTY " + h + "." + f + " IF NOT EXISTS STRING");
            for (String f : s.fields()) out.add("CREATE PROPERTY " + h + "." + f + " IF NOT EXISTS STRING");
            out.add("CREATE INDEX IF NOT EXISTS ON " + h + " (state_uid) UNIQUE");
            out.add("CREATE INDEX IF NOT EXISTS ON " + h + " (valid_to) NOTUNIQUE");
            out.add("CREATE INDEX IF NOT EXISTS ON " + h + " (" + s.key() + ") NOTUNIQUE");
        }
        return List.copyOf(out);
    }

    /** Записи доводки по порядку применения. Новое изменение схемы — сюда (и VERSION + PINNED). */
    static final List<Change> CHANGES = List.of(
        new Change("know_kind_registry", "SPRINT_LORE_KNOW_REGISTRY/KREG-01 (бывш. V94): реестр видов KnowKind + KnowKindHist",
            KNOW_KIND_DDL, null, null),
        new Change("knowtag_supertag_fields", "SPRINT_LORE_KNOW_REGISTRY/SKILL-05 (бывш. V95): поля супертегов KnowTag",
            KNOWTAG_SUPERTAG_DDL, null, null),
        new Change("know_skill", "SPRINT_LORE_KNOW_REGISTRY/SKILL-01/02 (бывш. V96): KnowSkill, APPLIES_TO_ROLE, SKILL_EXTENDS",
            KNOW_SKILL_DDL, null, null),
        new Change("skill_seed", "SPRINT_LORE_KNOW_REGISTRY/SKILL-01/03 (бывш. V97): словарь skill_status и три посевных скилла",
            SKILL_SEED_EDGES_DDL, fingerprint(SkillSeed.DICT_SEEDS) + "|" + SkillSeed.SKILLS + "|" + SkillSeed.OWNER_LOGIN,
            LoreSchemaAdditive::seedSkills),
        new Change("area_dict_seed", "SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS (бывш. V100): статьи словаря area",
            List.of(), fingerprint(AreaDictSeed.SEEDS), LoreSchemaAdditive::seedAreas),
        new Change("qg_metric_basis", "SPRINT_QG_REBUILD/QG-07 (доводка v2): ClRoutineMetric.basis — отпечаток знаменателя метрики прогона",
            QG_METRIC_BASIS_DDL, null, null),
        new Change("ui_dict_seed", "SPRINT_LORE_EXT_ISSUES_W2/ISS-02-DICT-SEED-GUARD (доводка v3): словари task_type, priority, agent_profile, которые читает UI",
            List.of(), fingerprint(UiDictSeed.SEEDS) + "|" + new TreeMap<>(UiDictSeed.SYNONYMS.getOrDefault("priority", Map.of())),
            LoreSchemaAdditive::seedUiDicts),
        new Change("appearance", "SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE + SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS (доводка v4): "
                + "tokens_json своего стиля, подписи шести палитр; task_type ui_dict_seed — на токенах темы",
            APPEARANCE_DDL, fingerprint(PaletteDictSeed.SEEDS), LoreSchemaAdditive::seedPalettes),
        new Change("product_history", "SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (доводка v5): SCD2-история боли, выгоды, работы, "
                + "роли продукта и фичи — KnowPainHist, KnowGainHist, KnowJobHist, KnowProjectActorHist, KnowUseCaseHist; "
                + "начальная версия «как есть» у записей без истории",
            PRODUCT_HIST_DDL, ProductHistory.fingerprint(), sql -> ProductHistory.seed(sql, typeNames(sql))),
        new Change("release_of_repository", "ADR-LORE-066 фаза А (доводка v6): ребро RELEASE_OF — релиз принадлежит репозиторию",
            RELEASE_OF_DDL, null, null),
        new Change("pr_of_repository", "ADR-LORE-066 фаза А (доводка v7): ребро PR_OF — PR принадлежит репозиторию",
            PR_OF_DDL, null, null));

    /** Шаги V после модели 1.18 → запись доводки, которая несёт то же самое на базу из модели. */
    static final Map<Integer, String> FROM_V_STEPS = Map.of(
        94, "know_kind_registry",
        95, "knowtag_supertag_fields",
        96, "know_skill",
        97, "skill_seed",
        100, "area_dict_seed");

    static Change change(String id) {
        for (Change c : CHANGES) if (c.id().equals(id)) return c;
        return null;
    }

    /** Итог доводки: сколько заведено типов, свойств, индексов и вставлено записей посевом. */
    record Report(int types, int properties, int indexes, int seeded, List<String> changes) {
        boolean changed() { return types + properties + indexes + seeded > 0; }
    }

    // ── хэш ─────────────────────────────────────────────────────────────────────────────────────────────

    /** Хэш доводки: id, DDL и содержимое посевов всех записей по порядку; 16 hex. */
    static String hash() {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (Change c : CHANGES) {
                md.update(("#" + c.id() + "\n").getBytes(StandardCharsets.UTF_8));
                for (String q : c.ddl()) md.update((q + "\n").getBytes(StandardCharsets.UTF_8));
                if (c.seedFingerprint() != null) md.update(("seed:" + c.seedFingerprint() + "\n").getBytes(StandardCharsets.UTF_8));
            }
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder(16);
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Содержимое посева словами в стабильном порядке (Map.of итерируется в случайном порядке от запуска к запуску). */
    static String fingerprint(Map<String, List<StatusDictCoreSeed.Entry>> seeds) {
        return new TreeMap<>(seeds).toString();
    }

    // ── разбор DDL ──────────────────────────────────────────────────────────────────────────────────────

    private static final Pattern CREATE_TYPE = Pattern.compile("(?i)^\\s*CREATE\\s+(?:VERTEX|EDGE|DOCUMENT)\\s+TYPE\\s+(\\w+)");
    private static final Pattern CREATE_PROPERTY = Pattern.compile("(?i)^\\s*CREATE\\s+PROPERTY\\s+(\\w+)\\.(\\w+)");
    private static final Pattern CREATE_INDEX = Pattern.compile("(?i)^\\s*CREATE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+ON\\s+(\\w+)\\s*\\(([^)]*)\\)");

    /** Типы и рёбра, которые заводит доводка. */
    static Set<String> createdTypes() {
        Set<String> out = new LinkedHashSet<>();
        for (Change c : CHANGES)
            for (String q : c.ddl()) {
                Matcher m = CREATE_TYPE.matcher(q);
                if (m.find()) out.add(m.group(1));
            }
        return out;
    }

    // ── применение ──────────────────────────────────────────────────────────────────────────────────────

    /**
     * Довести схему базы до кода: недостающие типы/свойства/индексы — создать, посевы — только недостающее, отметку —
     * записать, если номер/хэш сменились. Упавший стейтмент — исключение с контекстом (запись доводки + стейтмент):
     * «схема наполовину доведена» хуже отказа, а повтор безопасен.
     */
    static Report apply(Sql sql) {
        int types = 0, props = 0, idx = 0, seeded = 0;
        List<String> touched = new ArrayList<>();
        Set<String> haveTypes = typeNames(sql);
        for (Change c : CHANGES) {
            int before = types + props + idx + seeded;
            for (String q : c.ddl()) {
                try {
                    Matcher t = CREATE_TYPE.matcher(q), p = CREATE_PROPERTY.matcher(q), i = CREATE_INDEX.matcher(q);
                    if (t.find()) {
                        if (haveTypes.contains(t.group(1))) continue;
                        sql.run(q, Map.of());
                        haveTypes.add(t.group(1));
                        types++;
                    } else if (p.find()) {
                        if (propertyNames(sql, p.group(1)).contains(p.group(2))) continue;
                        sql.run(q, Map.of());
                        props++;
                    } else if (i.find()) {
                        List<String> fields = splitFields(i.group(2));
                        if (indexExists(sql, i.group(1), fields)) continue;
                        sql.run(q, Map.of());
                        idx++;
                    } else {
                        throw new IllegalStateException("стейтмент доводки не распознан (только CREATE TYPE/PROPERTY/INDEX … IF NOT EXISTS)");
                    }
                } catch (RuntimeException e) {
                    throw new IllegalStateException("[LORE ADDITIVE] " + c.id() + " упал на «" + q + "»: " + e.getMessage(), e);
                }
            }
            if (c.seed() != null) {
                try {
                    seeded += c.seed().apply(sql);
                } catch (RuntimeException e) {
                    throw new IllegalStateException("[LORE ADDITIVE] посев " + c.id() + " упал: " + e.getMessage(), e);
                }
            }
            if (types + props + idx + seeded > before) touched.add(c.id());
        }
        writeMarker(sql);
        return new Report(types, props, idx, seeded, List.copyOf(touched));
    }

    private static Set<String> typeNames(Sql sql) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> r : sql.run("SELECT name FROM schema:types", Map.of()))
            if (r.get("name") != null) out.add(String.valueOf(r.get("name")));
        return out;
    }

    private static Set<String> propertyNames(Sql sql, String type) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> r : sql.run("SELECT properties FROM schema:types WHERE name = :t", Map.of("t", type)))
            if (r.get("properties") instanceof Iterable<?> it)
                for (Object p : it) { String n = nameOf(p); if (n != null) out.add(n); }
        return out;
    }

    /** Индекс типа на этих полях: имя индекса типа в ArcadeDB — {@code Тип[поле,поле]}. */
    private static boolean indexExists(Sql sql, String type, List<String> fields) {
        String name = type + "[" + String.join(",", fields) + "]";
        for (Map<String, Object> r : sql.run("SELECT name FROM schema:indexes", Map.of()))
            if (name.equals(String.valueOf(r.get("name")))) return true;
        return false;
    }

    private static List<String> splitFields(String raw) {
        List<String> out = new ArrayList<>();
        for (String s : raw.split(",")) { String t = s.trim(); if (!t.isEmpty()) out.add(t); }
        return out;
    }

    /** Имя свойства из строки schema:types: по REST — Map, во встроенном движке — Result (getProperty). */
    private static String nameOf(Object p) {
        if (p == null) return null;
        if (p instanceof Map<?, ?> m) return m.get("name") == null ? null : String.valueOf(m.get("name"));
        try {
            Object v = p.getClass().getMethod("getProperty", String.class).invoke(p, "name");
            return v == null ? null : String.valueOf(v);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    // ── отметка ─────────────────────────────────────────────────────────────────────────────────────────

    /** Номер схемы кода, до которого доведена база; доводки не было — null (не 0 и не ошибка). */
    static Integer appliedVersion(Sql sql) {
        if (!typeNames(sql).contains(MARKER_TYPE)) return null;
        List<Map<String, Object>> rows = sql.run("SELECT version FROM " + MARKER_TYPE, Map.of());
        return rows.isEmpty() || !(rows.get(0).get("version") instanceof Number n) ? null : n.intValue();
    }

    /** Отметка: заводится и переписывается, только если номер или хэш сменились; повтор её не трогает. */
    private static void writeMarker(Sql sql) {
        if (!typeNames(sql).contains(MARKER_TYPE)) sql.run("CREATE VERTEX TYPE " + MARKER_TYPE + " IF NOT EXISTS", Map.of());
        List<Map<String, Object>> rows = sql.run("SELECT version, hash FROM " + MARKER_TYPE, Map.of());
        String h = hash();
        if (rows.size() == 1 && rows.get(0).get("version") instanceof Number n && n.intValue() == VERSION && h.equals(rows.get(0).get("hash")))
            return;
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("v", VERSION);
        p.put("h", h);
        p.put("c", CHANGES.stream().map(Change::id).toList());
        p.put("t", Instant.now().toString());
        if (rows.isEmpty()) sql.run("INSERT INTO " + MARKER_TYPE + " SET version = :v, hash = :h, changes = :c, applied_at = :t", p);
        else sql.run("UPDATE " + MARKER_TYPE + " SET version = :v, hash = :h, changes = :c, applied_at = :t", p);
    }

    // ── посевы ──────────────────────────────────────────────────────────────────────────────────────────

    private static Set<String> codesOf(Sql sql, String dictType) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> r : sql.run(StatusDictCoreSeed.EXISTING_SQL, Map.of("dict_type", dictType)))
            if (r.get("code") != null) out.add(String.valueOf(r.get("code")));
        return out;
    }

    /**
     * Бывш. V97 (SKILL-01 + SKILL-03): словарь skill_status и посевные скиллы — только недостающее. Ребро ставится,
     * лишь когда его конец есть в базе: на свежей базе без проекта или роли скилл остаётся висяком, и это видит
     * QG-инвариант «висяк = 0» (KREG-06), а не молчание. Возвращает число вставленных записей (словарь + скиллы).
     */
    static int seedSkills(Sql sql) {
        Map<String, Set<String>> existing = new LinkedHashMap<>();
        for (String dict : SkillSeed.DICT_SEEDS.keySet()) existing.put(dict, codesOf(sql, dict));
        List<StatusDictCoreSeed.Insert> dictPlan = StatusDictCoreSeed.plan(SkillSeed.DICT_SEEDS, existing);
        for (StatusDictCoreSeed.Insert i : dictPlan) sql.run(StatusDictCoreSeed.INSERT_SQL, i.params());
        Set<String> have = new HashSet<>();
        for (Map<String, Object> r : sql.run(SkillSeed.EXISTING_SQL, Map.of()))
            if (r.get("skill_id") != null) have.add(String.valueOf(r.get("skill_id")));
        List<SkillSeed.Skill> plan = SkillSeed.plan(have);
        String now = Instant.now().toString();
        boolean owner = !plan.isEmpty() && !sql.run("SELECT @rid FROM KnowUser WHERE login = :login LIMIT 1",
            Map.of("login", SkillSeed.OWNER_LOGIN)).isEmpty();
        for (SkillSeed.Skill s : plan) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("skill_id", s.skillId()); p.put("name", s.name()); p.put("title", s.title());
            p.put("version", s.version()); p.put("status", s.status()); p.put("source", s.source());
            p.put("body_md", s.bodyMd()); p.put("now", now);
            sql.run(SkillSeed.INSERT_SQL, p);
            for (String slug : s.projects()) {
                if (sql.run("SELECT @rid FROM KnowGitProject WHERE slug = :slug LIMIT 1", Map.of("slug", slug)).isEmpty()) continue;
                sql.run(SkillSeed.PROJECT_EDGE_SQL, Map.of("skill_id", s.skillId(), "slug", slug));
            }
            for (String code : s.roles()) {
                if (sql.run("SELECT @rid FROM KnowDictEntry WHERE dict_type = 'agent_profile' AND code = :code LIMIT 1",
                    Map.of("code", code)).isEmpty()) continue;
                sql.run(SkillSeed.ROLE_EDGE_SQL, Map.of("skill_id", s.skillId(), "code", code));
            }
            if (owner) sql.run(SkillSeed.OWNER_EDGE_SQL, Map.of("skill_id", s.skillId(), "login", SkillSeed.OWNER_LOGIN));
        }
        return dictPlan.size() + plan.size();
    }

    /** Бывш. V100: статьи словаря area для областей компонентов — только недостающие (как V90/V93). */
    static int seedAreas(Sql sql) {
        Map<String, Set<String>> existing = new LinkedHashMap<>();
        for (String dict : AreaDictSeed.SEEDS.keySet()) existing.put(dict, codesOf(sql, dict));
        List<StatusDictCoreSeed.Insert> plan = StatusDictCoreSeed.plan(AreaDictSeed.SEEDS, existing);
        for (StatusDictCoreSeed.Insert i : plan) sql.run(AreaDictSeed.INSERT_SQL, AreaDictSeed.params(i));
        return plan.size();
    }

    /** Доводка v4 (AUD-AREA-COLORS 5а): подписи шести наших палитр — только недостающие статьи. */
    static int seedPalettes(Sql sql) {
        Map<String, Set<String>> existing = new LinkedHashMap<>();
        for (String dict : PaletteDictSeed.SEEDS.keySet()) existing.put(dict, codesOf(sql, dict));
        List<StatusDictCoreSeed.Insert> plan = StatusDictCoreSeed.plan(PaletteDictSeed.SEEDS, existing);
        for (StatusDictCoreSeed.Insert i : plan) sql.run(PaletteDictSeed.INSERT_SQL, PaletteDictSeed.params(i));
        return plan.size();
    }

    /**
     * Доводка v3 (ISS-02-DICT-SEED-GUARD, владелец 25.11.2026 «словари сеять каких нет»): task_type, priority,
     * agent_profile — только недостающие статьи; синонимы priority (P0–P3) закрывают свою ступень шкалы.
     */
    static int seedUiDicts(Sql sql) {
        Map<String, Set<String>> existing = new LinkedHashMap<>();
        for (String dict : UiDictSeed.SEEDS.keySet()) existing.put(dict, codesOf(sql, dict));
        List<StatusDictCoreSeed.Insert> plan = UiDictSeed.plan(existing);
        for (StatusDictCoreSeed.Insert i : plan) sql.run(UiDictSeed.INSERT_SQL, UiDictSeed.params(i));
        return plan.size();
    }
}
