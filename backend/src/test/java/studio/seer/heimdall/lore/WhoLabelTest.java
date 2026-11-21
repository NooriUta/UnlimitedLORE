package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-HUMAN-NAME — один помощник подписи «кто» для человека и агента.
 * Владелица 21.11.2026: «в агентах явно учётка — может очеловечим агентов?» → «Claude Code · full» вместо учётки,
 * «и машину если есть, если нет пока так». Учётка (client_id) — подсказкой, текстом вне админки не видна.
 */
class WhoLabelTest {

    @Test
    void профильИзУчётки() {
        assertEquals("full", WhoLabel.profileOf("lore-mcp-full"));
        assertEquals("full", WhoLabel.profileOf("lore-mcp-full_kimi"));
        assertEquals("reader", WhoLabel.profileOf("lore-mcp-reader_codex_legion"));
        assertNull(WhoLabel.profileOf("lore-backend-minilore-reader"), "не учётка MCP — профиля нет, а не выдуманный");
        assertNull(WhoLabel.profileOf(null));
    }

    @Test
    void агент_имяПрофильМашина() {
        assertEquals("Claude Code · full · LEGION", WhoLabel.agent("Claude Code", "claude-code", "lore-mcp-full", "LEGION"));
        assertEquals("Claude Code · full", WhoLabel.agent("Claude Code", "claude-code", "lore-mcp-full", null),
            "машины нет — без третьей части");
        assertEquals("Claude Code · full", WhoLabel.agent("Claude Code", null, "lore-mcp-full", AgentMachine.UNKNOWN),
            "«(unknown)» — не машина");
        assertEquals("Claude Code · full", WhoLabel.agent("Claude Code", null, "lore-mcp-full", AgentMachine.NOT_APPLICABLE));
        assertEquals("claude-code · full", WhoLabel.agent(null, "claude-code", "lore-mcp-full", null), "имени нет — harness");
        assertEquals("lore-x", WhoLabel.agent(null, null, "lore-x", null), "ничего не знаем — учётка, а не пусто");
    }

    @Test
    void человек_имяЛогинКод() {
        assertEquals("Ирина Петрова", WhoLabel.human("Ирина Петрова", "irina", "s1"));
        assertEquals("irina", WhoLabel.human(" ", "irina", "s1"));
        assertEquals("s1", WhoLabel.human(null, null, "s1"));
    }

    /** История: автор-агент получает подпись и подсказку-учётку; client_id в данных остаётся (фильтры, админка). */
    @Test
    void историяПодписываетАгента() {
        Map<String, Object> author = new LinkedHashMap<>();
        author.put("kind", "agent");
        author.put("client_id", "lore-mcp-full");
        author.put("machine", "LEGION");
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("author", author);
        List<Map<String, Object>> out = LoreEntityHistory.withAgentNames(List.of(row),
            Map.of("lore-mcp-full", new WhoLabel.Agent("Claude Code", "claude-code")));
        @SuppressWarnings("unchecked") Map<String, Object> a = (Map<String, Object>) out.get(0).get("author");
        assertEquals("Claude Code · full · LEGION", a.get("display_name"));
        assertEquals("lore-mcp-full", a.get("hint"));
        assertEquals("lore-mcp-full", a.get("client_id"));
        assertEquals(java.util.Set.of("lore-mcp-full"), LoreEntityHistory.agentClients(List.of(row)));
    }

    /** Агента нет в реестре — подпись всё равно человеческая (профиль из учётки), учётка в подсказке. */
    @Test
    void историяБезРеестра() {
        Map<String, Object> author = new LinkedHashMap<>(Map.of("kind", "agent", "client_id", "lore-mcp-full_kimi", "machine", "(unknown)"));
        List<Map<String, Object>> out = LoreEntityHistory.withAgentNames(List.of(Map.of("author", author)), Map.of());
        @SuppressWarnings("unchecked") Map<String, Object> a = (Map<String, Object>) out.get(0).get("author");
        assertEquals("full", a.get("display_name"));
        assertEquals("lore-mcp-full_kimi", a.get("hint"));
    }

    /** Лента: подписи агентов в who_names по учётке; людей — как прежде. */
    @Test
    void лентаПодписываетАгентов() {
        Map<String, String> names = WhoLabel.agentNames(java.util.Set.of("lore-mcp-full", "s1"),
            List.of(Map.of("client_id", "lore-mcp-full", "name", "Claude Code", "harness", "claude-code")));
        assertEquals(Map.of("lore-mcp-full", "Claude Code · full"), names, "кто не агент — не трогаем");
    }
}
