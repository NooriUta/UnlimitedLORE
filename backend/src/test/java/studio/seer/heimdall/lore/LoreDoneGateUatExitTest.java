package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_LORE_UNIVERSAL_WORKFLOW/UW-L0-SPEC — слово владельца 26.11: «агент ставит uat, но из uat дальше человек».
 * Переход В uat агенту разрешён; любой переход ИЗ uat (назад в active, в blocked, waiting, failed, cancelled,
 * ready_for_deploy) агенту — 409 UAT_EXIT_HUMAN_ONLY. done из uat — отдельный гейт: агенту только словом человека
 * (owner_word), его правила здесь не меняются. Человеку переходы не ограничены.
 */
class LoreDoneGateUatExitTest {

    @Test
    void агентСтавитUat() {
        assertNull(LoreDoneGate.transitionFor(true, "ready_for_deploy", "uat", null, null));
        assertNull(LoreDoneGate.transitionFor(true, "active", "uat", null, null));
    }

    @Test
    void выходИзUat_агенту409() {
        for (String target : new String[]{"active", "blocked", "waiting", "failed", "cancelled", "ready_for_deploy", "review"}) {
            LoreDoneGate.Verdict v = LoreDoneGate.transitionFor(true, "uat", target, "причина есть", "владелец");
            assertEquals(409, v == null ? 0 : v.status(), "uat → " + target);
            assertEquals("UAT_EXIT_HUMAN_ONLY", v.code(), "uat → " + target);
        }
    }

    @Test
    void doneИзUat_неЭтотГейт_аГейтDone() {
        assertNull(LoreDoneGate.transitionFor(true, "uat", "done", null, null),
            "done из uat решает LoreDoneGate.done (owner_word), а не запрет выхода");
    }

    @Test
    void человекуВыходИзUatСвободен() {
        assertNull(LoreDoneGate.transitionFor(false, "uat", "active", null, null));
        assertNull(LoreDoneGate.transitionFor(false, "uat", "cancelled", null, null));
    }

    @Test
    void тотЖеСтатус_неПереход() {
        assertNull(LoreDoneGate.transitionFor(true, "uat", "uat", null, null), "повтор uat → uat не выход");
    }
}
