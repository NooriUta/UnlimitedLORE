package studio.seer.heimdall.lore;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Одна связь «зависит от» — ребро {@code DEPENDS_ON} между задачей, фазой,
 * спринтом и вехой в любом сочетании (слова владелицы 16.11.2026: «одно ребро которое универсально может
 * связывать»; спека SPEC-LORE-DEPENDENCY-EDGE).
 * <ul>
 *   <li>у ребра вид {@code kind} из справочника {@link #DICT} (объединённый: blocks, waits, soft, gate, informs, relates) и
 *       причина {@code reason} (обязательна у новой связи — иначе 422); вид не из справочника — 422 со списком допустимых;</li>
 *   <li>связь с собой — 400; конец не найден — 404; связь, замыкающая цикл (через любые из четырёх типов), —
 *       409 с путём цикла;</li>
 *   <li>связь историчная (раздел edge_history модели): снятие закрывает ребро {@code valid_to}, смена вида —
 *       закрывает прежнее и открывает новое; цикл ищется только по текущим рёбрам.</li>
 * </ul>
 * Правила здесь без HTTP: база — через {@link Graph}, чтобы тот же код проверялся на встроенной ArcadeDB
 * (LoreDependencyEmbeddedTest). Ребро ADR → ADR — тот же тип DEPENDS_ON, но не планирование: его ведёт
 * {@code adr/depends_on}, сюда ADR не допускается.
 */
final class LoreDependency {

    private LoreDependency() {}

    static final String EDGE = "DEPENDS_ON";
    /** Справочник видов зависимости (KnowDictEntry.dict_type; в новой базе — справочник переноса). */
    static final String DICT = "dependency_kind";
    /**
     * Виды, пока справочник в базе не заведён. Объединённый справочник (владелица 20.11.2026: «объединить»): виды
     * спринтов (soft, gate, informs) и виды спеки SPEC-LORE-DEPENDENCY-EDGE (blocks, waits, relates); hard спринтов
     * и blocks спеки — одно и то же («не начать без»), код один — blocks, hard принимается синонимом.
     */
    static final List<String> DEFAULT_KINDS = List.of("blocks", "waits", "soft", "gate", "informs", "relates");
    /** Синонимы видов: прежний код → код справочника. */
    static final Map<String, String> SYNONYMS = Map.of("hard", "blocks");
    /** Причина, которую получают при переносе старые связи без причины (до 1.18). */
    static final String MIGRATED_NO_REASON = "перенесено без причины (до 1.18)";
    /** Вид, когда вызывающий его не назвал — как у прежнего sprint/dep. */
    static final String DEFAULT_KIND = "soft";
    /** Предел обхода при поиске цикла: граф планирования — сотни рёбер, предел — от зацикливания самого обхода. */
    static final int MAX_VISIT = 20_000;

    /** Конец связи: тип паспорта, вершина, деловой ключ. */
    record End(String type, String vertex, String key) {}

    /** Четыре типа планирования, в порядке поиска по ключу. */
    static final List<End> ENDS = List.of(
        new End("task", "KnowTask", "task_uid"),
        new End("phase", "KnowPhase", "phase_uid"),
        new End("sprint", "KnowSprint", "sprint_id"),
        new End("milestone", "KnowMilestone", "milestone_id"));

    static End end(String type) {
        for (End e : ENDS) if (e.type().equals(type)) return e;
        return null;
    }

    static End endOfVertex(String vertex) {
        for (End e : ENDS) if (e.vertex().equals(vertex)) return e;
        return null;
    }

    static List<String> types() {
        return ENDS.stream().map(End::type).toList();
    }

    /** Доступ к базе: чтение и команда. */
    interface Graph {
        List<Map<String, Object>> query(String sql, Map<String, Object> params);
        void exec(String sql, Map<String, Object> params);
    }

    /** Запись планирования: тип и деловой ключ. */
    record Ref(String type, String id) {
        String label() { return type + ":" + id; }
    }

    /** Итог разбора конца: запись либо отказ (status, тело). */
    record Resolved(Ref ref, int status, Map<String, Object> error) {}

    /** Итог записи: HTTP-статус и тело ответа. */
    record Result(int status, Map<String, Object> body) {}

    private static final Pattern RID = Pattern.compile("#-?\\d+:-?\\d+");

    private static Map<String, Object> err(String code, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", code);
        m.put("detail", detail);
        return m;
    }

    private static String s(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static String rid(Object o) {
        String r = s(o);
        if (r == null || !RID.matcher(r).matches()) throw new IllegalStateException("не адрес записи: " + r);
        return r;
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", " ");
    }

    /**
     * Конец по типу и ключу. Тип не назван — ищется среди четырёх типов по ключу: ровно одно совпадение —
     * оно; ни одного — 404; несколько — 400 (назовите тип). Тип не из четырёх — 400.
     */
    static Resolved resolve(Graph g, String type, String id) {
        if (id == null || id.isBlank()) return new Resolved(null, 400, err("BAD_PARAMS", "id конца не задан"));
        if (type != null && !type.isBlank()) {
            End e = end(type);
            if (e == null) return new Resolved(null, 400, err("BAD_PARAMS",
                "тип «" + type + "» не участвует в зависимостях; есть: " + types()));
            if (vertexRid(g, e, id) == null)
                return new Resolved(null, 404, err("TARGET_NOT_FOUND", type + " «" + id + "» не найден(а)"));
            return new Resolved(new Ref(type, id), 200, null);
        }
        List<Ref> hits = new ArrayList<>();
        for (End e : ENDS) if (vertexRid(g, e, id) != null) hits.add(new Ref(e.type(), id));
        if (hits.isEmpty()) return new Resolved(null, 404, err("TARGET_NOT_FOUND",
            "«" + id + "» не найден(а) ни среди задач, ни среди фаз, спринтов и вех"));
        if (hits.size() > 1) return new Resolved(null, 400, err("AMBIGUOUS_TARGET",
            "«" + id + "» есть у нескольких типов " + hits.stream().map(Ref::type).toList() + " — назовите target_type"));
        return new Resolved(hits.get(0), 200, null);
    }

    private static String vertexRid(Graph g, End e, String id) {
        List<Map<String, Object>> r = g.query("SELECT @rid AS r FROM " + e.vertex() + " WHERE " + e.key() + " = :id LIMIT 1",
            Map.of("id", id));
        return r.isEmpty() ? null : rid(r.get(0).get("r"));
    }

    /**
     * Поставить или снять зависимость {@code from} → {@code to} («from зависит от to»).
     * {@code kinds} — действующий справочник видов; {@code now} — момент записи (ISO).
     */
    static Result link(Graph g, Ref from, Ref to, String kind, String reason, String action, List<String> kinds, String now) {
        boolean remove = "remove".equalsIgnoreCase(action);
        if (!remove && action != null && !"add".equalsIgnoreCase(action))
            return new Result(400, err("BAD_PARAMS", "action — add | remove"));
        End fe = end(from.type()), te = end(to.type());
        if (fe == null || te == null)
            return new Result(400, err("BAD_PARAMS", "зависимость связывает только " + types() + ", а не "
                + (fe == null ? from.type() : to.type())));
        if (from.equals(to)) return new Result(400, err("BAD_PARAMS", "связь с собой: " + from.label()));
        String k = kind == null || kind.isBlank() ? null : kind.strip();
        if (k != null) k = SYNONYMS.getOrDefault(k, k);
        if (!remove && k != null && !kinds.contains(k)) {
            Map<String, Object> e = err("UNKNOWN_KIND", "вид зависимости «" + k + "» не из справочника " + DICT);
            e.put("allowed", List.copyOf(kinds));
            return new Result(422, e);
        }
        String fr = vertexRid(g, fe, from.id());
        if (fr == null) return new Result(404, err("TARGET_NOT_FOUND", from.type() + " «" + from.id() + "» не найден(а)"));
        String tr = vertexRid(g, te, to.id());
        if (tr == null) return new Result(404, err("TARGET_NOT_FOUND", to.type() + " «" + to.id() + "» не найден(а)"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("from_type", from.type());
        out.put("from_id", from.id());
        out.put("to_type", to.type());
        out.put("to_id", to.id());
        out.put("action", remove ? "removed" : "added");
        List<Map<String, Object>> cur = g.query("SELECT @rid AS r, kind, reason FROM " + EDGE
            + " WHERE @out = " + fr + " AND @in = " + tr + " AND valid_to IS NULL", Map.of());
        if (remove) {
            for (Map<String, Object> c : cur)
                g.exec("UPDATE " + rid(c.get("r")) + " SET valid_to = :now WHERE valid_to IS NULL", Map.of("now", now));
            out.put("outcome", cur.isEmpty() ? LoreOutcome.UNCHANGED : LoreOutcome.DELETED);
            if (cur.isEmpty()) out.put("hint", "такой зависимости не было — снимать нечего");
            return new Result(200, out);
        }
        String prevKind = cur.isEmpty() ? null : s(cur.get(0).get("kind"));
        String prevReason = cur.isEmpty() ? null : s(cur.get(0).get("reason"));
        String newKind = k != null ? k : (cur.isEmpty() ? DEFAULT_KIND : prevKind);
        String newReason = reason != null && !reason.isBlank() ? reason.strip() : (prevReason == null || prevReason.isBlank() ? null : prevReason);
        out.put("kind", newKind);
        if (newReason != null) out.put("reason", newReason);
        if (!cur.isEmpty() && Objects.equals(prevKind, newKind) && (reason == null || reason.isBlank() || Objects.equals(prevReason, newReason))) {
            out.put("outcome", LoreOutcome.UNCHANGED);
            out.put("hint", "связь уже была — повторять вызов не нужно");
            return new Result(200, out);
        }
        // Владелица 20.11.2026: «хорошо бы с причиной, мы её теряем» — новая связь (и новое ребро при смене вида)
        // без причины не пишется.
        if (newReason == null) {
            Map<String, Object> e = err("REASON_REQUIRED", "укажите причину зависимости (reason): почему "
                + from.label() + " зависит от " + to.label());
            return new Result(422, e);
        }
        if (cur.isEmpty()) {
            List<Ref> cycle = cyclePath(g, from, fr, to, tr);
            if (cycle != null) {
                Map<String, Object> e = err("CYCLE", "зависимость замкнёт цикл: "
                    + String.join(" → ", cycle.stream().map(Ref::label).toList()));
                e.put("cycle", cycle.stream().map(Ref::label).toList());
                return new Result(409, e);
            }
        }
        for (Map<String, Object> c : cur)
            g.exec("UPDATE " + rid(c.get("r")) + " SET valid_to = :now WHERE valid_to IS NULL", Map.of("now", now));
        // CREATE EDGE — через String.format: в этой сборке ArcadeDB именованные параметры в SET у CREATE EDGE
        // не связываются (замер TaskRoleService, V36). Концы — адресами, проверенными выше.
        g.exec(String.format("CREATE EDGE " + EDGE + " FROM %s TO %s SET kind = '%s'%s, valid_from = '%s'",
            fr, tr, esc(newKind), newReason == null ? "" : ", reason = '" + esc(newReason) + "'", esc(now)), Map.of());
        List<Map<String, Object>> after = g.query("SELECT kind FROM " + EDGE
            + " WHERE @out = " + fr + " AND @in = " + tr + " AND valid_to IS NULL", Map.of());
        if (after.size() != 1 || !newKind.equals(s(after.get(0).get("kind"))))
            throw new IllegalStateException("зависимость " + from.label() + " → " + to.label() + " не записана: текущих рёбер "
                + after.size());
        out.put("outcome", cur.isEmpty() ? LoreOutcome.CREATED : LoreOutcome.UPDATED);
        if (!cur.isEmpty()) out.put("previous_kind", prevKind);
        return new Result(200, out);
    }

    /**
     * Путь цикла, который замкнёт новое ребро {@code from → to}: обход в ширину по ТЕКУЩИМ рёбрам DEPENDS_ON от
     * {@code to}; дошли до {@code from} — цикл {@code [from, to, …, from]}; не дошли — {@code null}.
     */
    static List<Ref> cyclePath(Graph g, Ref from, String fromRid, Ref to, String toRid) {
        Map<String, String> parent = new HashMap<>();
        Map<String, Ref> refOf = new HashMap<>();
        refOf.put(toRid, to);
        refOf.put(fromRid, from);
        ArrayDeque<String> queue = new ArrayDeque<>();
        queue.add(toRid);
        parent.put(toRid, null);
        int visited = 0;
        while (!queue.isEmpty()) {
            String at = queue.poll();
            if (++visited > MAX_VISIT)
                throw new IllegalStateException("поиск цикла: больше " + MAX_VISIT + " записей — обход остановлен");
            for (Map<String, Object> n : g.query("SELECT @in AS r, @in.@type AS t, @in.task_uid AS tu, @in.phase_uid AS pu, "
                    + "@in.sprint_id AS su, @in.milestone_id AS mu FROM " + EDGE + " WHERE @out = " + at
                    + " AND valid_to IS NULL", Map.of())) {
                End e = endOfVertex(s(n.get("t")));
                if (e == null) continue;
                String r = rid(n.get("r"));
                if (parent.containsKey(r)) continue;
                parent.put(r, at);
                refOf.putIfAbsent(r, new Ref(e.type(), s(n.get(switch (e.type()) {
                    case "task" -> "tu";
                    case "phase" -> "pu";
                    case "sprint" -> "su";
                    default -> "mu";
                }))));
                if (r.equals(fromRid)) {
                    List<Ref> back = new ArrayList<>();
                    for (String x = r; x != null; x = parent.get(x)) back.add(refOf.get(x));
                    java.util.Collections.reverse(back); // to … from
                    List<Ref> path = new ArrayList<>();
                    path.add(from);
                    path.addAll(back);
                    return path;
                }
                queue.add(r);
            }
        }
        return null;
    }

    // ── Срезы ────────────────────────────────────────────────────────────

    /** Тип паспорта конца ребра ({@code @out} | {@code @in}) по классу вершины. */
    static String typeSql(String end) {
        StringBuilder sb = new StringBuilder("CASE");
        for (End e : ENDS) sb.append(" WHEN ").append(end).append(".@type = '").append(e.vertex()).append("' THEN '")
            .append(e.type()).append("'");
        return sb.append(" END").toString();
    }

    /** Деловой ключ конца ребра. */
    static String idSql(String end) {
        List<String> parts = new ArrayList<>();
        for (End e : ENDS) parts.add(end + "." + e.key());
        return "coalesce(" + String.join(", ", parts) + ")";
    }

    /** Название конца ребра: title, name (фаза, спринт), label (веха). */
    static String titleSql(String end) {
        return "coalesce(" + end + ".title, " + end + ".name, " + end + ".label)";
    }

    /** Ребро планирования: начало — одна из четырёх вершин (ADR → ADR сюда не входит). */
    static String planningSql() {
        List<String> v = new ArrayList<>();
        for (End e : ENDS) v.add("'" + e.vertex() + "'");
        return "@out.@type IN [" + String.join(", ", v) + "]";
    }

    /** Скоуп конца: свой проект (спринт), проект спринта (задача, фаза), веха — общая (у неё нет проекта). */
    static String scopeOf(String end) {
        return end + ".out('BELONGS_TO_PROJECT').slug|" + end + ".out('PART_OF').out('BELONGS_TO_PROJECT').slug|?"
            + end + ".@type = 'KnowMilestone'";
    }
}
