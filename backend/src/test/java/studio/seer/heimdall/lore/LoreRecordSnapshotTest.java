package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-RECORD — сверка снимков сборки паспорта {@code lore.record/1}.
 *
 * <p>Страховка рефакторинга «паспорт из модели»: {@link Legacy} — замороженная копия 14 ручных
 * функций сборки (11 типов + строки частей задач, вопросов, решений), связей из строки и связей
 * отдельных срезов в том виде, в каком они были до перевода на общий сборщик. Для каждого из
 * 11 типов на фиксированных строках — полной и её вариантах (без каждой колонки по очереди,
 * с пустой строкой вместо каждой колонки, пустая строка целиком) — ответ сборки фасада обязан
 * совпасть со снимком: те же ключи, в том же порядке, те же значения.
 *
 * <p>Тест зелёный ДО рефакторинга (тогда фасад ещё вызывает те же функции) и обязан остаться
 * зелёным после каждого шага перевода.
 */
class LoreRecordSnapshotTest {

    // ── Фиксированные строки главных срезов ──────────────────────────────────

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    static final Map<String, Map<String, Object>> ROWS = new LinkedHashMap<>();

    /** Типы, рождённые после перевода на общий сборщик: снимка «до» у них нет. */
    static final List<String> POST_REFACTOR = List.of("project", "product");

    /**
     * Значения, которые общий сборщик отдаёт СВЕРХ снимка — поля, заведённые после рефакторинга
     * (S4-PRODUCTS-NODE: «Продукты» компонента, IN_PRODUCT). Снимок «до» их не знал; сверка идёт
     * без них, а само значение проверяет ProductPassportTest. Список явный: молча расширить
     * значения типа нельзя.
     */
    static final Map<String, List<String>> ADDED_AFTER = Map.of("component", List.of("products"));

    /** Значения сборщика без полей, заведённых после снимка ({@link #ADDED_AFTER}). */
    static Map<String, Object> sansAdded(String type, Map<String, Object> v) {
        Map<String, Object> out = new LinkedHashMap<>(v);
        for (String k : ADDED_AFTER.getOrDefault(type, List.of())) out.remove(k);
        return out;
    }

    static {
        ROWS.put("sprint", m("sprint_id", "SPRINT_SNAP", "name", "Спринт снимка", "status_raw", "✅ DONE — закрыт",
            "context_md", "ctx", "outcome_md", "итог", "priority", "P1", "git_projects", List.of("AIDA/UnlimitedLORE", "x/y"),
            "components", List.of("CMP-A"), "release_ids", List.of("v1.0.0"), "milestone_ids", List.of("M-1"),
            "planned_start_date", "2026-11-01", "planned_end_date", "2026-11-20", "created_date", "2026-10-30T10:11:12Z",
            "no_release_required", true, "track_id", "TRK", "depends_on", List.of("SPRINT_A"), "blocks", List.of("SPRINT_B"),
            "adr_ids", List.of("ADR-1")));
        ROWS.put("task", m("task_uid", "SPRINT_SNAP/T-1", "task_id", "T-1", "title", "Задача", "status_raw", "🔄 IN PROGRESS",
            "note_md", "заметка", "sprint_id", "SPRINT_SNAP", "phase_uid", "SPRINT_SNAP/PH-1", "component_ids", List.of("CMP-A"),
            "effort_days", 1.5, "actual_days", 2, "author_agent", "a", "executor_agent", "e", "reviewer_agent", "r",
            "task_type", "dev", "work_class", "enb", "realizes_uc", List.of("UC-1"), "closed_by_prs", List.of("AIDA/UnlimitedLORE#7")));
        ROWS.put("adr", m("adr_id", "ADR-SNAP", "name", "ADR снимка", "status", "ACCEPTED", "context_md", "  к  ",
            "decision_md", "р\n", "consequences_md", " с", "date_created", "2026-11-01", "components", List.of("CMP-A"),
            "git_projects", List.of("AIDA/UnlimitedLORE"), "tags", List.of("t1", "t2"), "depends_on_ids", List.of("ADR-D"),
            "supersedes_ids", List.of("ADR-OLD"), "file_path", "docs/adr.md", "blocks_ids", List.of("ADR-B"),
            "superseded_by_ids", List.of("ADR-NEW"), "implemented_in_ids", List.of("SPRINT_SNAP"), "release_ids", List.of("v1"),
            "justified_task_uids", List.of("SPRINT_SNAP/T-1"), "traced_by_ucs", List.of("UC-2")));
        ROWS.put("spec", m("spec_id", "SPEC-SNAP", "title", "Спека", "status", "Draft (v0)", "content_md", "тело",
            "version", "0.1.0", "summary", "кратко", "projects", List.of("AIDA/UnlimitedLORE"), "component_id", "CMP-A",
            "file_path", "docs/spec.md", "body_redacted", true, "body_redacted_reason", "скоуп"));
        ROWS.put("decision", m("decision_id", "D-SNAP", "title", "Решение", "status_raw", "✅ Accepted", "date_created", "2026-11-02",
            "parent_adr", "ADR-SNAP", "components", List.of("CMP-A"), "projects", List.of("P"), "tags", List.of("t"),
            "body_md", "тело", "rationale_md", "почему", "supersedes_ids", List.of("D-OLD"), "answers_ids", List.of("Q-1")));
        ROWS.put("question", m("question_id", "Q-SNAP", "title", "Вопрос", "status", "OPEN", "priority", "high",
            "due_date", "2026-12-01", "owner", "o", "raised_by", "rb", "opened_date", "2026-11-01", "closed_date", "2026-11-03",
            "components", List.of("CMP-A"), "projects", List.of("P"), "body_md", "тело", "answered_by", List.of("D-1"),
            "gating_tasks", List.of("SPRINT_SNAP/T-1")));
        ROWS.put("milestone", m("milestone_id", "M-SNAP", "label", "Веха", "status", "planned", "week", "W45",
            "date_display", "10.11", "priority", "P0", "products", List.of("LORE"), "goal_md", "цель", "decisions_md", "реш",
            "direct_sprint_ids", List.of("SPRINT_SNAP", "SPRINT_A")));
        ROWS.put("release", m("release_id", "v1.17.4", "git_tag", "v1.17.4-tag", "version", "1.17.4", "status", "released",
            "type", "patch", "release_date", "2026-11-05", "is_current", true, "week", "W45", "projects", List.of("AIDA/UnlimitedLORE"),
            "description_md", "описание", "sprint_count", 2, "pr_count", 3));
        ROWS.put("component", m("component_id", "CMP-SNAP", "full_name", "Компонент", "status", "active", "area", "backend",
            "parent_id", "CMP-PARENT", "owner", "o", "team", "t", "game_icon", "anvil", "sub_components", List.of("CMP-SUB"),
            "tech", List.of("quarkus"), "adrs", List.of("ADR-1"), "specs", List.of("SPEC-TECH-CMP-QUARKUS", "SPEC-A")));
        ROWS.put("tech", m("spec_id", "SPEC-TECH-CMP-QUARKUS", "tech_name", "Quarkus", "status", "ACTIVE", "version", "3.15",
            "checked_at", "2026-11-01", "component_id", "CMP-SNAP", "content_md", "тело"));
        ROWS.put("feature", m("uc_id", "UC-SNAP", "title", "Фича", "status", "proposed", "goal_level", "user", "rigor", "casual",
            "priority", "P1", "date_created", "2026-11-01", "shipped_at", "2026-11-09", "parent_uc_ids", List.of("UC-P1", "UC-P2"),
            "parent_uc_id", "UC-DENORM", "child_uc_ids", List.of("UC-C"), "component_ids", List.of("CMP-A"), "projects", List.of("P"),
            "task_uids", List.of("SPRINT_SNAP/T-1"), "body_md", "тело", "context_md", "к", "scenario_md", "с", "acceptance_md", "п",
            "actor_ids", List.of("ACT-1"), "pain_ids", List.of("PAIN-1"), "gain_ids", List.of("GAIN-1"), "job_ids", List.of("JOB-1")));
    }

    /** Строки детей частей: задача (tasks_of_sprint), вопрос, решение. */
    static final Map<String, Map<String, Object>> ITEM_ROWS = new LinkedHashMap<>();

    static {
        ITEM_ROWS.put("task", ROWS.get("task"));
        ITEM_ROWS.put("question", ROWS.get("question"));
        ITEM_ROWS.put("decision", ROWS.get("decision"));
    }

    /** Строки отдельных срезов вкладок: тип.ключ → строка. */
    static final Map<String, Map<String, Object>> SLICE_ROWS = new LinkedHashMap<>();

    static {
        SLICE_ROWS.put("task.adrs", m("adr_id", "ADR-1", "name", "ADR один", "status", "ACCEPTED"));
        SLICE_ROWS.put("task.gates", m("question_id", "Q-1", "title", "Вопрос", "status", "OPEN"));
        SLICE_ROWS.put("release.sprints", m("sprint_id", "SPRINT_A", "name", "Спринт", "status_raw", "✅ DONE"));
        SLICE_ROWS.put("release.prs", m("pr_uid", "AIDA/UnlimitedLORE#7", "pr_number", 7, "title", "PR"));
        SLICE_ROWS.put("component.tasks", m("task_uid", "SPRINT_A/T-1", "title", "Задача", "status_raw", "📋 PLANNED"));
        SLICE_ROWS.put("component.sprints", m("sprint_id", "SPRINT_A", "name", "Спринт", "status_raw", "✅ DONE"));
    }

    /** Полная строка и её варианты: без каждой колонки, с « » вместо каждой, одиночное значение вместо списка, пустая. */
    static List<Map<String, Object>> variants(Map<String, Object> full) {
        List<Map<String, Object>> out = new ArrayList<>();
        out.add(full);
        for (String k : full.keySet()) {
            Map<String, Object> without = new LinkedHashMap<>(full);
            without.remove(k);
            out.add(without);
            Map<String, Object> blank = new LinkedHashMap<>(full);
            blank.put(k, " ");
            out.add(blank);
            if (full.get(k) instanceof List<?> l && !l.isEmpty()) {
                Map<String, Object> single = new LinkedHashMap<>(full);
                single.put(k, l.get(0));
                out.add(single);
                Map<String, Object> empty = new LinkedHashMap<>(full);
                empty.put(k, List.of());
                out.add(empty);
            }
            if (full.get(k) instanceof Boolean) {
                Map<String, Object> flipped = new LinkedHashMap<>(full);
                flipped.put(k, false);
                out.add(flipped);
            }
        }
        out.add(new LinkedHashMap<>());
        return out;
    }

    /** Совпадение со снимком: равенство и тот же порядок ключей на всех уровнях (toString LinkedHashMap). */
    static void assertSnapshot(Object expected, Object actual, String where) {
        assertEquals(expected, actual, where);
        assertEquals(String.valueOf(expected), String.valueOf(actual), where + " — порядок ключей");
    }

    // ── Сверка ───────────────────────────────────────────────────────────────

    @Test
    void elevenTypesAreCovered() {
        // Проект (S4-29, 53а) заведён ПОСЛЕ перевода на общий сборщик: ручной функции у него не
        // было никогда, сверять не с чем — его значения проверяет ProjectPassportTest.
        List<String> legacy = new ArrayList<>(LoreRecordRegistry.TYPES);
        legacy.removeAll(POST_REFACTOR);
        assertEquals(legacy, new ArrayList<>(ROWS.keySet()), "снимок покрывает все типы паспорта, бывшие до рефакторинга");
    }

    @Test
    void valuesMatchSnapshotForAllElevenTypes() {
        for (String type : ROWS.keySet())
            for (Map<String, Object> row : variants(ROWS.get(type)))
                assertSnapshot(Legacy.values(type, row), sansAdded(type, LoreRecordValues.values(type, row)), type + " values " + row);
    }

    @Test
    void rowLinksMatchSnapshotForAllElevenTypes() {
        for (String type : ROWS.keySet())
            for (Map<String, Object> row : variants(ROWS.get(type)))
                assertSnapshot(Legacy.rowLinks(type, row), LoreRecordValues.rowLinks(type, row), type + " links " + row);
    }

    @Test
    void partItemsMatchSnapshot() {
        for (String child : ITEM_ROWS.keySet())
            for (Map<String, Object> row : variants(ITEM_ROWS.get(child)))
                assertSnapshot(Legacy.partItem(child, row), LoreRecordValues.partItem(child, row), child + " item " + row);
    }

    @Test
    void sliceLinksMatchSnapshot() {
        for (String tk : SLICE_ROWS.keySet()) {
            String[] p = tk.split("\\.");
            for (Map<String, Object> row : variants(SLICE_ROWS.get(tk)))
                assertSnapshot(Legacy.sliceLink(p[0], p[1], row), LoreRecordValues.sliceLink(p[0], p[1], row), tk + " " + row);
        }
    }

    /** Снимок сам по себе не пустой: опорные точки преобразований видны глазами. */
    @Test
    void snapshotAnchors() {
        Map<String, Object> s = Legacy.values("sprint", ROWS.get("sprint"));
        assertEquals("2026-10-30", s.get("created"));
        assertEquals("Да", s.get("no_release"));
        assertEquals("done", s.get("status"));
        assertEquals("ctx", s.get("body_md"));
        Map<String, Object> a = Legacy.values("adr", ROWS.get("adr"));
        assertEquals("к", a.get("context_md"));
        assertEquals("accepted", a.get("status"));
        Map<String, Object> sp = Legacy.values("spec", ROWS.get("spec"));
        assertEquals(true, sp.get("body_redacted"));
        Map<String, Object> r = Legacy.values("release", ROWS.get("release"));
        assertEquals("1.17.4", r.get("title"));
        assertEquals("v1.17.4", r.get("code"));
        assertEquals("true", r.get("is_current"));
        Map<String, Object> f = Legacy.values("feature", ROWS.get("feature"));
        assertEquals("UC-P1", f.get("parent"));
        Map<String, Object> f2 = new LinkedHashMap<>(ROWS.get("feature"));
        f2.put("parent_uc_ids", List.of());
        assertEquals("UC-DENORM", Legacy.values("feature", f2).get("parent"));
        List<Map<String, Object>> cl = Legacy.rowLinks("component", ROWS.get("component"));
        assertEquals("tech", cl.get(0).get("type"));
        assertEquals("spec", cl.get(1).get("type"));
    }

    // ── Замороженная копия сборки до S4-MODEL-RECORD ─────────────────────────

    /** Копия LoreRecordValues и связей фасада (develop 4d67cb55 + вкладки компонента b8a2d5ba) — НЕ править: это и есть снимок. */
    static final class Legacy {
        private static String str(Object v) { return LoreRecordValues.str(v); }
        private static List<String> arr(Object v) { return LoreRecordValues.arr(v); }
        private static String planToken(String raw) { return LoreRecordValues.planToken(raw); }
        private static String docToken(Object raw) { return LoreRecordValues.docToken(raw); }
        private static String trimmed(Object o) { String s = str(o); return s == null ? null : s.trim(); }

        static Map<String, Object> values(String type, Map<String, Object> r) {
            Map<String, Object> values = switch (type) {
                case "sprint" -> sprint(r);
                case "task" -> task(r);
                case "adr" -> adr(r);
                case "decision" -> decision(r);
                case "question" -> question(r);
                case "milestone" -> milestone(r);
                case "release" -> release(r);
                case "component" -> component(r);
                case "tech" -> tech(r);
                case "feature" -> feature(r);
                default -> spec(r);
            };
            String status = switch (type) {
                case "sprint", "task" -> planToken(str(r.get("status_raw")));
                case "decision" -> docToken(r.get("status_raw"));
                default -> docToken(r.get("status"));
            };
            values.put("status", status);
            return values;
        }

        static Map<String, Object> partItem(String childType, Map<String, Object> r) {
            return switch (childType) {
                case "question" -> questionItem(r);
                case "decision" -> decisionItem(r);
                default -> taskItem(r);
            };
        }

        static Map<String, Object> sliceLink(String type, String key, Map<String, Object> r) {
            return switch (type + "." + key) {
                case "task.adrs" -> link("JUSTIFIED_BY", "out", str(r.get("adr_id")), "adr", str(r.get("name")), docToken(r.get("status")));
                case "task.gates" -> link("GATES", "in", str(r.get("question_id")), "question", str(r.get("title")), docToken(r.get("status")));
                case "release.sprints" -> link("IMPLEMENTED_IN_RELEASE", "in", str(r.get("sprint_id")), "sprint", str(r.get("name")),
                    planToken(str(r.get("status_raw"))));
                case "release.prs" -> {
                    String uid = str(r.get("pr_uid"));
                    yield link("SHIPPED_IN", "in", uid != null ? uid : str(r.get("pr_number")), "pr", str(r.get("title")), null);
                }
                // develop b8a2d5ba (#1126, S4-29): вкладки «Задачи» · «Спринты» компонента.
                case "component.tasks" -> link("TAGGED_WITH", "in", str(r.get("task_uid")), "task", str(r.get("title")),
                    planToken(str(r.get("status_raw"))));
                case "component.sprints" -> link("BELONGS_TO", "in", str(r.get("sprint_id")), "sprint", str(r.get("name")),
                    planToken(str(r.get("status_raw"))));
                default -> throw new IllegalArgumentException(type + "." + key);
            };
        }

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

        static Map<String, Object> adr(Map<String, Object> r) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("title", str(r.get("name")) != null ? str(r.get("name")) : str(r.get("adr_id")));
            v.put("context_md", trimmed(r.get("context_md")));
            v.put("decision_md", trimmed(r.get("decision_md")));
            v.put("consequences_md", trimmed(r.get("consequences_md")));
            v.put("date", str(r.get("date_created")));
            v.put("components", arr(r.get("components")));
            v.put("projects", arr(r.get("git_projects")));
            v.put("tags", arr(r.get("tags")));
            v.put("depends_on", arr(r.get("depends_on_ids")));
            v.put("supersedes", arr(r.get("supersedes_ids")));
            v.put("file_path", str(r.get("file_path")));
            return v;
        }

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

        static Map<String, Object> questionItem(Map<String, Object> r) {
            Map<String, Object> vals = new LinkedHashMap<>();
            vals.put("status", docToken(r.get("status")));
            vals.put("code", str(r.get("question_id")));
            vals.put("title", str(r.get("title")));
            vals.put("priority", str(r.get("priority")));
            vals.put("due_date", str(r.get("due_date")));
            return item(str(r.get("question_id")), str(r.get("title")), (String) vals.get("status"), vals);
        }

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

        static Map<String, Object> component(Map<String, Object> r) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("title", str(r.get("full_name")) != null ? str(r.get("full_name")) : str(r.get("component_id")));
            v.put("code", str(r.get("component_id")));
            v.put("area", str(r.get("area")));
            v.put("parent", str(r.get("parent_id")));
            v.put("owner", str(r.get("owner")));
            v.put("team", str(r.get("team")));
            v.put("icon", str(r.get("game_icon")));
            v.put("children", arr(r.get("sub_components")));
            v.put("tech", arr(r.get("tech")));
            v.put("adrs", arr(r.get("adrs")));
            v.put("specs", arr(r.get("specs")));
            // 11.11 (полнота модели рёбер): + продукты компонента (IN_PRODUCT) — новый ключ, не замена.
            v.put("products", arr(r.get("products")));
            return v;
        }

        static Map<String, Object> tech(Map<String, Object> r) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("title", str(r.get("tech_name")) != null ? str(r.get("tech_name")) : str(r.get("spec_id")));
            v.put("code", str(r.get("spec_id")));
            v.put("version", str(r.get("version")));
            v.put("checked_at", str(r.get("checked_at")));
            v.put("component", str(r.get("component_id")));
            v.put("body_md", str(r.get("content_md")));
            v.put("content_md", str(r.get("content_md")));
            return v;
        }

        static Map<String, Object> feature(Map<String, Object> r) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("title", str(r.get("title")) != null ? str(r.get("title")) : str(r.get("uc_id")));
            v.put("code", str(r.get("uc_id")));
            v.put("goal_level", str(r.get("goal_level")));
            v.put("rigor", str(r.get("rigor")));
            v.put("priority", str(r.get("priority")));
            v.put("date", str(r.get("date_created")));
            v.put("shipped_at", str(r.get("shipped_at")));
            List<String> parents = arr(r.get("parent_uc_ids"));
            v.put("parent", !parents.isEmpty() ? parents.get(0) : str(r.get("parent_uc_id")));
            v.put("children", arr(r.get("child_uc_ids")));
            v.put("components", arr(r.get("component_ids")));
            v.put("projects", arr(r.get("projects")));
            v.put("tasks", arr(r.get("task_uids")));
            v.put("body_md", str(r.get("body_md")));
            v.put("context_md", str(r.get("context_md")));
            v.put("scenario_md", str(r.get("scenario_md")));
            v.put("acceptance_md", str(r.get("acceptance_md")));
            return v;
        }

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

        static List<Map<String, Object>> links(String rel, String dir, String type, List<String> ids) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (String id : ids) out.add(link(rel, dir, id, type, id, null));
            return out;
        }

        static List<Map<String, Object>> rowLinks(String type, Map<String, Object> row) {
            List<Map<String, Object>> l = new ArrayList<>();
            switch (type) {
                case "sprint" -> {
                    l.addAll(links("DEPENDS_ON", "out", "sprint", arr(row.get("depends_on"))));
                    l.addAll(links("DEPENDS_ON", "in", "sprint", arr(row.get("blocks"))));
                    l.addAll(links("IMPLEMENTED_IN", "in", "adr", arr(row.get("adr_ids"))));
                }
                case "task" -> {
                    l.addAll(links("CLOSED_BY", "out", "pr", arr(row.get("closed_by_prs"))));
                    l.addAll(links("REALIZES", "out", "use_case", arr(row.get("realizes_uc"))));
                }
                case "adr" -> {
                    l.addAll(links("DEPENDS_ON", "out", "adr", arr(row.get("depends_on_ids"))));
                    l.addAll(links("DEPENDS_ON", "in", "adr", arr(row.get("blocks_ids"))));
                    l.addAll(links("SUPERSEDES", "out", "adr", arr(row.get("supersedes_ids"))));
                    l.addAll(links("SUPERSEDES", "in", "adr", arr(row.get("superseded_by_ids"))));
                    l.addAll(links("IMPLEMENTED_IN", "out", "sprint", arr(row.get("implemented_in_ids"))));
                    l.addAll(links("IMPLEMENTED_IN_RELEASE", "out", "release", arr(row.get("release_ids"))));
                    l.addAll(links("JUSTIFIED_BY", "in", "task", arr(row.get("justified_task_uids"))));
                    l.addAll(links("TRACED_TO", "in", "use_case", arr(row.get("traced_by_ucs"))));
                }
                case "decision" -> {
                    l.addAll(links("SUPERSEDES", "out", "decision", arr(row.get("supersedes_ids"))));
                    l.addAll(links("ANSWERS", "out", "question", arr(row.get("answers_ids"))));
                }
                case "question" -> {
                    l.addAll(links("ANSWERS", "in", "decision", arr(row.get("answered_by"))));
                    l.addAll(links("GATES", "out", "task", arr(row.get("gating_tasks"))));
                }
                case "milestone" -> l.addAll(links("TARGETS_MILESTONE", "in", "sprint", arr(row.get("direct_sprint_ids"))));
                case "component" -> {
                    for (String s : arr(row.get("specs")))
                        l.add(link("DOCUMENTED_IN", "out", s, s.startsWith("SPEC-TECH-") ? "tech" : "spec", s, null));
                    l.addAll(links("BELONGS_TO", "in", "adr", arr(row.get("adrs"))));
                    l.addAll(links("USES", "out", "tech_ref", arr(row.get("tech"))));
                    l.addAll(links("PARENT_OF", "in", "component", arr(row.get("sub_components"))));
                }
                case "feature" -> {
                    l.addAll(links("DECOMPOSES_INTO", "out", "feature", arr(row.get("child_uc_ids"))));
                    l.addAll(links("REALIZES", "in", "task", arr(row.get("task_uids"))));
                    l.addAll(links("HAS_ACTOR", "out", "actor", arr(row.get("actor_ids"))));
                    l.addAll(links("ADDRESSES", "out", "pain", arr(row.get("pain_ids"))));
                    l.addAll(links("PROMISES", "out", "gain", arr(row.get("gain_ids"))));
                    l.addAll(links("HELPS_WITH", "out", "job", arr(row.get("job_ids"))));
                }
                default -> { }
            }
            return l;
        }
    }
}
