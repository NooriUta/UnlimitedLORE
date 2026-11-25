package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE, решение владельца 25.11.2026 (развилка 2а): лента агента — фильтр по
 * actor_id на СЕРВЕРЕ. Автор-агент в истории записан учёткой (client_id), а учётка — поле уровня admin: клиент её
 * не знает и подставить в ось who не может. Сервер переводит actor_id в значения оси who сам.
 */
class NewsActorFilterTest {

    private static Map<String, Object> actor(String id, String client) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("actor_id", id);
        m.put("client_id", client);
        return m;
    }

    @Test
    void actorBecomesItsAccountOnTheWhoAxis() {
        NewsActorFilter.Resolved r = NewsActorFilter.resolve(List.of("AGENT-FULL-x"),
            List.of(actor("AGENT-FULL-x", "lore-mcp-full")));
        assertEquals(List.of("lore-mcp-full", "AGENT-FULL-x"), r.whos(), "учётка — ключ автора в истории; actor_id — на случай записи по нему");
        assertEquals(List.of(), r.unknown());
    }

    @Test
    void actorWithoutAccountAndUnknownActorAreHonest() {
        NewsActorFilter.Resolved r = NewsActorFilter.resolve(List.of("AGENT-PRODUCT-ANALYST", "ghost"),
            List.of(actor("AGENT-PRODUCT-ANALYST", null)));
        assertEquals(List.of("AGENT-PRODUCT-ANALYST", "ghost"), r.whos(), "неизвестный остаётся фильтром — выдача пустая, а не вся лента");
        assertEquals(List.of("ghost"), r.unknown(), "неизвестный назван в meta, а не тихо пуст");
    }

    @Test
    void cardOpenedByAccountResolvesToo() {
        // Из ленты карточка открывается по учётке (?open=lore-mcp-full) — срез agent_by_id находит и по ней.
        NewsActorFilter.Resolved r = NewsActorFilter.resolve(List.of("lore-mcp-full"), List.of(actor("AGENT-FULL-x", "lore-mcp-full")));
        assertEquals(List.of("lore-mcp-full", "AGENT-FULL-x"), r.whos());
        assertEquals(List.of(), r.unknown());
    }

    @Test
    void mergesWithWhoWithoutRepeats() {
        assertEquals("sub-ann,lore-mcp-full", NewsActorFilter.mergeWho("sub-ann", List.of("lore-mcp-full")));
        assertEquals("lore-mcp-full", NewsActorFilter.mergeWho(null, List.of("lore-mcp-full")));
        assertEquals("a,b", NewsActorFilter.mergeWho("a,b", List.of("a")));
        assertNull(NewsActorFilter.mergeWho(null, List.of()));
    }

    @Test
    void lookupSqlFindsAgentsByEitherKey() {
        assertTrue(NewsActorFilter.SQL.contains("kind = 'agent'"), NewsActorFilter.SQL);
        assertTrue(NewsActorFilter.SQL.contains("actor_id IN :ids") && NewsActorFilter.SQL.contains("client_id IN :ids"), NewsActorFilter.SQL);
    }
}
