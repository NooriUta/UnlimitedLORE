package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Строки существующих срезов → {@code values}, {@code parts[].items}, {@code links}
 * паспорта {@code lore.record/1}. Чистые функции, без БД.
 *
 * <p>Ключи значений — те же, что у эмуляции фасада в web-next
 * ({@code passportAdapters.ts}: {@code effort}, {@code actual}, {@code prs},
 * {@code planned_start}, {@code created}, …): переход с клиентской эмуляции на
 * сервер не должен менять потребителя. Тело записи дополнительно идёт под
 * {@code body_md} (так его читает {@code fromLoreRecord}), а разделы — под своими
 * ключами ({@code context_md}, {@code outcome_md}, {@code note_md}, …).
 */
final class LoreRecordValues {

    private LoreRecordValues() {}

    static String str(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v);
        return s.isBlank() ? null : s;
    }

    static List<String> arr(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> l) for (Object o : l) { String s = str(o); if (s != null) out.add(s); }
        else { String s = str(v); if (s != null) out.add(s); }
        return out;
    }

    /**
     * Токен плана из свободного {@code status_raw} («✅ DONE — …» → done). Канон
     * QG-13 зовёт «в работе» {@code in_progress}, а словарь записи — {@code active}:
     * наружу идёт словарь записи, чтобы status_next и статус говорили одним языком.
     */
    static String planToken(String raw) {
        String c = LoreStatusVocabulary.classify(raw);
        if (LoreStatusVocabulary.NONE.equals(c)) return null;
        return "in_progress".equals(c) ? "active" : c;
    }

    /** Статус ADR/спеки: строчный код словаря («ACCEPTED» → accepted). */
    static String docToken(Object raw) {
        String s = str(raw);
        return s == null ? null : s.trim().toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}_ ]", "").trim().replace(' ', '_');
    }

    // ── values по типам ────────────────────────────────────────────────────

    /** Спринт из строки {@code sprint_tree}. */
    static Map<String, Object> sprint(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("name")) != null ? str(r.get("name")) : str(r.get("sprint_id")));
        v.put("body_md", str(r.get("context_md")));
        v.put("context_md", str(r.get("context_md")));
        v.put("outcome_md", str(r.get("outcome_md")));
        v.put("priority", str(r.get("priority")));
        v.put("projects", arr(r.get("git_projects")));
        v.put("components", arr(r.get("components")));
        v.put("releases", arr(r.get("release_ids")));
        v.put("milestones", arr(r.get("milestone_ids")));
        v.put("planned_start", str(r.get("planned_start_date")));
        v.put("planned_end_date", str(r.get("planned_end_date")));
        String created = str(r.get("created_date"));
        v.put("created", created == null ? null : created.substring(0, Math.min(10, created.length())));
        v.put("no_release", Boolean.TRUE.equals(r.get("no_release_required")) ? "Да" : null);
        v.put("track", str(r.get("track_id")));
        return v;
    }

    /** Задача из строки {@code tasks_by_uids}. */
    static Map<String, Object> task(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("title")) != null ? str(r.get("title")) : str(r.get("task_uid")));
        v.put("body_md", str(r.get("note_md")));
        v.put("note_md", str(r.get("note_md")));
        v.put("code", str(r.get("task_id")));
        v.put("sprint", str(r.get("sprint_id")));
        v.put("phase", str(r.get("phase_uid")));
        v.put("components", arr(r.get("component_ids")));
        v.put("effort", r.get("effort_days"));
        v.put("actual", r.get("actual_days"));
        v.put("author", str(r.get("author_agent")));
        v.put("executor", str(r.get("executor_agent")));
        v.put("reviewer", str(r.get("reviewer_agent")));
        v.put("task_type", str(r.get("task_type")));
        v.put("work_class", str(r.get("work_class")));
        v.put("realizes_uc", arr(r.get("realizes_uc")));
        v.put("prs", arr(r.get("closed_by_prs")));
        return v;
    }

    /** ADR из строки {@code adr}: три раздела текста отдельно, как в v1. */
    static Map<String, Object> adr(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("name")) != null ? str(r.get("name")) : str(r.get("adr_id")));
        v.put("context_md", trimmed(r.get("context_md")));
        v.put("decision_md", trimmed(r.get("decision_md")));
        v.put("consequences_md", trimmed(r.get("consequences_md")));
        v.put("date", str(r.get("date_created")));
        v.put("components", arr(r.get("components")));
        v.put("projects", arr(r.get("git_projects")));
        List<String> tags = arr(r.get("tags"));
        v.put("tags", tags);
        v.put("depends_on", arr(r.get("depends_on_ids")));
        v.put("supersedes", arr(r.get("supersedes_ids")));
        v.put("file_path", str(r.get("file_path")));
        return v;
    }

    /** Спека из строки {@code spec_by_id}. Тело может быть обнулено скоупом — тогда признак рядом. */
    static Map<String, Object> spec(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("title")) != null ? str(r.get("title")) : str(r.get("spec_id")));
        v.put("body_md", str(r.get("content_md")));
        v.put("content_md", str(r.get("content_md")));
        v.put("version", str(r.get("version")));
        v.put("summary", str(r.get("summary")));
        v.put("projects", arr(r.get("projects")));
        v.put("component", str(r.get("component_id")));
        v.put("file_path", str(r.get("file_path")));
        if (Boolean.TRUE.equals(r.get("body_redacted"))) {
            v.put("body_redacted", true);
            v.put("body_redacted_reason", r.get("body_redacted_reason"));
        }
        return v;
    }

    private static String trimmed(Object o) {
        String s = str(o);
        return s == null ? null : s.trim();
    }

    /** Умолчания пустого паспорта ({@code _new}) — как у путей создания. */
    static Map<String, Object> defaults(String type) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", "");
        switch (type) {
            case "sprint" -> v.put("status", "todo");        // sprint/create: status по умолчанию todo
            case "task" -> { v.put("status", "planned"); v.put("task_type", "dev"); } // task: 📋 PLANNED, dev
            case "adr" -> v.put("status", "proposed");
            case "spec" -> v.put("status", "proposed");
            default -> { }
        }
        return v;
    }

    // ── parts: строки детей → items ───────────────────────────────────────

    /** Строка задачи (tasks_of_sprint) → item части «Задачи» с колонками из реестра задачи. */
    static Map<String, Object> taskItem(Map<String, Object> r) {
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("status", planToken(str(r.get("status_raw"))));
        vals.put("task_type", str(r.get("task_type")));
        vals.put("code", str(r.get("task_id")));
        vals.put("title", str(r.get("title")));
        vals.put("executor", str(r.get("executor_agent")));
        vals.put("effort", r.get("effort_days"));
        vals.put("work_class", str(r.get("work_class")));
        vals.put("author", str(r.get("author_agent")));
        vals.put("reviewer", str(r.get("reviewer_agent")));
        vals.put("actual", r.get("actual_days"));
        vals.put("realizes_uc", arr(r.get("realizes_uc")));
        vals.put("prs", arr(r.get("closed_by_prs")));
        vals.put("phase_uid", str(r.get("phase_uid")));
        vals.put("has_note", str(r.get("note_md")) != null);
        return item(str(r.get("task_uid")), str(r.get("title")), (String) vals.get("status"), vals);
    }

    /** Строка фазы (phases_of_sprint) → item; «x/y» считается по задачам спринта. */
    static Map<String, Object> phaseItem(Map<String, Object> r, List<Map<String, Object>> taskItems) {
        String uid = str(r.get("phase_uid"));
        int total = 0, done = 0;
        for (Map<String, Object> t : taskItems) {
            @SuppressWarnings("unchecked") Map<String, Object> tv = (Map<String, Object>) t.get("values");
            if (uid != null && uid.equals(tv.get("phase_uid"))) {
                total++;
                if ("done".equals(tv.get("status"))) done++;
            }
        }
        String title = str(r.get("title")) != null ? str(r.get("title")) : str(r.get("phase_id"));
        String status = total > 0 && done == total ? "done" : done > 0 ? "partial" : null;
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("status", status);
        vals.put("title", title);
        vals.put("progress", done + "/" + total);
        vals.put("valid_from", str(r.get("valid_from")));
        vals.put("summary_md", str(r.get("summary_md")));
        return item(uid, title, status, vals);
    }

    /** Вопрос (questions_of_*) → item. */
    static Map<String, Object> questionItem(Map<String, Object> r) {
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("status", docToken(r.get("status")));
        vals.put("code", str(r.get("question_id")));
        vals.put("title", str(r.get("title")));
        vals.put("priority", str(r.get("priority")));
        vals.put("due_date", str(r.get("due_date")));
        return item(str(r.get("question_id")), str(r.get("title")), (String) vals.get("status"), vals);
    }

    /** Kit 09.11: паспорт решения (срез {@code decision}), только чтение. */
    static Map<String, Object> decision(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("title")) != null ? str(r.get("title")) : str(r.get("decision_id")));
        v.put("status", docToken(r.get("status_raw")));
        v.put("code", str(r.get("decision_id")));
        v.put("date", str(r.get("date_created")));
        v.put("adr", str(r.get("parent_adr")));
        v.put("components", arr(r.get("components")));
        v.put("projects", arr(r.get("projects")));
        v.put("tags", arr(r.get("tags")));
        v.put("body_md", str(r.get("body_md")));
        v.put("rationale_md", str(r.get("rationale_md")));
        return v;
    }

    /** Kit 09.11: счётчик в форме вычисляемого поля {value, known, of} — у счёта known = of. */
    static Map<String, Object> countOf(int n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("value", n);
        m.put("known", n);
        m.put("of", n);
        return m;
    }

    private static int intOf(Object v) {
        if (v instanceof Number n) return n.intValue();
        try { return v == null ? 0 : Integer.parseInt(String.valueOf(v)); } catch (NumberFormatException e) { return 0; }
    }

    /**
     * Вычисляемые итоги записи по строке её среза — отдельно от values (S7A-12 09.11: объект
     * {value, known, of} в values клиент рисует строкой, то есть мусором). Итоги спринта
     * считаются по задачам в фасаде (LoreSprintTotals), здесь — вехи и релиза.
     */
    static Map<String, Object> computed(String type, Map<String, Object> r) {
        Map<String, Object> c = new LinkedHashMap<>();
        switch (type == null ? "" : type) {
            case "milestone" -> c.put("sprints_total", countOf(arr(r.get("direct_sprint_ids")).size()));
            case "release" -> {
                c.put("sprints_total", countOf(intOf(r.get("sprint_count"))));
                c.put("prs_total", countOf(intOf(r.get("pr_count"))));
            }
            default -> { }
        }
        return c;
    }

    /** Kit 09.11: паспорт вехи (срез {@code milestone_by_id}), только чтение. */
    static Map<String, Object> milestone(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("label")) != null ? str(r.get("label")) : str(r.get("milestone_id")));
        v.put("code", str(r.get("milestone_id")));
        v.put("week", str(r.get("week")));
        v.put("date", str(r.get("date_display")));
        v.put("priority", str(r.get("priority")));
        v.put("products", arr(r.get("products")));
        v.put("goal_md", str(r.get("goal_md")));
        v.put("decisions_md", str(r.get("decisions_md")));
        return v;
    }

    /** Kit 09.11: паспорт релиза (срез {@code release_by_id}), только чтение. */
    static Map<String, Object> release(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        String tag = str(r.get("release_id")) != null ? str(r.get("release_id")) : str(r.get("git_tag"));
        v.put("title", str(r.get("version")) != null ? str(r.get("version")) : tag);
        v.put("code", tag);
        v.put("type", str(r.get("type")));
        v.put("date", str(r.get("release_date")));
        v.put("is_current", r.get("is_current") == null ? null : String.valueOf(r.get("is_current")));
        v.put("week", str(r.get("week")));
        v.put("projects", arr(r.get("projects")));
        v.put("description_md", str(r.get("description_md")));
        return v;
    }

    /** Kit 09.11: паспорт вопроса (срез {@code question_by_id}), только чтение. */
    static Map<String, Object> question(Map<String, Object> r) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", str(r.get("title")) != null ? str(r.get("title")) : str(r.get("question_id")));
        v.put("status", docToken(r.get("status")));
        v.put("code", str(r.get("question_id")));
        v.put("priority", str(r.get("priority")));
        v.put("due_date", str(r.get("due_date")));
        v.put("owner", str(r.get("owner")));
        v.put("raised_by", str(r.get("raised_by")));
        v.put("opened", str(r.get("opened_date")));
        v.put("closed", str(r.get("closed_date")));
        v.put("components", arr(r.get("components")));
        v.put("projects", arr(r.get("projects")));
        v.put("body_md", str(r.get("body_md")));
        return v;
    }

    /** Решение (decisions_of_adr) → item. */
    static Map<String, Object> decisionItem(Map<String, Object> r) {
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("status", docToken(r.get("status_raw")));
        vals.put("code", str(r.get("decision_id")));
        vals.put("title", str(r.get("title")));
        vals.put("date", str(r.get("date_created")));
        return item(str(r.get("decision_id")), str(r.get("title")), (String) vals.get("status"), vals);
    }

    private static Map<String, Object> item(String id, String title, String status, Map<String, Object> vals) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title != null ? title : id);
        m.put("status", status);
        m.put("values", vals);
        return m;
    }

    /** Связь {@code links[]}: {rel, dir, id, type, title, status} (+ свойства ребра). */
    static Map<String, Object> link(String rel, String dir, String id, String type, String title, String status) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("rel", rel);
        m.put("dir", dir);
        m.put("id", id);
        m.put("type", type);
        m.put("title", title != null ? title : id);
        m.put("status", status != null ? status : "");
        return m;
    }

    /** Связи по списку id одного ребра. */
    static List<Map<String, Object>> links(String rel, String dir, String type, List<String> ids) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String id : ids) out.add(link(rel, dir, id, type, id, null));
        return out;
    }
}
