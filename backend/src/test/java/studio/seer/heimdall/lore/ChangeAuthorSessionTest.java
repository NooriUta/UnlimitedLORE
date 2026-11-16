package studio.seer.heimdall.lore;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG: каждая новая версия истории от агента несёт код
 * сессии Claude Code (X-Lore-Session-Id) — служебное поле changed_by_session рядом с changed_by.
 * Правка из веба (человек) — поле пустое: отрицательный контроль владелицы.
 */
class ChangeAuthorSessionTest {

    @Test
    void setSqlCarriesSessionNextToAuthor() {
        assertTrue(ChangeAuthor.SET_SQL.contains("changed_by_session = :changed_by_session"), ChangeAuthor.SET_SQL);
    }

    @Test
    void agentKeepsSessionHumanAndUnknownDoNot() {
        ChangeAuthor agent = new ChangeAuthor("lore-mcp-full", ChangeAuthor.KIND_AGENT)
            .withSession("b2c27515-7345-4386-b9e0-9c824bc96050");
        assertEquals("b2c27515-7345-4386-b9e0-9c824bc96050", agent.session());
        assertNull(new ChangeAuthor("sub-1", ChangeAuthor.KIND_HUMAN).withSession("x-session").session());
        assertNull(ChangeAuthor.UNKNOWN.withSession("x-session").session());
    }

    @Test
    void sessionIsCanonOrNull() {
        ChangeAuthor a = new ChangeAuthor("c", ChangeAuthor.KIND_AGENT);
        assertNull(a.withSession(null).session());
        assertNull(a.withSession("   ").session());
        assertNull(a.withSession("bad value; DROP").session(), "мусор не пишется — не угадываем");
        assertEquals(64, a.withSession("a".repeat(64)).session().length());
        assertNull(a.withSession("a".repeat(65)).session());
    }

    @Test
    void bindPutsSessionEvenWhenNull() {
        Map<String, Object> p = new ChangeAuthor("sub", ChangeAuthor.KIND_HUMAN).bind(new HashMap<>());
        assertTrue(p.containsKey("changed_by_session"));
        assertNull(p.get("changed_by_session"));
        Map<String, Object> q = new ChangeAuthor("c", ChangeAuthor.KIND_AGENT).withSession("s-1").bind(new HashMap<>());
        assertEquals("s-1", q.get("changed_by_session"));
    }
}
