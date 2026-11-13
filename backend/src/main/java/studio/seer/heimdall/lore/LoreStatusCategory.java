package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-06 — категория статуса на сервере.
 *
 * <p><b>Зачем.</b> «Открыто/закрыто» каждый клиент выводил сам, и наивная связка
 * «accepted = закрыто» прятала 180 принятых ADR из 241. Одна ось на все типы
 * (decision:D-2026-UXR-STATUS-AXIS, SPEC-LORE-UXR-S1-CONTRACTS контракт 2):
 * {@code not_started · in_progress · in_force · finished · withdrawn} + {@code unknown}.
 * Закрытые — только {@code finished} и {@code withdrawn}; {@code accepted} у
 * документов — «действует», открыто. Нераспознанное — {@code unknown}, открыто.
 *
 * <p><b>Источник правды</b> — {@code shared/lore-statuses.json}, секция
 * {@code statusCategories}; этот класс её зеркало, расхождение роняет
 * {@code LoreStatusesConsistencyTest}.
 *
 * <p>Наружу категория идёт аддитивным полем {@link #FIELD} в строках срезов
 * из {@link #SLICE_STATUS} (подключено в {@code AidaLoreResource.slice}).
 * Сами строки статуса не меняются.
 */
final class LoreStatusCategory {

    private LoreStatusCategory() {}

    /** Имя аддитивного поля в строке среза. */
    static final String FIELD = "status_category";

    static final String UNKNOWN = "unknown";

    static final List<String> CATEGORIES =
        List.of("not_started", "in_progress", "in_force", "finished", "withdrawn", UNKNOWN);

    static final Set<String> CLOSED = Set.of("finished", "withdrawn");

    static final Set<String> PLAN_TYPES = Set.of("task", "sprint");
    static final Set<String> DOC_TYPES = Set.of("adr", "spec", "decision");

    /** Задачи/спринты: ключи — planStatuses и каноны statusMatch. */
    static final Map<String, String> PLAN_MAP = Map.ofEntries(
        Map.entry("todo", "not_started"),
        Map.entry("planned", "not_started"),
        Map.entry("backlog", "not_started"),
        Map.entry("design", "not_started"),
        Map.entry("deferred", "not_started"),
        Map.entry("active", "in_progress"),
        Map.entry("in_progress", "in_progress"),
        Map.entry("partial", "in_progress"),
        Map.entry("blocked", "in_progress"),
        Map.entry("ready_for_deploy", "in_progress"),
        Map.entry("uat", "in_progress"),
        Map.entry("done", "finished"),
        Map.entry("cancelled", "withdrawn"),
        // WK-05: waiting и review — работа идёт; failed — закрыт отрицательным исходом, не «сделано».
        Map.entry("waiting", "in_progress"),
        Map.entry("review", "in_progress"),
        Map.entry("failed", "withdrawn"));

    /** ADR/спеки/решения. {@code fixed}/{@code done} решений — допущение S1-06. */
    static final Map<String, String> DOC_MAP = Map.ofEntries(
        Map.entry("draft", "not_started"),
        Map.entry("deferred", "not_started"),
        Map.entry("proposed", "in_progress"),
        Map.entry("accepted", "in_force"),
        Map.entry("fixed", "in_force"),
        Map.entry("done", "finished"),
        Map.entry("deprecated", "withdrawn"),
        Map.entry("superseded", "withdrawn"));

    /** Какой срез каким полем несёт статус какого типа. */
    record StatusSource(String type, String field) {}

    static final Map<String, StatusSource> SLICE_STATUS = Map.ofEntries(
        Map.entry("adrs", new StatusSource("adr", "status")),
        Map.entry("adr", new StatusSource("adr", "status")),
        Map.entry("specs", new StatusSource("spec", "status")),
        Map.entry("spec_by_id", new StatusSource("spec", "status")),
        Map.entry("decisions", new StatusSource("decision", "status_raw")),
        Map.entry("decisions_of_adr", new StatusSource("decision", "status_raw")),
        Map.entry("sprints", new StatusSource("sprint", "status_raw")),
        Map.entry("tasks_of_sprint", new StatusSource("task", "status_raw")),
        Map.entry("tasks_of_sprints_batch", new StatusSource("task", "status_raw")),
        Map.entry("tasks_by_uids", new StatusSource("task", "status_raw")),
        Map.entry("tasks_of_uc", new StatusSource("task", "status_raw")),
        Map.entry("open_tasks", new StatusSource("task", "status_raw")),
        Map.entry("closed_tasks", new StatusSource("task", "status_raw")),
        Map.entry("component_tasks", new StatusSource("task", "status_raw")),
        Map.entry("component_sprints", new StatusSource("sprint", "status_raw")),
        Map.entry("project_sprints", new StatusSource("sprint", "status_raw")),
        Map.entry("project_adrs", new StatusSource("adr", "status")),
        Map.entry("project_specs", new StatusSource("spec", "status")),
        Map.entry("project_decisions", new StatusSource("decision", "status_raw")),
        Map.entry("release_sprints", new StatusSource("sprint", "status_raw")),
        Map.entry("backlog_tasks", new StatusSource("task", "status_raw")),
        Map.entry("all_tasks", new StatusSource("task", "status_raw")),
        Map.entry("release_tasks_by_tag", new StatusSource("task", "status_raw")));

    /** Категория статуса {@code status} у сущности типа {@code type}. */
    static String of(String type, Object status) {
        if (type == null || status == null) return UNKNOWN;
        String raw = String.valueOf(status).strip();
        if (raw.isEmpty()) return UNKNOWN;
        String token = raw.toLowerCase(Locale.ROOT);
        if (DOC_TYPES.contains(type)) {
            return DOC_MAP.getOrDefault(token, UNKNOWN);
        }
        if (PLAN_TYPES.contains(type)) {
            String direct = PLAN_MAP.get(token);
            if (direct != null) return direct;
            // Свободный текст status_raw («✅ MERGED — …»): канон через словарь
            // значков/слов QG-13. Он отвечает «todo» на значок с неузнанным
            // словом и «none» на пустоту — пустоту мы отсекли выше.
            String canon = LoreStatusVocabulary.classify(raw);
            return PLAN_MAP.getOrDefault(canon, UNKNOWN);
        }
        return UNKNOWN;
    }

    static boolean isClosed(String category) {
        return CLOSED.contains(category);
    }

    /**
     * Добавляет {@link #FIELD} в каждую строку среза из {@link #SLICE_STATUS}.
     * Строке без поля статуса (ArcadeDB опускает null-свойства) достаётся
     * {@code unknown} — ключ есть всегда, иначе «не распознали» не отличить от
     * «сервер не умеет». Чужой срез возвращается тем же списком.
     */
    static List<Map<String, Object>> enrich(String sliceId, List<Map<String, Object>> rows) {
        StatusSource src = SLICE_STATUS.get(sliceId);
        if (src == null || rows == null || rows.isEmpty()) return rows;
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            if (row == null) { out.add(null); continue; }
            Map<String, Object> m = new LinkedHashMap<>(row);
            m.put(FIELD, of(src.type(), row.get(src.field())));
            out.add(m);
        }
        return out;
    }
}
