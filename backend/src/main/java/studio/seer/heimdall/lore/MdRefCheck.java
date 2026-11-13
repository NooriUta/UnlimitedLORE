package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-20 — проверка корпуса для раздела админки «Привести в порядок»,
 * чистая часть: из уже прочитанных текстов и контекста строит план автопочинки и ручной список.
 *
 * <p>Одна строка ручного списка — одна запись (владелица 13.11: «Если в одном тексте несколько то
 * ссылка одна»). Текст, у которого вершина и открытая SCD2-версия расходятся, автоматом не правится
 * (на препроде такие дали 409) — он идёт в ручной список группой {@code diverged}.
 */
final class MdRefCheck {

    private MdRefCheck() {}

    /** Сколько мест одной записи отдавать в ответе (счёт — полный). */
    static final int ISSUES_PER_ROW = 6;
    static final int SAMPLES_PER_RULE = 3;

    /** Поле записи: текущий текст и признак расхождения вершины с открытой версией. */
    record Field(String type, String id, String field, String text, boolean diverged, boolean writable) {}

    record RecordKey(String type, String id) {}

    static Map<String, Object> compute(List<Field> fields, MdRefRules.Ctx ctx,
                                       Map<RecordKey, MdRefRules.Scope> scopes, Set<String> enabled) {
        return compute(fields, ctx, scopes, enabled, Set.of());
    }

    /**
     * @param dismissed ключи отметок «не ссылка» ({@link MdRefDismissals#key}): места этого вида у
     *                  записи не считаются, а сама отметка идёт в {@code manual.dismissed} (фильтр «скрытые»).
     */
    static Map<String, Object> compute(List<Field> fields, MdRefRules.Ctx ctx,
                                       Map<RecordKey, MdRefRules.Scope> scopes, Set<String> enabled, Set<String> dismissed) {
        Map<String, Integer> hidden = new TreeMap<>();              // ключ отметки → скрыто мест
        Map<String, int[]> ruleEdits = new TreeMap<>();            // rule → [edits, records]
        Map<String, Integer> sig = new TreeMap<>();
        Map<String, List<Map<String, Object>>> samples = new TreeMap<>();
        Map<RecordKey, Set<String>> recRules = new LinkedHashMap<>();
        Map<RecordKey, List<Map<String, Object>>> recIssues = new LinkedHashMap<>();
        Map<RecordKey, Integer> recPlaces = new HashMap<>();
        Set<RecordKey> records = new HashSet<>();
        int autoEdits = 0;

        List<Field> sorted = new ArrayList<>(fields);
        sorted.sort(Comparator.comparing(Field::type).thenComparing(Field::id).thenComparing(Field::field));
        for (Field f : sorted) {
            RecordKey key = new RecordKey(f.type(), f.id());
            records.add(key);
            MdRefRules.Scope scope = scopes.getOrDefault(key, MdRefRules.Scope.NONE);
            String owner = ownerSprint(f.type(), f.id());
            MdRefRules.Result r = MdRefRules.fix(f.text(), ctx, owner, scope, enabled);
            boolean canAuto = f.writable() && !f.diverged();
            if (!r.changes().isEmpty() && canAuto) {
                Set<String> mine = recRules.computeIfAbsent(key, k -> new LinkedHashSet<>());
                for (MdRefRules.Change c : r.changes()) {
                    String base = MdRefRules.baseRule(c.rule());
                    ruleEdits.computeIfAbsent(base, k -> new int[2])[0]++;
                    mine.add(base);
                    autoEdits++;
                    List<Map<String, Object>> s = samples.computeIfAbsent(base, k -> new ArrayList<>());
                    if (s.size() < SAMPLES_PER_RULE && s.stream().noneMatch(x -> f.id().equals(x.get("id")))) {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("type", f.type()); m.put("id", f.id()); m.put("field", f.field());
                        m.put("old", c.oldText()); m.put("new", c.newText());
                        s.add(m);
                    }
                }
            }
            List<Map<String, Object>> iss = new ArrayList<>();
            for (MdRefRules.Issue i : r.issues()) {
                String dk = MdRefDismissals.key(f.type(), f.id(), i.kind());
                if (dismissed.contains(dk)) { hidden.merge(dk, 1, Integer::sum); continue; }
                iss.add(issue(i.kind(), i.id(), f.field(), i.snippet(), i.suggest()));
            }
            // Нельзя править автоматом, а правки есть: не потерять их — показать человеку.
            if (!r.changes().isEmpty() && !canAuto) {
                String kind = f.diverged() ? "diverged" : "not_writable";
                for (MdRefRules.Change c : r.changes())
                    iss.add(issue(kind, c.id(), f.field(), c.oldText() + " → " + c.newText(), List.of()));
            }
            if (!iss.isEmpty()) {
                recIssues.computeIfAbsent(key, k -> new ArrayList<>()).addAll(iss);
                recPlaces.merge(key, iss.size(), Integer::sum);
            }
        }
        for (Set<String> rs : recRules.values()) {
            for (String rule : rs) ruleEdits.get(rule)[1]++;
            sig.merge(String.join(",", new java.util.TreeSet<>(rs)), 1, Integer::sum);
        }

        Map<String, Object> rules = new LinkedHashMap<>();
        for (String rule : MdRefRules.RULES) {
            int[] v = ruleEdits.getOrDefault(rule, new int[2]);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("edits", v[0]); m.put("records", v[1]); m.put("enabled", enabled.contains(rule));
            m.put("default", MdRefRules.defaults().contains(rule));
            m.put("samples", samples.getOrDefault(rule, List.of()));
            rules.put(rule, m);
        }
        Map<String, Object> auto = new LinkedHashMap<>();
        auto.put("edits", autoEdits);
        auto.put("records", recRules.size());
        auto.put("rules", rules);
        auto.put("signatures", sig);

        Map<String, int[]> groups = new TreeMap<>();      // kind → [records, places]
        List<Map<String, Object>> rows = new ArrayList<>();
        int places = 0;
        for (Map.Entry<RecordKey, List<Map<String, Object>>> e : recIssues.entrySet()) {
            List<Map<String, Object>> iss = e.getValue();
            Set<String> kinds = new LinkedHashSet<>();
            Map<String, Integer> byKind = new LinkedHashMap<>();
            for (Map<String, Object> i : iss) {
                String k = String.valueOf(i.get("kind"));
                kinds.add(k);
                byKind.merge(k, 1, Integer::sum);
            }
            for (String k : kinds) {
                int[] g = groups.computeIfAbsent(k, x -> new int[2]);
                g[0]++;
                g[1] += byKind.get(k);
            }
            places += iss.size();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("type", e.getKey().type());
            row.put("id", e.getKey().id());
            row.put("places", iss.size());
            row.put("by_kind", byKind);
            row.put("issues", iss.subList(0, Math.min(ISSUES_PER_ROW, iss.size())));
            rows.add(row);
        }
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -((Integer) r.get("places")))
            .thenComparing(r -> String.valueOf(r.get("type"))).thenComparing(r -> String.valueOf(r.get("id"))));
        Map<String, Object> g = new LinkedHashMap<>();
        groups.forEach((k, v) -> g.put(k, Map.of("records", v[0], "places", v[1])));
        Map<String, Object> manual = new LinkedHashMap<>();
        manual.put("records", rows.size());
        manual.put("places", places);
        manual.put("groups", g);
        manual.put("rows", rows);
        List<Map<String, Object>> hiddenRows = new ArrayList<>();
        for (Map.Entry<String, Integer> h : hidden.entrySet()) {
            String[] p = h.getKey().split("\\|", 3);
            hiddenRows.add(Map.of("type", p[0], "id", p[1], "kind", p[2], "places", h.getValue()));
        }
        manual.put("dismissed", hiddenRows);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scanned", Map.of("records", records.size(), "fields", fields.size()));
        out.put("auto", auto);
        out.put("manual", manual);
        return out;
    }

    private static Map<String, Object> issue(String kind, String id, String field, String snippet, List<String> suggest) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind); m.put("id", id); m.put("field", field); m.put("snippet", snippet);
        if (suggest != null && !suggest.isEmpty()) m.put("suggest", suggest);
        return m;
    }

    /** Спринт-владелец: у задачи — спринт из пары, у спринта — он сам; одинокий код своего спринта однозначен. */
    static String ownerSprint(String type, String id) {
        if ("KnowSprint".equals(type)) return id;
        if (("KnowTask".equals(type) || "KnowPhase".equals(type)) && id.contains("/")) return id.substring(0, id.indexOf('/'));
        return null;
    }
}
