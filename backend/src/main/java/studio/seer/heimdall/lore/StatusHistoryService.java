package studio.seer.heimdall.lore;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-13 — единое ведение SCD2 по статусам для всех типов.
 *
 * <p><b>Правило (владелица 07.11.2026):</b> у любого элемента LORE смена статуса —
 * новая версия истории по одной схеме, через ОДИН серверный сервис. До этого
 * статус задачи/спринта/фазы писал свой close-open в LoreStatusResource, ADR —
 * голым {@code UPDATE KnowADR SET status} (в KnowADRHist лежали одни тела), спека —
 * правкой открытой строки на месте (прежний статус терялся), решение — полем
 * вершины без истории вовсе. Новости §7.3 (очередь Q(t0), Flow, TTD) поэтому
 * считались только диапазоном.
 *
 * <p>{@link #transition} одним sqlscript:
 * <ol>
 *   <li>закрывает открытую версию условно — она ещё открыта и, если назван
 *       {@code expected}, в прежнем статусе; иначе ничего не пишется и вызывающий
 *       получает {@link Outcome.Conflict} (409, S2-09);</li>
 *   <li>открывает новую версию: ВСЕ поля прежней открытой строки переносятся
 *       (тела, план, хэш — без поштучных списков, которые и были источником
 *       carry-forward багов), плюс единая схема статуса:
 *       {@code state_uid, status_raw, status_category, valid_from, changed_by,
 *       changed_by_kind} и {@code status_known_from = valid_from};</li>
 *   <li>ставит ребро HAS_STATE и денормализованный статус на вершину.</li>
 * </ol>
 *
 * <p>Сервис не знает про HTTP и бины: доступ к БД — через {@link Db}, поэтому он
 * проверяется юнит-тестом на подставной базе, а ресурсы, миграция и сборщик
 * новостей зовут одно и то же. Обход сервиса ловит сторож
 * {@code StatusWritesGoThroughServiceTest}.
 */
final class StatusHistoryService {

    private StatusHistoryService() {}

    /** Доступ к БД: чтение строк и выполнение sqlscript (результат — как отдал движок). */
    interface Db {
        List<Map<String, Object>> query(String sql, Map<String, Object> params);
        Object script(String sql, Map<String, Object> params);
    }

    /**
     * Тип элемента со статусом.
     *
     * @param vertexField поле денормализованного статуса на вершине
     * @param histMirror  прежнее имя статуса в Hist, которое читают срезы (спека: {@code status});
     *                    пишется вместе с единым {@code status_raw}; null — нет
     * @param categoryType под каким типом считать категорию (D-2026-UXR-STATUS-AXIS)
     * @param noCarry     поля, которые принадлежат СОСТОЯНИЮ и в новую версию не переносятся
     */
    record Kind(String type, String vertex, String hist, String key, String vertexField,
                String histMirror, String categoryType, Set<String> noCarry) {}

    /**
     * Реестр типов, чей статус ведётся историей. Таблица инвентаризации всех
     * типов с полем статуса — в note_md задачи S2-13; здесь — те, у которых
     * есть Hist-цепочка (у вопроса, компонента, релиза, QG, сценария её нет —
     * их перевод требует новых Hist-типов и идёт отдельной задачей).
     */
    static final Map<String, Kind> KINDS = Map.of(
        "task",     new Kind("task", "KnowTask", "KnowTaskHist", "task_uid", "status_raw", null, "task", Set.of()),
        // block_reason — причина ИМЕННО этой блокировки (QG-16): уходит вместе с состоянием.
        "sprint",   new Kind("sprint", "KnowSprint", "KnowSprintHist", "sprint_id", "status_raw", null, "sprint",
                        Set.of("block_reason")),
        "phase",    new Kind("phase", "KnowPhase", "KnowPhaseHist", "phase_uid", "status_raw", null, "task", Set.of()),
        "adr",      new Kind("adr", "KnowADR", "KnowADRHist", "adr_id", "status", null, "adr", Set.of()),
        "spec",     new Kind("spec", "KnowSpec", "KnowSpecHist", "spec_id", "status", "status", "spec", Set.of()),
        "decision", new Kind("decision", "KnowDecision", "KnowDecisionHist", "decision_id", "status_raw", null,
                        "decision", Set.of()));

    /** Поля версии, которые сервис ставит сам и никогда не переносит из прежней строки. */
    static final Set<String> VERSION_FIELDS = Set.of(
        "state_uid", "valid_from", "valid_to", "status_raw", "status_category",
        "changed_by", "changed_by_kind", "status_known_from", "status_backfilled", "rid");

    /** Имя переносимого поля: только идентификатор (имена приходят из БД, в SQL идут текстом). */
    private static final Pattern FIELD_NAME = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    /** Исход перехода. */
    sealed interface Outcome {
        record Ok(String type, String id, String oldStatus, String newStatus, String stateUid, String at)
            implements Outcome {}
        record NotFound(String detail) implements Outcome {}
        record Conflict(String detail, Map<String, Object> current) implements Outcome {}
        record BadType(String detail) implements Outcome {}
    }

    /** Значение статуса, как оно хранится: токены плана → status_raw, ADR — верхним регистром. */
    static String normalize(Kind k, String to) {
        if (to == null) return null;
        String t = to.trim();
        return switch (k.type()) {
            case "task", "sprint", "phase" -> LoreResourceBase.SCD2_STATUS_RAW.getOrDefault(t, t);
            case "adr" -> t.toUpperCase(Locale.ROOT);
            default -> t;
        };
    }

    /** Совпадает ли «было» с текущим статусом: токен или сырое значение, регистр документов не важен. */
    static boolean matches(Kind k, String expected, String current) {
        if (expected == null || expected.isBlank()) return true;
        if (current == null) return false;
        if (Scd2Guard.statusMatches(expected, current)) return true;
        return normalize(k, expected).equalsIgnoreCase(current.trim());
    }

    /** Статус открытой строки: единое status_raw, затем прежнее имя (спека), затем вершина. */
    static String statusOf(Kind k, Map<String, Object> openRow, Object vertexStatus) {
        if (openRow != null) {
            Object raw = openRow.get("status_raw");
            if (raw != null) return String.valueOf(raw);
            if (k.histMirror() != null && openRow.get(k.histMirror()) != null)
                return String.valueOf(openRow.get(k.histMirror()));
        }
        return vertexStatus == null ? null : String.valueOf(vertexStatus);
    }

    /** Подготовленный sqlscript перехода. */
    record Plan(String script, Map<String, Object> params) {}

    /**
     * Скрипт перехода (чистая функция). openRow — открытая версия целиком (как её
     * отдал {@code SELECT FROM <hist>}), null — версии нет (первая версия статуса).
     */
    static Plan plan(Kind k, String id, Map<String, Object> openRow, String newRaw, String expectedRaw,
                     ChangeAuthor author, String now, String nsid) {
        ChangeAuthor by = author == null ? ChangeAuthor.UNKNOWN : author;
        Map<String, Object> p = new HashMap<>();
        p.put("id", id); p.put("nsid", nsid); p.put("now", now); p.put("ns", newRaw);
        p.put("cat", LoreStatusCategory.of(k.categoryType(), categoryInput(k, newRaw)));
        by.bind(p);

        StringBuilder script = new StringBuilder();
        String oldRid = openRow == null ? null : ridOf(openRow);
        if (oldRid != null) {
            boolean checkStatus = expectedRaw != null && openRow.get("status_raw") != null;
            script.append(Scd2Guard.guardedClose(k.hist(), checkStatus));
            p.put("oldrid", oldRid);
            if (checkStatus) p.put("expected_raw", expectedRaw);
        } else {
            // S2-15: «открытой не видно» проверяется ещё раз внутри скрипта.
            script.append(Scd2Guard.guardedNoOpen(k.hist(), k.key(), "id"));
        }

        StringBuilder set = new StringBuilder();
        if (openRow != null) {
            for (Map.Entry<String, Object> e : openRow.entrySet()) {
                String f = e.getKey();
                if (e.getValue() == null || f.startsWith("@") || VERSION_FIELDS.contains(f)
                        || k.noCarry().contains(f) || f.equals(k.histMirror())
                        || !FIELD_NAME.matcher(f).matches()) continue;
                set.append(f).append(" = :c_").append(f).append(", ");
                p.put("c_" + f, e.getValue());
            }
        }
        set.append("state_uid = :nsid, status_raw = :ns, status_category = :cat, valid_from = :now, ")
           .append("status_known_from = :now");
        if (k.histMirror() != null) set.append(", ").append(k.histMirror()).append(" = :ns");

        script.append("INSERT INTO ").append(k.hist()).append(" SET ").append(set)
              .append(ChangeAuthor.SET_SQL).append(";")
              .append("CREATE EDGE HAS_STATE FROM (SELECT FROM ").append(k.vertex())
              .append(" WHERE ").append(k.key()).append(" = :id) TO (SELECT FROM ").append(k.hist())
              .append(" WHERE state_uid = :nsid);")
              .append("UPDATE ").append(k.vertex()).append(" SET ").append(k.vertexField())
              .append(" = :ns WHERE ").append(k.key()).append(" = :id;");
        return new Plan(script.toString(), p);
    }

    /** Поля статуса версии, которые правка ТЕЛА (checkpoint ADR/спеки) несёт в новую версию как есть. */
    static final List<String> STATUS_FIELDS = List.of("status_raw", "status_category", "status_known_from", "status_backfilled");

    /** Проекция статусных полей для чтения открытой строки перед checkpoint. */
    static final String STATUS_FIELDS_SELECT = ", status_raw, status_category, status_known_from, status_backfilled";

    /**
     * Хвост SET для версии-правки тела: статус не меняется, поэтому переносится
     * из прежней строки (иначе checkpoint стирал бы статус из истории). Параметры —
     * {@code s_<поле>}, только непустые.
     */
    static String carryStatusSet(Map<String, Object> oldRow, Map<String, Object> params) {
        StringBuilder sb = new StringBuilder();
        if (oldRow == null) return "";
        for (String f : STATUS_FIELDS) {
            Object v = oldRow.get(f);
            if (v == null) continue;
            sb.append(", ").append(f).append(" = :s_").append(f);
            params.put("s_" + f, v);
        }
        return sb.toString();
    }

    /** Категория плана берётся по канону (status_raw «✅ DONE» → done), документов — по коду. */
    private static String categoryInput(Kind k, String raw) {
        if ("adr".equals(k.categoryType()) || "spec".equals(k.categoryType()) || "decision".equals(k.categoryType()))
            return raw;
        String token = LoreStatusResource.rawToToken(raw);
        return token != null ? token : raw;
    }

    private static String ridOf(Map<String, Object> row) {
        Object r = row.get("@rid");
        if (r == null) r = row.get("rid");
        String s = r == null ? null : String.valueOf(r);
        return s != null && s.startsWith("#") ? s : null;
    }

    static String openRowSql(Kind k) {
        return "SELECT FROM " + k.hist() + " WHERE in('HAS_STATE')." + k.key()
            + " CONTAINS :id AND valid_to IS NULL LIMIT 1";
    }

    /** Переход «сейчас» с новым state_uid. */
    static Outcome transition(Db db, String type, String id, String expected, String to, ChangeAuthor author) {
        return transition(db, type, id, expected, to, author, Instant.now().toString(), UUID.randomUUID().toString());
    }

    /**
     * Единственная точка смены статуса элемента с историей.
     *
     * @param expected «было» (токен или сырое значение); null — проверяется только то,
     *                 что прочитанная версия ещё открыта
     */
    static Outcome transition(Db db, String type, String id, String expected, String to, ChangeAuthor author,
                              String now, String nsid) {
        Kind k = KINDS.get(type);
        if (k == null) return new Outcome.BadType("status history is not kept for type '" + type
            + "' (known: " + KINDS.keySet() + ")");
        List<Map<String, Object>> v = db.query("SELECT " + k.vertexField() + " AS cur FROM " + k.vertex()
            + " WHERE " + k.key() + " = :id LIMIT 1", Map.of("id", id));
        if (v == null || v.isEmpty()) return new Outcome.NotFound(type + " '" + id + "' not found — id must be the full "
            + k.key() + " (a task needs \"SPRINT_X/T05\", not a bare task_id)");
        Object vertexStatus = v.get(0).get("cur");

        List<Map<String, Object>> open = db.query(openRowSql(k), Map.of("id", id));
        Map<String, Object> openRow = open == null || open.isEmpty() ? null : open.get(0);
        String oldStatus = statusOf(k, openRow, vertexStatus);
        if (!matches(k, expected, oldStatus)) {
            return new Outcome.Conflict(type + " '" + id + "': expected status '" + expected
                + "', but the open version is '" + oldStatus + "' — re-read and retry", current(openRow, oldStatus));
        }
        String newRaw = normalize(k, to);
        String expectedRaw = expected == null || expected.isBlank() || openRow == null ? null
            : (openRow.get("status_raw") == null ? null : String.valueOf(openRow.get("status_raw")));
        Plan plan = plan(k, id, openRow, newRaw, expectedRaw, author, now, nsid);
        Object res;
        try {
            res = db.script(plan.script(), plan.params());
        } catch (RuntimeException ex) {
            if (Scd2Guard.isConcurrentModification(ex))
                return new Outcome.Conflict(type + " '" + id + "': concurrent write to the same version — re-read and retry",
                    Map.of());
            throw ex;
        }
        if (Scd2Guard.isConflict(res)) {
            List<Map<String, Object>> again = db.query(openRowSql(k), Map.of("id", id));
            Map<String, Object> cur = again == null || again.isEmpty() ? null : again.get(0);
            return new Outcome.Conflict(type + " '" + id + "': the version read (" + oldStatus
                + ") was closed by a concurrent write — re-read and retry", current(cur, statusOf(k, cur, null)));
        }
        return new Outcome.Ok(type, id, oldStatus, newRaw, nsid, now);
    }

    /** Тело «текущее состояние» для 409: статус и служебные поля версии, без тел. */
    private static Map<String, Object> current(Map<String, Object> row, String status) {
        Map<String, Object> cur = new LinkedHashMap<>();
        if (status != null) cur.put("status_raw", status);
        if (row != null) {
            for (String f : List.of("state_uid", "valid_from", "changed_by", "changed_by_kind"))
                if (row.get(f) != null) cur.put(f, row.get(f));
        }
        return cur;
    }

    // ── Бэкфилл (V68): статус в истории у тех, у кого его там не было ─────────

    /** Итог бэкфилла по типу: сколько открытых строк получили статус и сколько версий открыто. */
    record BackfillCount(String type, int stamped, int opened) {}

    /**
     * Типы бэкфилла — только те, чей статус в истории НЕ вёлся: ADR, спеки, решения.
     * Задачи/спринты/фазы статус в истории несли всегда; задачи без датированных
     * версий — предмет task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-11 (сначала доказать
     * причину), бэкфилл их сознательно не трогает.
     */
    static final List<String> BACKFILL_TYPES = List.of("adr", "spec", "decision");

    /**
     * Для элементов, чья история статуса не велась (ADR, спеки, решения):
     * <ul>
     *   <li>открытая версия есть, статуса в ней нет — на неё кладётся ТЕКУЩИЙ статус
     *       вершины с пометкой {@code status_backfilled = true} и
     *       {@code status_known_from = момент бэкфилла}: статус известен с этого
     *       момента, раньше — «не знаем». Новая версия НЕ открывается, иначе лента
     *       получила бы сотни выдуманных правок в момент миграции;</li>
     *   <li>версии нет вовсе — открывается одна, с той же пометкой и
     *       {@code valid_from = момент бэкфилла}, без выдуманных дат.</li>
     * </ul>
     * Идемпотентен: повторный проход находит ноль строк. Существующие
     * valid_from/valid_to не трогаются никогда.
     */
    static List<BackfillCount> backfill(Db db, String now) {
        return backfill(db, now, BACKFILL_TYPES);
    }

    /**
     * S2-11 (V71): задачи без единой версии истории — записи мимо SCD2 (прямой
     * SQL, 14 задач на проде 07.11). Та же ветка «версии нет вовсе»: одна версия,
     * текущий статус вершины, пометка {@code status_backfilled}, valid_from =
     * момент бэкфилла. Открытые версии задач всегда несут status_raw, поэтому
     * ветка пометки для них — ноль строк.
     */
    static final List<String> TASK_BACKFILL_TYPES = List.of("task");

    static List<BackfillCount> backfill(Db db, String now, List<String> types) {
        List<BackfillCount> out = new ArrayList<>();
        for (String type : types) {
            Kind k = KINDS.get(type);
            int stamped = 0, opened = 0;
            String mirror = k.histMirror() == null ? "" : ", " + k.histMirror() + " AS mirror";
            List<Map<String, Object>> rows = db.query(
                "SELECT @rid AS rid, in('HAS_STATE')." + k.vertexField() + "[0] AS cur" + mirror
                    + " FROM " + k.hist() + " WHERE valid_to IS NULL AND status_raw IS NULL", Map.of());
            for (Map<String, Object> r : rows == null ? List.<Map<String, Object>>of() : rows) {
                Object st = r.get("mirror") != null ? r.get("mirror") : r.get("cur");
                if (st == null || r.get("rid") == null) continue;
                String raw = String.valueOf(st);
                Map<String, Object> p = new HashMap<>();
                p.put("rid", String.valueOf(r.get("rid")));
                p.put("ns", raw);
                p.put("cat", LoreStatusCategory.of(k.categoryType(), categoryInput(k, raw)));
                p.put("now", now);
                db.script("UPDATE " + k.hist() + " SET status_raw = :ns, status_category = :cat, "
                    + "status_known_from = :now, status_backfilled = true "
                    + "WHERE @rid = :rid AND status_raw IS NULL", p);
                stamped++;
            }
            List<Map<String, Object>> bare = db.query(
                "SELECT " + k.key() + " AS id, " + k.vertexField() + " AS cur FROM " + k.vertex()
                    + " WHERE " + k.vertexField() + " IS NOT NULL AND out('HAS_STATE').size() = 0", Map.of());
            for (Map<String, Object> r : bare == null ? List.<Map<String, Object>>of() : bare) {
                if (r.get("id") == null || r.get("cur") == null) continue;
                String raw = String.valueOf(r.get("cur"));
                Map<String, Object> p = new HashMap<>();
                p.put("id", String.valueOf(r.get("id")));
                p.put("nsid", UUID.randomUUID().toString());
                p.put("ns", raw);
                p.put("cat", LoreStatusCategory.of(k.categoryType(), categoryInput(k, raw)));
                p.put("now", now);
                ChangeAuthor.UNKNOWN.bind(p);
                String mirrorSet = k.histMirror() == null ? "" : ", " + k.histMirror() + " = :ns";
                db.script("INSERT INTO " + k.hist() + " SET state_uid = :nsid, status_raw = :ns, "
                    + "status_category = :cat, valid_from = :now, status_known_from = :now, "
                    + "status_backfilled = true" + mirrorSet + ChangeAuthor.SET_SQL + ";"
                    + "CREATE EDGE HAS_STATE FROM (SELECT FROM " + k.vertex() + " WHERE " + k.key()
                    + " = :id AND out('HAS_STATE').size() = 0) TO (SELECT FROM " + k.hist()
                    + " WHERE state_uid = :nsid);", p);
                opened++;
            }
            out.add(new BackfillCount(type, stamped, opened));
        }
        return out;
    }
}
