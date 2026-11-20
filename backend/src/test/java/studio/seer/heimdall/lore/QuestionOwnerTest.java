package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH A6 · ответственный вопроса — ребро ANSWERABLE_BY, а не текст.
 *
 * <p>Решение владелицы 19.11.2026 (ответ «1а»): «Ответственный» у вопроса — ребро к пользователю. Пять
 * написаний владелицы сводятся к пользователю omiloreadmin; иное значение — id человека или агента реестра,
 * а незнакомое — отказ 422 с причиной, не запись текста. Когда вопрос закрывают решением, ответственным
 * становится автор решения; автор неизвестен — ребро не трогается, причина в ответе.
 *
 * <p>Здесь — правила без базы; SQL записи и чтения — {@link QuestionOwnerEmbeddedTest}.
 */
class QuestionOwnerTest {

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    static final List<Map<String, Object>> USERS = List.of(
        row("kc_sub", "52f6-uuid", "display_name", "omiloreadmin"),
        row("kc_sub", "77aa-uuid", "display_name", "ivanovalex32"));
    static final List<Map<String, Object>> AGENTS = List.of(
        row("actor_id", "AGENT-FULL-msbt0fed", "client_id", "claude-full", "name", "Claude Code (full)"),
        row("actor_id", "AGENT-LORE-ARCH", "client_id", "lore-arch", "name", "Архитектор"));

    @Test
    void fiveSpellingsOfTheOwnerBecomeOneUser() {
        for (String s : new String[] {"owner", "владелец", "владелица", "alexa", "omiloreadmin", " Владелица ", "OWNER"}) {
            QuestionOwner.Resolved r = QuestionOwner.resolve(s, USERS, AGENTS);
            assertNull(r.refusal(), s);
            assertEquals(new QuestionOwner.Target("user", "52f6-uuid", "omiloreadmin"), r.target(), s);
        }
    }

    @Test
    void registryIdsResolveToTheirRecord() {
        assertEquals(new QuestionOwner.Target("agent", "AGENT-FULL-msbt0fed", "AGENT-FULL-msbt0fed"),
            QuestionOwner.resolve("AGENT-FULL-msbt0fed", USERS, AGENTS).target());
        assertEquals(new QuestionOwner.Target("user", "77aa-uuid", "ivanovalex32"),
            QuestionOwner.resolve("ivanovalex32", USERS, AGENTS).target(), "логин человека");
        assertEquals(new QuestionOwner.Target("user", "77aa-uuid", "ivanovalex32"),
            QuestionOwner.resolve("77aa-uuid", USERS, AGENTS).target(), "kc_sub человека");
    }

    @Test
    void unknownOwnerIsRefusedWithAReasonNotWrittenAsText() {
        QuestionOwner.Resolved r = QuestionOwner.resolve("серверная половина шлюза", USERS, AGENTS);
        assertNull(r.target());
        assertNotNull(r.refusal());
        assertTrue(r.refusal().contains("серверная половина шлюза"), r.refusal());
        assertTrue(r.refusal().contains("реестр"), "причина говорит, где искать: " + r.refusal());
        assertNotNull(QuestionOwner.resolve("   ", USERS, AGENTS).refusal(), "пустое значение не снимает ответственного молча");
    }

    @Test
    void ownerAliasWithoutTheUserInRegistryIsRefused() {
        QuestionOwner.Resolved r = QuestionOwner.resolve("владелица", List.of(USERS.get(1)), AGENTS);
        assertNull(r.target());
        assertTrue(r.refusal().contains("omiloreadmin"), r.refusal());
    }

    @Test
    void decisionAuthorHumanIsTheUserByKcSub() {
        QuestionOwner.Resolved r = QuestionOwner.authorOf(row("changed_by", "77aa-uuid", "changed_by_kind", "human"), USERS, AGENTS);
        assertEquals(new QuestionOwner.Target("user", "77aa-uuid", "ivanovalex32"), r.target());
    }

    @Test
    void decisionAuthorAgentIsTheActorByClientId() {
        QuestionOwner.Resolved r = QuestionOwner.authorOf(row("changed_by", "lore-arch", "changed_by_kind", "agent"), USERS, AGENTS);
        assertEquals(new QuestionOwner.Target("agent", "AGENT-LORE-ARCH", "AGENT-LORE-ARCH"), r.target());
    }

    @Test
    void unknownDecisionAuthorGivesAReason() {
        assertTrue(QuestionOwner.authorOf(null, USERS, AGENTS).refusal().contains("истори"),
            "у решения нет версии — автор неизвестен");
        assertTrue(QuestionOwner.authorOf(row("changed_by", null, "changed_by_kind", "unknown"), USERS, AGENTS).refusal()
            .contains("неизвест"));
        assertTrue(QuestionOwner.authorOf(row("changed_by", "nobody", "changed_by_kind", "human"), USERS, AGENTS).refusal()
            .contains("nobody"));
    }
}
