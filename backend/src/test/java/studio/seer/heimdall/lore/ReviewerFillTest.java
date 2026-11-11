package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-REVIEWER-AUTHOR — ревьюер при смене статуса.
 * Под учёткой агента — человек, от имени которого пишет агент (владелец, OWNED_BY);
 * под учёткой человека — сам человек. Только когда ревьюера на задаче ещё нет.
 */
class ReviewerFillTest {

    private static final ChangeAuthor AGENT = new ChangeAuthor("lore-mcp-full_kimi", ChangeAuthor.KIND_AGENT);
    private static final ChangeAuthor HUMAN = new ChangeAuthor("e8c633a1-sub", ChangeAuthor.KIND_HUMAN);

    @Test
    void agentToken_noReviewer_fillsOwnerOfAgent() {
        ReviewerFill.Decision d = ReviewerFill.decide(AGENT, List.of(), List.of("arharaga"));
        assertEquals(ReviewerFill.Action.FILL, d.action());
        assertEquals("arharaga", d.identity());
    }

    @Test
    void humanToken_noReviewer_fillsHimself() {
        ReviewerFill.Decision d = ReviewerFill.decide(HUMAN, List.of(), List.of("omiloreadmin"));
        assertEquals(ReviewerFill.Action.FILL, d.action());
        assertEquals("omiloreadmin", d.identity());
    }

    @Test
    void reviewerAlreadySet_isKept_notOverwritten() {
        ReviewerFill.Decision d = ReviewerFill.decide(AGENT, List.of("vasilisk"), List.of("arharaga"));
        assertEquals(ReviewerFill.Action.KEEP, d.action());
        assertEquals("vasilisk", d.identity());
    }

    @Test
    void unknownAuthor_skipsWithReason() {
        ReviewerFill.Decision d = ReviewerFill.decide(ChangeAuthor.UNKNOWN, List.of(), List.of());
        assertEquals(ReviewerFill.Action.SKIP, d.action());
        assertNotNull(d.reason());
    }

    @Test
    void agentWithoutOwner_orAmbiguousOwner_skipsWithReason() {
        assertEquals(ReviewerFill.Action.SKIP, ReviewerFill.decide(AGENT, List.of(), List.of()).action());
        ReviewerFill.Decision two = ReviewerFill.decide(AGENT, List.of(), List.of("arharaga", "vasilisk"));
        assertEquals(ReviewerFill.Action.SKIP, two.action());
        assertTrue(two.reason().contains("arharaga") && two.reason().contains("vasilisk"), two.reason());
    }

    @Test
    void resolveQuery_agentByClientIdOwner_humanByKcSub() {
        ReviewerFill.Query qa = ReviewerFill.resolveQuery(AGENT);
        assertTrue(qa.sql().contains("out('OWNED_BY').display_name"), qa.sql());
        assertTrue(qa.sql().contains("client_id = :c"), qa.sql());
        assertEquals(Map.of("c", "lore-mcp-full_kimi"), qa.params());

        ReviewerFill.Query qh = ReviewerFill.resolveQuery(HUMAN);
        assertTrue(qh.sql().contains("FROM KnowUser WHERE kc_sub = :s"), qh.sql());
        assertEquals(Map.of("s", "e8c633a1-sub"), qh.params());

        assertNull(ReviewerFill.resolveQuery(ChangeAuthor.UNKNOWN));
    }

    @Test
    void answer_namesOutcomeIdentityAndReason() {
        Map<String, Object> a = ReviewerFill.answer(ReviewerFill.decide(AGENT, List.of(), List.of()), null);
        assertEquals("skipped", a.get("outcome"));
        assertNotNull(a.get("reason"));
        Map<String, Object> f = ReviewerFill.answer(ReviewerFill.decide(AGENT, List.of(), List.of("arharaga")),
            Map.of("outcome", "created"));
        assertEquals("filled", f.get("outcome"));
        assertEquals("arharaga", f.get("identity"));
        assertEquals("agent_owner", f.get("source"));
    }

    /** Подстановка живёт на пути смены статуса задачи — единственном (S2-13). */
    @Test
    void statusPath_callsReviewerFill_andReportsMachine() throws IOException {
        String src = Files.readString(Path.of("src/main/java/studio/seer/heimdall/lore/LoreStatusResource.java"),
            StandardCharsets.UTF_8);
        assertTrue(src.contains("fillReviewer(req.id(), author)"), "updateStatus должен звать fillReviewer");
        assertTrue(src.contains("AgentMachine.answerFields("), "ответ status_set несёт машину агента");
    }
}
