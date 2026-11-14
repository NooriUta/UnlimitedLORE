package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/MINI-04-LIST-ROWS-CATEGORY-PROJECTS — ось проекта в строках срезов
 * под одним именем {@link #FIELD}.
 *
 * <p><b>Зачем.</b> Мобильный клиент miniLORE фильтрует и подписывает строки списков по проекту, а
 * ось называлась по-разному: {@code specs}/{@code decisions} отдают {@code projects}, {@code adrs}/
 * {@code sprints}/{@code products} — {@code git_projects}. Клиенту приходилось знать имя на каждый срез.
 *
 * <p><b>Как.</b> Общий пост-процесс выдачи среза (рядом с {@link LoreStatusCategory#enrich}), а не
 * правка каждого SQL: строка с {@link #LEGACY} получает {@link #FIELD} с тем же значением, сам
 * {@link #LEGACY} остаётся — на нём завязан веб. Строкам срезов из {@link #GUARANTEED} ключ
 * достаётся всегда, массивом: ArcadeDB опускает null-свойства, и «проекта нет» иначе не отличить от
 * «сервер не умеет». Своё поле {@code projects} строки не перезаписывается.
 */
final class LoreProjectsField {

    private LoreProjectsField() {}

    static final String FIELD = "projects";
    static final String LEGACY = "git_projects";

    /**
     * Срезы-списки (и паспорта) проектных записей: {@link #FIELD} есть в каждой строке, массивом.
     * Сторож MC-03 ({@code ModelServerConsistencyGuardTest#projectListSlicesCarryTheProjectAxis})
     * проверяет, что каждый из них читает ось проекта в SQL и что срез со статусом и осью проекта
     * здесь не забыт.
     */
    static final Set<String> GUARANTEED = Set.of(
        "adrs", "adr", "specs", "spec_by_id", "decisions", "decisions_of_adr",
        "sprints", "sprint_tree", "docs", "runbooks", "releases", "products", "product_by_id");

    private static final Pattern AXIS = Pattern.compile("(?i)\\bAS\\s+(git_)?projects\\b");

    /** SQL среза выводит ось проекта ({@code AS projects} или {@code AS git_projects}). */
    static boolean readsProjectAxis(String sql) {
        return sql != null && AXIS.matcher(sql).find();
    }

    /** Добавляет {@link #FIELD}; срез без оси проекта возвращается тем же списком. */
    static List<Map<String, Object>> enrich(String sliceId, List<Map<String, Object>> rows) {
        if (rows == null || rows.isEmpty()) return rows;
        boolean guaranteed = GUARANTEED.contains(sliceId);
        if (!guaranteed && rows.stream().noneMatch(r -> r != null && r.containsKey(LEGACY))) return rows;
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            if (row == null) { out.add(null); continue; }
            Object own = row.get(FIELD);
            Object value = own != null ? own : row.get(LEGACY);
            if (value == null && !guaranteed && !row.containsKey(LEGACY)) { out.add(row); continue; }
            Map<String, Object> m = new LinkedHashMap<>(row);
            m.put(FIELD, asList(value));
            out.add(m);
        }
        return out;
    }

    private static List<Object> asList(Object v) {
        if (v == null) return List.of();
        if (v instanceof Collection<?> c) return new ArrayList<>(c);
        return List.of(v);
    }
}
