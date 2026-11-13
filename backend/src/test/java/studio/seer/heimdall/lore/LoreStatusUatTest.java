package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Статус задачи «UAT — приёмка» (код {@code uat}, маркер 🧪), правило владелицы 13.11.2026:
 * после 🚀 READY FOR DEPLOY агент проверяет задачу на стенде как пользователь и переводит
 * её в UAT, где её принимает человек; done ставит только человек. Статус стоит между
 * ready_for_deploy и done, задача в нём ещё открыта (категория in_progress).
 */
class LoreStatusUatTest {

    @Test
    void значокИСловаОпознаютсяКакUat() {
        assertEquals("uat", LoreStatusVocabulary.classify("🧪 UAT TESTING"));
        assertEquals("uat", LoreStatusVocabulary.classify("🧪 приёмка у владелицы"));
        assertEquals("uat", LoreStatusVocabulary.classify("UAT TESTING"));
        assertEquals("uat", LoreStatusVocabulary.classify("Приёмка"));
        assertEquals("uat", LoreStatusVocabulary.classify("ПРИЕМКА"));
        // RFD не съедается новым словом и наоборот.
        assertEquals("ready_for_deploy", LoreStatusVocabulary.classify("🚀 READY FOR DEPLOY"));
    }

    @Test
    void токенПишетсяИЧитаетсяОбратно() {
        assertTrue(LoreResourceBase.PLAN_STATUSES.contains("uat"));
        assertEquals("🧪 UAT TESTING", LoreResourceBase.SCD2_STATUS_RAW.get("uat"));
        assertEquals("uat", LoreStatusResource.rawToToken("🧪 UAT TESTING"));
        assertEquals("uat", LoreStatusResource.rawToToken("UAT TESTING"));
    }

    @Test
    void категория_вРаботе_неЗакрыта() {
        assertEquals("in_progress", LoreStatusCategory.of("task", "uat"));
        assertEquals("in_progress", LoreStatusCategory.of("sprint", "uat"));
    }

    @Test
    void жизненныйЦикл_междуRfdИDone() {
        List<String> lc = LoreRecordPerms.lifecycle("task", null);
        int rfd = lc.indexOf("ready_for_deploy"), uat = lc.indexOf("uat"), done = lc.indexOf("done");
        assertTrue(rfd >= 0 && uat == rfd + 1 && done == uat + 1, "uat должен стоять между RFD и done: " + lc);
    }

    @Test
    void спринтВUat_неЗакрываетсяСам_аЗадачаВUat_двигаетСпринт() {
        // UAT — сознательная остановка, как RFD: «все done» не переводит спринт в done сам.
        assertNull(LoreStatusResource.deriveSprintTarget("uat", List.of("done", "done")));
        // Задача в приёмке — работа идёт: запланированный спринт становится активным.
        assertEquals("active", LoreStatusResource.deriveSprintTarget("planned", List.of("uat", "todo")));
    }
}
