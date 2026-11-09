package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Kit 2 (K2-MATRIX), владелица 09.11 через S7A-12: ячейка матрицы «проект × люди» несёт
 * СОСТОЯНИЕ — «проверено / не смогли / нет прав», а не роль|null. Пустая ячейка по
 * Keycloak/Forgejo чаще значит «не смогли спросить», чем «нет роли», и путать их нельзя.
 *
 * <p>Сейчас источник один — граф LORE (рёбра HAS_PROJECT_ROLE), и он прочитан целиком,
 * поэтому все его ячейки и сама строка — {@code checked}. Источники Keycloak и Forgejo
 * добавляются своими ячейками со своим {@code source} и своим состоянием.
 * Старые поля {@code projects}/{@code roles} не убираются — обратная совместимость.
 */
final class LoreRoleMatrix {

    private LoreRoleMatrix() {}

    /** Закрытый набор состояний ячейки. */
    static final List<String> STATES = List.of("checked", "unavailable", "forbidden");

    @SuppressWarnings("unchecked")
    static void fold(Map<String, Object> body) {
        if (!(body.get("rows") instanceof List<?> rows)) return;
        for (Object o : rows) {
            if (!(o instanceof Map<?, ?> raw)) continue;
            Map<String, Object> row = (Map<String, Object>) raw;
            List<?> projects = row.get("projects") instanceof List<?> l ? l : List.of();
            List<?> roles = row.get("roles") instanceof List<?> l ? l : List.of();
            List<Map<String, Object>> cells = new ArrayList<>();
            for (int i = 0; i < projects.size(); i++) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("project", String.valueOf(projects.get(i)));
                c.put("role", i < roles.size() && roles.get(i) != null ? String.valueOf(roles.get(i)) : null);
                c.put("state", "checked");
                c.put("source", "graph");
                cells.add(c);
            }
            row.put("cells", cells);
            row.put("state", "checked");
        }
    }
}
