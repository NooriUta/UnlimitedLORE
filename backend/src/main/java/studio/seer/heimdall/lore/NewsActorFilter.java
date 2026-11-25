package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE, решение владельца 25.11.2026 (развилка 2а): параметр ленты {@code actor} —
 * агент по actor_id. Автор-агент в истории записан учёткой (client_id), а учётка — поле уровня admin
 * ({@link LoreFieldAudience}): карточка агента её не знает. Сервер переводит actor_id в значения оси who сам и
 * не отдаёт учётку наружу ничем, кроме того, что лента и так показывает в строке автора.
 */
final class NewsActorFilter {

    private NewsActorFilter() {}

    /** Агенты по любому из ключей: карточка открывается и по actor_id, и по учётке (из ленты). */
    static final String SQL = "SELECT actor_id, client_id FROM KnowActor WHERE kind = 'agent' AND (actor_id IN :ids OR client_id IN :ids)";

    /** Значения оси who и ключи, по которым агент не нашёлся (их называет meta, а не тихая пустота). */
    record Resolved(List<String> whos, List<String> unknown) {}

    static Resolved resolve(List<String> actors, List<Map<String, Object>> rows) {
        Set<String> whos = new LinkedHashSet<>();
        List<String> unknown = new ArrayList<>();
        for (String a : actors) {
            boolean found = false;
            for (Map<String, Object> r : rows) {
                String id = str(r.get("actor_id")), client = str(r.get("client_id"));
                if (!a.equals(id) && !a.equals(client)) continue;
                found = true;
                if (client != null) whos.add(client);
                if (id != null) whos.add(id);
            }
            if (!found) { unknown.add(a); whos.add(a); }
        }
        return new Resolved(List.copyOf(whos), List.copyOf(unknown));
    }

    /** who из запроса + значения агента, без повторов; пусто — null (фильтра нет). */
    static String mergeWho(String who, List<String> add) {
        Set<String> out = new LinkedHashSet<>();
        if (who != null) for (String w : who.split(",")) if (!w.isBlank()) out.add(w.trim());
        out.addAll(add);
        return out.isEmpty() ? null : String.join(",", out);
    }

    private static String str(Object o) {
        return o == null || o.toString().isBlank() ? null : o.toString().trim();
    }
}
