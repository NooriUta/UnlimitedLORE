package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Приёмка препрода 14.11.2026 (PU-29, DONE человеком): в истории «кто» — сырой kc_sub
 * «52f6fad5-…», а не имя. Сервер клал автору-человеку только kc_sub, хотя клиент ждёт display_name.
 * Правило: автор-человек истории несёт имя из KnowUser; имени нет — поле не выдумывается.
 */
class HistoryHumanNameTest {

    static Map<String, Object> row(String kind, String sub) {
        Map<String, Object> a = new java.util.LinkedHashMap<>();
        a.put("kind", kind);
        a.put(kind.equals("human") ? "kc_sub" : "client_id", sub);
        Map<String, Object> r = new java.util.LinkedHashMap<>();
        r.put("author", a);
        return r;
    }

    @Test
    void humanAuthorGetsDisplayName() {
        List<Map<String, Object>> rows = List.of(row("human", "52f6"), row("agent", "lore-mcp-full"), row("human", "nobody"));
        assertEquals(Set.of("52f6", "nobody"), LoreEntityHistory.humanSubs(rows));
        List<Map<String, Object>> out = LoreEntityHistory.withHumanNames(rows, Map.of("52f6", "omiloreadmin"));
        assertEquals("omiloreadmin", ((Map<?, ?>) out.get(0).get("author")).get("display_name"));
        assertFalse(((Map<?, ?>) out.get(1).get("author")).containsKey("display_name"), "агенту имя человека не ставится");
        assertFalse(((Map<?, ?>) out.get(2).get("author")).containsKey("display_name"), "нет в KnowUser — не выдумываем");
        assertFalse(((Map<?, ?>) rows.get(0).get("author")).containsKey("display_name"), "входные карты не меняются");
    }
}
