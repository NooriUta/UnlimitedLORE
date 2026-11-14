package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/MINI-01-AZP-ALLOWLIST — явный список клиентов токена (claim azp).
 * Пусто — проверка выключена (поведение как до задачи); список задан — чужой клиент получает 403
 * с причиной. Включение на проде — решение владелицы.
 */
class ClientAllowlistFilterTest {

    static List<String> list(String raw) { return ClientAllowlistFilter.parse(Optional.ofNullable(raw)); }

    @Test
    void пустойСписок_пропускаетЛюбойAzp() {
        for (String raw : new String[] {null, "", "  ", " , "}) {
            List<String> allowed = list(raw);
            assertTrue(allowed.isEmpty(), "«" + raw + "» — проверка выключена");
            assertNull(ClientAllowlistFilter.refusal(allowed, "кто-угодно"));
            assertNull(ClientAllowlistFilter.refusal(allowed, null));
        }
    }

    @Test
    void списокЗадан_свойПропущен_чужой403СПричиной() {
        List<String> allowed = list("lore-app, mobilepoc-app ,lore-mcp-full*,minilore-srv");
        assertEquals(List.of("lore-app", "mobilepoc-app", "lore-mcp-full*", "minilore-srv"), allowed);
        assertNull(ClientAllowlistFilter.refusal(allowed, "mobilepoc-app"));
        assertNull(ClientAllowlistFilter.refusal(allowed, "minilore-srv"));
        String why = ClientAllowlistFilter.refusal(allowed, "evil-client");
        assertNotNull(why);
        assertTrue(why.contains("evil-client"), "причина называет клиента: " + why);
        assertTrue(why.contains("lore.auth.allowed-clients"), "причина называет настройку: " + why);
    }

    @Test
    void префиксСоЗвёздочкой() {
        List<String> allowed = list("lore-mcp-full*");
        assertNull(ClientAllowlistFilter.refusal(allowed, "lore-mcp-full"));
        assertNull(ClientAllowlistFilter.refusal(allowed, "lore-mcp-full_kimi"));
        assertNotNull(ClientAllowlistFilter.refusal(allowed, "lore-mcp"));
        assertNotNull(ClientAllowlistFilter.refusal(allowed, "x-lore-mcp-full"));
    }

    @Test
    void точноеИмяБезЗвёздочки_неПрефикс() {
        List<String> allowed = list("lore-app");
        assertNotNull(ClientAllowlistFilter.refusal(allowed, "lore-app-2"));
    }

    @Test
    void токенБезAzp_приЗаданномСписке_отказ() {
        String why = ClientAllowlistFilter.refusal(list("lore-app"), null);
        assertNotNull(why, "клиента не назвать — значит, и не проверить: отказ, а не молчаливый пропуск");
        assertNotNull(ClientAllowlistFilter.refusal(list("lore-app"), " "));
    }
}
