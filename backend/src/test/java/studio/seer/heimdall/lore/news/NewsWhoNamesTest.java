package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * PU-29 (приёмка 14.11.2026): в ленте новостей автор-человек показывался сырым kc_sub.
 * Ответ ленты несёт {@code who_names} — имя из KnowUser по каждому значению «Кто», что
 * встречается в строках и в счёте фильтра {@code by_who}. Значение фильтра остаётся kc_sub:
 * имя — только подпись.
 */
class NewsWhoNamesTest {

    @Test
    void collectsWhoFromEventsAndByWhoCountsWithoutPlaceholders() {
        Map<String, Object> resp = Map.of(
            "events", List.of(Map.of("who", "sub-1"), Map.of("who", "agent-x"), Map.of("author", "unknown")),
            "metrics", Map.of("counts", Map.of("by_who", Map.of("sub-2", Map.of(), NewsV2Engine.NOWHO, Map.of()))));
        assertEquals(Set.of("sub-1", "agent-x", "sub-2"), NewsWhoNames.whos(resp));
    }

    @Test
    void attachesOnlyKnownNames() {
        Map<String, Object> resp = new java.util.LinkedHashMap<>();
        NewsWhoNames.attach(resp, Map.of("sub-1", "Ольга"));
        assertEquals(Map.of("sub-1", "Ольга"), resp.get("who_names"));
        Map<String, Object> empty = new java.util.LinkedHashMap<>();
        NewsWhoNames.attach(empty, Map.of());
        assertEquals(Map.of(), empty.get("who_names"));
    }
}
