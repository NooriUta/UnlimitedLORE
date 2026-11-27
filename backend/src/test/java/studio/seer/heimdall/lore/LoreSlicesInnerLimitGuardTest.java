package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-12 (ADR-LORE-061): опись внутренних LIMIT в SQL срезов — сторож-храповик.
 *
 * <p>Внутренний LIMIT режет выдачу среза ДО страницы {@link SlicePage}: total и has_more тогда считают
 * не все строки, а обрезок, и «0 строк дальше» не отличить от «дальше не смотрели». ADR-061 оставляет
 * вложенные LIMIT 1 (выбор одной записи в подзапросе), а обрезки/топ-N снимает отдельным шагом —
 * он меняет поведение и здесь не делается.</p>
 *
 * <p>Сторож держит текущее состояние явным списком: новый срез с LIMIT (или новый LIMIT в срезе из
 * списка) — красный; снятый LIMIT тоже красный, пока запись не вычеркнута из списка — храповик
 * ходит только в сторону «меньше».</p>
 */
class LoreSlicesInnerLimitGuardTest {

    private static final Pattern LIMIT = Pattern.compile("(?i)\\bLIMIT\\s+(\\S+)");

    /** Опись: срез → число LIMIT в его SQL (baseSql + suffix). Заполняется ниже по группам. */
    static final Map<String, Integer> KNOWN = new TreeMap<>();

    private static void group(int perSlice, String... ids) {
        for (String id : ids) KNOWN.put(id, perSlice);
    }

    static {
        // Опись 26.11.2026: 47 срезов, 65 LIMIT. Сверка с ADR-061 («71: 19 LIMIT 1 + 52 обрезки») —
        // в отчёте KREG-12: LIMIT 1 сошлось (19), обрезок по SQL срезов — 46.

        // (1) LIMIT 1 — карточка одной записи по id / последняя запись. Остаются (ADR-061): это выбор,
        //     а не обрезка — страница над одной строкой ничего не теряет.
        group(1, "actor_by_id", "doc_by_id", "finding_by_id", "gain_by_id", "job_by_id", "org_by_id",
            "pain_by_id", "pr_by_id", "quality_gate_by_id", "question_by_id", "repo_by_id", "routine_last_run",
            "routine_output_by_type", "runbook_by_id", "spec_by_id", "task_identities", "tech_by_id",
            "track_by_id", "uc_by_id");

        // (2) search — топ-N по каждому типу внутри объединения (15 / 10 на тип, 19 подзапросов):
        //     ранжированный поиск, total здесь — «сколько показали», не «сколько нашлось».
        group(19, "search");

        // (3) Журналы — последние N событий (входы, сессии, запросы, ошибки, действия, QG-прогоны).
        //     Обрезка: снимается отдельным шагом ADR-061 (меняет выдачу).
        group(1, "admin_actions", "agent_actions", "agent_sessions", "bragi_analytics", "logins_by_user",
            "logins_recent", "mcp_connections", "mcp_failure_rows", "mcp_failures", "project_role_events",
            "qg_job_tasks", "qg_metrics", "qg_routine_runs", "qg_run_history", "qg_violations", "query_errors",
            "requests_by_caller", "requests_total", "routine_outputs", "sessions_recent");

        // (4) История и ленты — последние N версий/вех (ADR/решения/спеки, таймлайны, релизы).
        //     Обрезка: снимается отдельным шагом ADR-061.
        group(1, "adr_history_all", "decision_history_all", "spec_history_all", "timeline_adrs",
            "timeline_releases", "timeline_specs", "releases_since");
    }

    /** LIMIT в SQL среза: значения после слова LIMIT, по порядку. */
    static List<String> limits(LoreSlices.SliceDef d) {
        String sql = d.baseSql() + " " + (d.suffix() == null ? "" : d.suffix());
        List<String> out = new java.util.ArrayList<>();
        Matcher m = LIMIT.matcher(sql);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    static Map<String, Integer> actual() {
        Map<String, Integer> a = new TreeMap<>();
        for (String id : LoreSlices.ids()) {
            int n = limits(LoreSlices.get(id)).size();
            if (n > 0) a.put(id, n);
        }
        return a;
    }

    @Test
    void noNewInnerLimits() {
        Map<String, Integer> a = actual();
        List<String> fresh = new java.util.ArrayList<>();
        for (var e : a.entrySet()) {
            Integer known = KNOWN.get(e.getKey());
            if (known == null || e.getValue() > known)
                fresh.add(e.getKey() + "=" + e.getValue() + " " + limits(LoreSlices.get(e.getKey())));
        }
        assertEquals(List.of(), fresh, "новый внутренний LIMIT в срезе — страница SlicePage/SliceQuery "
            + "перестаёт видеть total; режьте страницей, а не LIMIT в SQL (ADR-LORE-061)");
    }

    @Test
    void ratchetOnlyGoesDown() {
        Map<String, Integer> a = actual();
        List<String> stale = new java.util.ArrayList<>();
        for (var e : KNOWN.entrySet()) {
            int now = a.getOrDefault(e.getKey(), 0);
            if (now < e.getValue()) stale.add(e.getKey() + ": опись " + e.getValue() + ", в SQL " + now);
        }
        assertEquals(List.of(), stale, "LIMIT снят — вычеркните/уменьшите запись в описи (храповик)");
        assertTrue(new TreeSet<>(LoreSlices.ids()).containsAll(KNOWN.keySet()), "в описи срез, которого нет");
    }
}
