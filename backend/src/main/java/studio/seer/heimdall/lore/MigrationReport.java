package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — отчёт прогона переноса для раздела админки «Перенос»: этапы конвейера,
 * группы расхождений и счётчик «ждут решения». Вход — отчёты конвейера как есть ({@code dryRun} из
 * {@code scripts/model-migration/dry-run.mjs}, {@code transfer} из {@code transfer.mjs}) и принятые правила.
 *
 * <p>Строка группы «не привелось» — значение со счётом записей; правило, принятое после прогона, видно у строки
 * сразу (отчёт ещё старый, следующий прогон применит правило сам). Сопоставление — как {@code find} в
 * decisions.mjs: точное значение сильнее причины, у записи действует и правило её версий (…Hist).
 */
final class MigrationReport {

    private MigrationReport() {}

    @SuppressWarnings("unchecked")
    static Map<String, Object> build(Map<String, Object> dry, Map<String, Object> transfer, List<Map<String, Object>> decisions) {
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> types = map(dry.get("types"));
        List<Object> unread = dry.get("unread") instanceof List<?> l ? new ArrayList<>(l) : new ArrayList<>();
        boolean sourceDown = !unread.isEmpty() || (dry.get("source_error") != null && !String.valueOf(dry.get("source_error")).isBlank());

        // ── Группы ────────────────────────────────────────────────────────
        Map<String, Map<String, Object>> byWhy = new LinkedHashMap<>();
        List<Map<String, Object>> heldRows = new ArrayList<>();
        long records = 0, rejected = 0, held = 0;
        int waiting = 0, heldWaiting = 0;
        for (Map.Entry<String, Object> te : types.entrySet()) {
            String T = te.getKey();
            Map<String, Object> t = map(te.getValue());
            records += num(t.get("records"));
            for (Map.Entry<String, Object> re : map(t.get("rejects")).entrySet()) {
                String[] fw = re.getKey().split(" · ", 2);
                String field = fw[0], why = fw.length > 1 ? fw[1] : "";
                Map<String, Object> e = map(re.getValue());
                long n = num(e.get("n"));
                rejected += n;
                Map<String, Object> g = byWhy.computeIfAbsent(why, w -> {
                    Map<String, Object> x = new LinkedHashMap<>();
                    x.put("kind", "reject");
                    x.put("why", w);
                    x.put("n", 0L);
                    x.put("rest", 0L);
                    x.put("rows", new ArrayList<Map<String, Object>>());
                    return x;
                });
                g.put("n", (Long) g.get("n") + n);
                long shown = 0;
                Map<String, Object> refs = map(e.get("refs"));
                for (Map.Entry<String, Object> se : map(e.get("samples")).entrySet()) {
                    long k = num(se.getValue());
                    shown += k;
                    Map<String, Object> d = decisionFor(decisions, T, field, se.getKey(), why);
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("type", T);
                    row.put("field", field);
                    row.put("value", se.getKey());
                    row.put("n", k);
                    row.put("refs", refsOf(T, refs.get(se.getKey())));
                    row.put("decision", d == null ? null : brief(d));
                    if (d == null || "defer".equals(d.get("action"))) waiting++;
                    ((List<Map<String, Object>>) g.get("rows")).add(row);
                }
                g.put("rest", (Long) g.get("rest") + Math.max(0, n - shown));
            }
            for (Map.Entry<String, Object> he : map(t.get("held")).entrySet()) {
                long n = num(he.getValue());
                if (n <= 0) continue;
                held += n;
                heldWaiting++;
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("type", T);
                row.put("field", he.getKey());
                row.put("value", null);
                row.put("n", n);
                row.put("refs", List.of());
                row.put("decision", null);
                heldRows.add(row);
            }
        }
        List<Map<String, Object>> groups = new ArrayList<>(byWhy.values());
        groups.sort((a, b) -> Long.compare((Long) b.get("n"), (Long) a.get("n")));
        for (Map<String, Object> g : groups)
            ((List<Map<String, Object>>) g.get("rows")).sort((a, b) -> Long.compare((Long) b.get("n"), (Long) a.get("n")));
        if (!heldRows.isEmpty()) {
            heldRows.sort((a, b) -> Long.compare((Long) b.get("n"), (Long) a.get("n")));
            Map<String, Object> g = new LinkedHashMap<>();
            g.put("kind", "held");
            g.put("why", LoreMigrationResource.HELD_WHY);
            g.put("n", held);
            g.put("rest", 0L);
            g.put("rows", heldRows);
            groups.add(g);
        }

        // ── Этапы ─────────────────────────────────────────────────────────
        Map<String, Object> st = transfer == null ? Map.of() : map(transfer.get("stages"));
        Map<String, Object> verify = map(st.get("verify"));
        boolean verifyFailed = transfer != null && st.containsKey("verify") && !Boolean.TRUE.equals(verify.get("ok"));
        List<Map<String, Object>> stages = new ArrayList<>();
        stages.add(stage("read", sourceDown ? "failed" : "done", records));
        stages.add(stage("calc", sourceDown ? "not_run" : (waiting > 0 ? "attention" : "done"), rejected));
        stages.add(stage("merge", st.containsKey("merge") ? "done" : "not_run", null));
        Map<String, Object> write = map(st.get("write"));
        long written = 0;
        for (Object v : map(write.get("records")).values()) written += num(v);
        stages.add(stage("write", st.containsKey("write") ? "done" : "not_run", st.containsKey("write") ? written : null));
        stages.add(stage("verify", !st.containsKey("verify") ? "not_run" : (verifyFailed ? "failed" : "ok"), null));

        out.put("state", sourceDown ? "source_unavailable" : verifyFailed ? "verify_failed" : "ready");
        out.put("unread", unread);
        out.put("stages", stages);
        out.put("groups", groups);
        out.put("waiting", waiting);
        out.put("held_waiting", heldWaiting);
        return out;
    }

    private static Map<String, Object> stage(String key, String state, Long n) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("key", key);
        s.put("state", state);
        s.put("n", n);
        return s;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> decisionFor(List<Map<String, Object>> decisions, String T, String field, String value, String why) {
        Map<String, Object> own = find(decisions, T, field, value, why);
        if (own != null || T.endsWith("Hist")) return own;
        return find(decisions, T + "Hist", field, value, why);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> find(List<Map<String, Object>> decisions, String T, String field, String value, String why) {
        Map<String, Object> byWhy = null;
        for (Map<String, Object> d : decisions) {
            Map<String, Object> s = map(d.get("scope"));
            if (!T.equals(s.get("type")) || !field.equals(s.get("field"))) continue;
            if (s.containsKey("value") && String.valueOf(s.get("value")).strip().equals(value.strip())) return d;
            if (s.containsKey("why") && Objects.equals(s.get("why"), why)) byWhy = d;
        }
        return byWhy;
    }

    private static Map<String, Object> brief(Map<String, Object> d) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("id", d.get("id"));
        b.put("action", d.get("action"));
        b.put("to", d.get("to"));
        return b;
    }

    /** Ключи записей → ссылки на паспорт: тип LORE по вершине из графа модели. У версий типа нет — ссылок нет. */
    private static List<Map<String, Object>> refsOf(String vertex, Object keys) {
        if (!(keys instanceof List<?> l) || l.isEmpty()) return List.of();
        String type = null;
        for (Map.Entry<String, LoreModelTypes.Graph> g : LoreModelTypes.GRAPH.entrySet()) {
            if (vertex.equals(g.getValue().vertex())) { type = g.getKey(); break; }
        }
        if (type == null) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object k : l) out.add(Map.of("type", type, "id", String.valueOf(k)));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o) {
        return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }
}
