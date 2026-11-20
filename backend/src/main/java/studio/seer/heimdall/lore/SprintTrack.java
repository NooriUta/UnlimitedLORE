package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · трек спринта — ребро {@code ON_TRACK} спринт → трек, а не строка версии.
 *
 * <p>Решение владелицы 20.11.2026 «треки б»: трек — маленький справочник-вершина ({@code KnowTrack}: код, подпись, вид)
 * и историчная связь «спринт → трек», как у вехи ({@code TARGETS_MILESTONE}); «трек как веха но меньше паспорт ему
 * тоже сделай». Строка {@code track_id} версии спринта в 1.18 снята: перенос делает из неё ребро.
 * <ul>
 *   <li>чтение — по текущему ребру ({@code valid_to IS NULL}); где ребра нет, — прежняя строка версии: на старой
 *       схеме (до переноса) рёбер нет вовсе, и спринт показывает трек, как раньше ({@link #TRACK_ID});</li>
 *   <li>запись на базе 1.18 ({@link #onEdge()}) — ребро: смена трека закрывает прежнее {@code valid_to}, а не стирает
 *       (история в самой связи, раздел edge_history модели); пустое значение — снять трек (закрыть ребро);</li>
 *   <li>на старой схеме запись идёт прежним путём — полем версии (вершины KnowTrack там нет; новый шаг V на прод не
 *       накатывается, схема 1.18 собирается из модели переносом).</li>
 * </ul>
 * Правила без HTTP: база — через {@link Graph}, чтобы тот же код проверялся на встроенной ArcadeDB.
 */
final class SprintTrack {

    private SprintTrack() {}

    static final String EDGE = "ON_TRACK";
    static final String VERTEX = "KnowTrack";

    /** Прежняя строка версии: открытая версия, иначе любая версия с треком (как было до MDL-13). */
    static final String LEGACY_FIELD =
        "COALESCE(out('HAS_STATE')[valid_to IS NULL].track_id[0], out('HAS_STATE')[track_id IS NOT NULL].track_id[0])";

    /**
     * Текущий трек спринта: по ребру, без ребра — прежняя строка версии. Форма {@code [фильтр].@in.поле[0]} — та же,
     * что у ролей задачи и ответственного вопроса: {@code [фильтр].in.поле} молча даёт null.
     */
    static final String TRACK_ID = "COALESCE(outE('ON_TRACK')[valid_to IS NULL].@in.track_id[0], " + LEGACY_FIELD + ")";

    /** Колонки среза спринта: код трека и его подпись (подпись — только по ребру; на старой схеме её даёт выбор трека). */
    static final String COLUMNS = TRACK_ID + " AS track_id, outE('ON_TRACK')[valid_to IS NULL].@in.label[0] AS track_label";

    /** Есть ли трек с ровно таким кодом на базе 1.18. Параметр {@code :track_id}. */
    static final String EXISTS_SQL = "SELECT track_id FROM KnowTrack WHERE track_id = :track_id LIMIT 1";

    /** Доступ к базе: чтение и команда. */
    interface Graph {
        List<Map<String, Object>> query(String sql, Map<String, Object> params);
        void exec(String sql, Map<String, Object> params);
    }

    /** Запись трека — ребром: база собрана из модели 1.18 (там KnowTrack и ON_TRACK). Старая схема — полем версии. */
    static boolean onEdge() {
        return ModelSchemaAdapter.enabled();
    }

    private static String s(Object o) {
        return o == null ? null : String.valueOf(o).strip();
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("'", "\\'");
    }

    /** Тип ребра заводится при первой записи (база 1.18 получает его переносом, новая установка — здесь). */
    static void ensureType(Graph g) {
        g.exec("CREATE EDGE TYPE ON_TRACK IF NOT EXISTS", Map.of());
    }

    /** Текущие треки спринта (открытые рёбра). */
    static List<String> current(Graph g, String sprintId) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : g.query("SELECT @in.track_id AS t FROM ON_TRACK WHERE @out.sprint_id = :s AND valid_to IS NULL",
                Map.of("s", sprintId)))
            out.add(s(r.get("t")));
        return out;
    }

    /**
     * Поставить трек: тот же — ничего не меняется (unchanged); другой — прежнее ребро закрывается {@code valid_to},
     * новое открывается {@code valid_from} (replaced); не было — created; пустой код — снять трек (removed, или
     * unchanged, если снимать нечего). Трека нет — {@link IllegalArgumentException} до записи. Запись проверяется
     * чтением после неё: ребро не появилось — исключение, а не ok.
     */
    static Map<String, Object> assign(Graph g, String sprintId, String trackId, String origin, String now) {
        String t = s(trackId);
        boolean clear = t == null || t.isEmpty();
        if (!clear && g.query(EXISTS_SQL, Map.of("track_id", t)).isEmpty())
            throw new IllegalArgumentException("трека '" + t + "' нет (вершины KnowTrack). Трек выбирается из среза "
                + LoreSprintTracks.SLICE + "; новый трек заводится переносом треков доски, из UI треки не создаются.");
        ensureType(g);
        List<String> cur = current(g, sprintId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("track_id", clear ? null : t);
        if (clear ? cur.isEmpty() : cur.size() == 1 && Objects.equals(cur.get(0), t)) {
            out.put("outcome", "unchanged");
            return out;
        }
        if (!cur.isEmpty())
            g.exec("UPDATE ON_TRACK SET valid_to = :now WHERE @out.sprint_id = :s AND valid_to IS NULL",
                Map.of("now", now, "s", sprintId));
        if (!clear)
            // CREATE EDGE — через String.format: именованные параметры в SET у CREATE EDGE не связываются (TaskRoleService, V36).
            g.exec(String.format("CREATE EDGE ON_TRACK FROM (SELECT FROM KnowSprint WHERE sprint_id = '%s') "
                + "TO (SELECT FROM KnowTrack WHERE track_id = '%s') SET valid_from = '%s', origin = '%s'",
                esc(sprintId), esc(t), esc(now), esc(origin)), Map.of());
        List<String> after = current(g, sprintId);
        if (clear ? !after.isEmpty() : after.size() != 1 || !Objects.equals(after.get(0), t))
            throw new IllegalStateException("трек спринта " + sprintId + " не записан: открытых рёбер " + EDGE
                + " после записи " + after.size() + " — спринта или трека нет");
        out.put("outcome", clear ? "removed" : cur.isEmpty() ? "created" : "replaced");
        if (!cur.isEmpty()) out.put("previous", cur);
        return out;
    }
}
