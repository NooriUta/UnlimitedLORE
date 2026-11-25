package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05, заметка 21.11.2026 (владелица: «к вопросу слайсов и поиска») — ОДИН параметр
 * проекта у всех проектных срезов и у {@code find}.
 *
 * <p>Было два имени: {@code project} — у срезов, которые фильтруют по проекту своим SQL (open_tasks, sprints,
 * паспорт проекта…), и {@code scope_projects} — выбор проектов в шапке, сужающий любой срез из
 * {@link LoreSlices#PROJECT_SCOPED}. Срез {@code adrs} знал только второе и на {@code ?project=} отвечал 400
 * «unknown param: project» — Mobilepoc не смогла отфильтровать ADR по проекту.
 *
 * <p>Правило:
 * <ul>
 *   <li>каноническое имя — {@code project} (так его называют ~40 срезов, MCP с подстановкой LORE_ACTIVE_PROJECT
 *       и паспорт проекта); у проектного среза без своего SQL-фильтра оно уходит в сужение скоупом — тем же путём,
 *       что выбор в шапке (пересечение с правами, а не вместо них);</li>
 *   <li>{@code scope_projects} — прежнее имя: работает как раньше, ответ несёт {@code _warning};</li>
 *   <li>значение — ключ проекта: короткий код (1.18, {@code short_code}) или прежнее «владелец/репо» из
 *       {@code aliases}; переводится в ключ этой базы ({@code slug}). Незнакомое — как есть.</li>
 * </ul>
 */
final class SliceProjectParam {

    static final String PARAM = "project";
    static final String LEGACY = SliceProjectNarrowing.PARAM;

    static final String LEGACY_WARNING = "scope_projects — прежнее имя параметра проекта; используйте project "
        + "(одно имя у всех проектных срезов и у find, GC-05). Прежнее имя пока принимается.";

    private SliceProjectParam() {}

    /** Срез сам фильтрует по {@code project} своим SQL (обязательный или необязательный параметр). */
    static boolean nativeParam(String sliceId) {
        LoreSlices.SliceDef def = LoreSlices.get(sliceId);
        return def != null && (def.required().contains(PARAM) || def.optionalFilters().containsKey(PARAM));
    }

    /** Проектный срез: фильтрует по проекту сам или режется проектным скоупом. */
    static boolean projectSlice(String sliceId) {
        return nativeParam(sliceId) || LoreSlices.PROJECT_SCOPED.containsKey(sliceId);
    }

    static Set<String> projectSlices() {
        Set<String> out = new TreeSet<>();
        for (String id : LoreSlices.ids()) if (projectSlice(id)) out.add(id);
        return out;
    }

    /** Необязательные параметры среза для реестра {@code GET /lore/slices}: у проектного среза всегда есть project. */
    static List<String> catalogOptional(String sliceId) {
        LoreSlices.SliceDef def = LoreSlices.get(sliceId);
        List<String> out = new ArrayList<>(def.optionalFilters().keySet());
        if (projectSlice(sliceId) && !def.required().contains(PARAM) && !out.contains(PARAM)) out.add(PARAM);
        return out;
    }

    /**
     * Ключи проекта → ключ базы: короткий код (без регистра), синонимы из {@code aliases}, сам slug.
     * Строки — из {@code SELECT slug, short_code, aliases FROM KnowGitProject}.
     */
    static Map<String, String> keys(Collection<Map<String, Object>> rows) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            Object slug = r.get("slug");
            if (slug == null || String.valueOf(slug).isBlank()) continue;
            String s = String.valueOf(slug);
            out.put(norm(s), s);
            Object code = r.get("short_code");
            if (code != null && !String.valueOf(code).isBlank()) out.putIfAbsent(norm(String.valueOf(code)), s);
            if (r.get("aliases") instanceof Collection<?> list)
                for (Object a : list) if (a != null && !String.valueOf(a).isBlank()) out.putIfAbsent(norm(String.valueOf(a)), s);
        }
        return out;
    }

    private static String norm(String k) {
        return k.strip().toLowerCase(Locale.ROOT);
    }

    /** Один ключ проекта → ключ базы; незнакомое — как есть. */
    static String canonical(String key, Map<String, String> keys) {
        if (key == null) return null;
        String k = key.strip();
        return keys == null ? k : keys.getOrDefault(norm(k), k);
    }

    /** Список «a,b» → ключи базы, без повторов. */
    static List<String> canonicalList(String raw, Map<String, String> keys) {
        Set<String> out = new LinkedHashSet<>();
        if (raw != null) for (String p : raw.split(",")) {
            String t = p.strip();
            if (!t.isEmpty()) out.add(canonical(t, keys));
        }
        return new ArrayList<>(out);
    }

    /**
     * Приводит параметры проекта среза к одному правилу (меняет {@code given}). Возвращает текст {@code _warning}
     * для ответа или {@code null}. Непроектный срез не трогается — {@code project} у него честно 400.
     */
    static String normalize(String sliceId, Map<String, String> given, Map<String, String> keys) {
        if (given == null) return null;
        String warning = null;
        if (given.containsKey(LEGACY)) {
            warning = LEGACY_WARNING;
            List<String> legacy = canonicalList(given.get(LEGACY), keys);
            if (!legacy.isEmpty()) given.put(LEGACY, String.join(",", legacy));
        }
        if (!projectSlice(sliceId) || !given.containsKey(PARAM)) return warning;
        List<String> projects = canonicalList(given.get(PARAM), keys);
        if (projects.isEmpty()) return warning;
        if (nativeParam(sliceId)) {
            given.put(PARAM, String.join(",", projects));
            return warning;
        }
        // Срез без своего фильтра: project → сужение скоупом; с прежним именем вместе — пересечение.
        given.remove(PARAM);
        String legacy = given.get(LEGACY);
        if (legacy != null) projects.retainAll(new LinkedHashSet<>(canonicalList(legacy, keys)));
        given.put(LEGACY, projects.isEmpty() ? SliceProjectNarrowing.NO_PROJECT : String.join(",", projects));
        return warning;
    }
}
