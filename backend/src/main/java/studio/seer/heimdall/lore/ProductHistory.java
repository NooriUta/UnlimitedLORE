package studio.seer.heimdall.lore;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (владелец 25.11.2026: «историчность доделываем») — SCD2-история боли,
 * выгоды, работы, роли продукта и фичи.
 *
 * <p><b>Почему.</b> Первая волна правки паспорта (PR #1829) дала правку этих пяти типов, но версий у них не было:
 * UPSERT писал вершину на месте, и «История» паспорта v2 показывала «история не ведётся». Прежнее значение поля
 * терялось при каждой правке.
 *
 * <p><b>Как — по образцу дока (S7B-06, {@code LoreDocResource#versionBody}).</b> После записи вершины читаются её
 * ТЕКУЩИЕ поля-снимок; хэш снимка ({@link LoreContentHash}) сверяется с {@code content_hash} открытой версии:
 * <ul>
 *   <li>совпал — ничего не пишется (повтор той же правки, правка поля вне снимка версию не множат);</li>
 *   <li>другой — открытая версия закрывается и открывается новая (сторож {@link Scd2Guard#guardedClose});</li>
 *   <li>версии нет — открывается первая ({@link Scd2Guard#guardedNoOpen}).</li>
 * </ul>
 * Версия несёт автора из проверенного токена ({@link ChangeAuthor}) и снимок полей — это и есть «что было» в
 * истории. Записи, заведённые до доводки v5, получают начальную версию «как есть» посевом доводки ({@link #seed}).
 *
 * <p>Таблица «тип → вершина, цепочка, ключ, поля снимка» — одна на запись, посев и чтение истории
 * ({@link LoreEntityHistory#BODY_FIELDS} берёт поля отсюда).
 */
final class ProductHistory {

    private ProductHistory() {}

    /** Тип паспорта → вершина, класс цепочки, поле ключа, поля снимка версии (порядок фиксирован — от него хэш). */
    record Spec(String type, String vertex, String hist, String key, List<String> fields) {}

    static final List<Spec> SPECS = List.of(
        new Spec("pain", "KnowPain", "KnowPainHist", "pain_id", List.of("title", "severity", "body_md")),
        new Spec("gain", "KnowGain", "KnowGainHist", "gain_id", List.of("title", "rank", "body_md", "metric_md")),
        new Spec("job", "KnowJob", "KnowJobHist", "job_id", List.of("title", "kind", "importance", "body_md")),
        // Роль продукта — KnowProjectActor (путь /lore/project-actor); название у неё — name.
        new Spec("actor", "KnowProjectActor", "KnowProjectActorHist", "actor_id", List.of("name", "kind", "body_md")),
        // Фича и сценарий — одна вершина KnowUseCase (PL-28): поля обоих путей записи (/lore/feature и /lore/uc).
        // Статус в снимок не входит: его выводит вычислитель готовности (D17), не правка.
        new Spec("feature", "KnowUseCase", "KnowUseCaseHist", "uc_id",
            List.of("title", "goal_level", "rigor", "priority", "body_md", "context_md", "scenario_md", "acceptance_md")));

    static Spec spec(String type) {
        for (Spec s : SPECS) if (s.type().equals(type)) return s;
        throw new IllegalArgumentException("история не заведена для типа: " + type);
    }

    static Spec specOfHist(String hist) {
        for (Spec s : SPECS) if (s.hist().equals(hist)) return s;
        return null;
    }

    /** Исполнитель команды: сервер — REST ArcadeDB (writeClient), тест — встроенная ArcadeDB. */
    @FunctionalInterface
    interface Exec {
        List<Map<String, Object>> run(String language, String command, Map<String, Object> params);
    }

    /** Что делать с версией после записи вершины. */
    enum Step { NONE, FIRST, NEXT }

    /** Хэш снимка: значения полей в порядке спеки; пустое поле — пустая строка (как у тел SV-10). */
    static String hashOf(Spec s, Map<String, Object> row) {
        String[] parts = new String[s.fields().size()];
        for (int i = 0; i < parts.length; i++) {
            Object v = row == null ? null : row.get(s.fields().get(i));
            parts[i] = v == null ? null : String.valueOf(v);
        }
        return LoreContentHash.of(parts);
    }

    /** Решение: версии нет — первая; хэш снимка другой — следующая; тот же — ничего. */
    static Step decide(String currentHash, boolean hasOpen, Object openHash) {
        if (!hasOpen) return Step.FIRST;
        return currentHash.equals(openHash == null ? null : String.valueOf(openHash)) ? Step.NONE : Step.NEXT;
    }

    static String currentSql(Spec s) {
        return "SELECT " + String.join(", ", s.fields()) + " FROM " + s.vertex() + " WHERE " + s.key() + " = :id LIMIT 1";
    }

    static String openSql(Spec s) {
        return "SELECT @rid AS rid, content_hash FROM " + s.hist()
            + " WHERE in('HAS_STATE')." + s.key() + " CONTAINS :id AND valid_to IS NULL LIMIT 1";
    }

    /** SET-список полей снимка: {@code , title = :f_title, …} — параметры кладёт {@link #params}. */
    private static String fieldsSet(Spec s) {
        StringBuilder sb = new StringBuilder();
        for (String f : s.fields()) sb.append(", ").append(f).append(" = :f_").append(f);
        return sb.toString();
    }

    /**
     * sqlscript версии: сторож (закрыть открытую ИЛИ убедиться, что открытой нет), вставка версии с автором и
     * снимком, ребро HAS_STATE от вершины. Типы — из таблицы {@link #SPECS}, не из запроса.
     */
    static String script(Spec s, Step step) {
        String guard = step == Step.NEXT
            ? Scd2Guard.guardedClose(s.vertex(), s.hist(), false)
            : Scd2Guard.guardedNoOpen(s.vertex(), s.hist(), s.key(), "id");
        return guard
            + "INSERT INTO " + s.hist() + " SET " + s.key() + " = :id, state_uid = :nsid, valid_from = :now, content_hash = :ch"
            + fieldsSet(s) + ChangeAuthor.SET_SQL + ";"
            + "CREATE EDGE HAS_STATE FROM (SELECT FROM " + s.vertex() + " WHERE " + s.key() + " = :id) "
            + "TO (SELECT FROM " + s.hist() + " WHERE state_uid = :nsid AND in('HAS_STATE').size() = 0);";
    }

    /** Параметры {@link #script}: ключ, новая версия, момент, хэш, снимок, автор (+ :oldrid при закрытии). */
    static Map<String, Object> params(Spec s, String id, Map<String, Object> current, String hash, Object oldRid,
                                      ChangeAuthor author, Instant now) {
        Map<String, Object> p = new HashMap<>();
        p.put("id", id);
        p.put("nsid", UUID.randomUUID().toString());
        p.put("now", now.toString());
        p.put("ch", hash);
        for (String f : s.fields()) p.put("f_" + f, current == null ? null : current.get(f));
        if (oldRid != null) p.put("oldrid", String.valueOf(oldRid));
        (author == null ? ChangeAuthor.UNKNOWN : author).bind(p);
        return p;
    }

    /**
     * Версия записи после её правки. Возвращает, что сделано: NONE (снимок тот же), FIRST, NEXT. Записи нет —
     * NONE (писать версию нечему). Соседняя запись успела закрыть открытую версию — {@link Scd2Guard.ConflictException}
     * (409 у вызывающего): ничего не записано, повтор безопасен.
     */
    static Step version(Exec exec, String type, String id, ChangeAuthor author) {
        return version(exec, type, id, author, Instant.now());
    }

    /**
     * То же с моментом записи от вызывающего. Путь записи ставит этот же момент в {@code updated_at} вершины, а срез
     * отдаёт в changed_at максимум из valid_from открытой версии и updated_at: версия на своих часах всегда чуть позже
     * отметки, и changed_at уходил от момента записи на миллисекунды (CI #1827, FreshnessChangedAtLiveDbTest).
     * Один момент на одну запись — и закрытие прежней версии (valid_to), и открытие новой (valid_from).
     */
    static Step version(Exec exec, String type, String id, ChangeAuthor author, Instant now) {
        Spec s = spec(type);
        List<Map<String, Object>> cur = exec.run("sql", currentSql(s), Map.of("id", id));
        if (cur == null || cur.isEmpty()) return Step.NONE;
        String hash = hashOf(s, cur.get(0));
        List<Map<String, Object>> open = exec.run("sql", openSql(s), Map.of("id", id));
        boolean hasOpen = open != null && !open.isEmpty();
        Step step = decide(hash, hasOpen, hasOpen ? open.get(0).get("content_hash") : null);
        if (step == Step.NONE) return step;
        Map<String, Object> p = params(s, id, cur.get(0), hash, hasOpen ? open.get(0).get("rid") : null, author, now);
        List<Map<String, Object>> res = exec.run("sqlscript", script(s, step), p);
        if (Scd2Guard.isConflict(res))
            throw new Scd2Guard.ConflictException(type + " '" + id
                + "': открытую версию истории изменила соседняя запись — перечитайте и повторите", Map.of());
        return step;
    }

    // ── посев доводки: начальная версия «как есть» ──────────────────────────────────────────────────────

    /** Записи без единой версии — им нужна начальная. */
    static String withoutHistorySql(Spec s) {
        return "SELECT " + s.key() + " AS id, " + String.join(", ", s.fields()) + " FROM " + s.vertex()
            + " WHERE " + s.key() + " IS NOT NULL AND out('HAS_STATE').size() = 0";
    }

    /** Вставка начальной версии посева — та же форма, что у правки; автор не установлен (правил не человек и не агент). */
    static String seedInsertSql(Spec s) {
        return "INSERT INTO " + s.hist() + " SET " + s.key() + " = :id, state_uid = :nsid, valid_from = :now, content_hash = :ch"
            + fieldsSet(s) + ChangeAuthor.SET_SQL;
    }

    static String seedEdgeSql(Spec s) {
        return "CREATE EDGE HAS_STATE FROM (SELECT FROM " + s.vertex() + " WHERE " + s.key() + " = :id) "
            + "TO (SELECT FROM " + s.hist() + " WHERE state_uid = :nsid AND in('HAS_STATE').size() = 0)";
    }

    /** Отпечаток посева для хэша доводки: типы, цепочки, ключи, поля снимка. */
    static String fingerprint() {
        List<String> out = new ArrayList<>();
        for (Spec s : SPECS) out.add(s.type() + ":" + s.vertex() + "->" + s.hist() + "(" + s.key() + ")" + s.fields());
        return String.join("|", out);
    }

    /**
     * Доводка v5: каждой записи пяти типов без истории — начальная версия «как есть» (снимок текущих полей, автор не
     * установлен). Только недостающее: запись с версией не трогается, повтор — ноль вставок. Тип вершины, которого в
     * базе нет, пропускается (на такой базе записей нет). Возвращает число вставленных версий.
     */
    static int seed(LoreSchemaAdditive.Sql sql, java.util.Set<String> haveTypes) {
        int n = 0;
        String now = Instant.now().toString();
        for (Spec s : SPECS) {
            if (!haveTypes.contains(s.vertex()) || !haveTypes.contains(s.hist())) continue;
            for (Map<String, Object> r : sql.run(withoutHistorySql(s), Map.of())) {
                Object id = r.get("id");
                if (id == null) continue;
                Map<String, Object> p = params(s, String.valueOf(id), r, hashOf(s, r), null, ChangeAuthor.UNKNOWN, Instant.parse(now));
                sql.run(seedInsertSql(s), p);
                sql.run(seedEdgeSql(s), Map.of("id", p.get("id"), "nsid", p.get("nsid")));
                n++;
            }
        }
        return n;
    }

    /** Поля снимка по классу цепочки — для чтения истории. */
    static Map<String, List<String>> bodyFields() {
        Map<String, List<String>> m = new LinkedHashMap<>();
        for (Spec s : SPECS) m.put(s.hist(), s.fields());
        return m;
    }
}
