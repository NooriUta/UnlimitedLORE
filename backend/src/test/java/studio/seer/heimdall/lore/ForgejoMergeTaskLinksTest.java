package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · мерж через мост ставит связь задача → PR и сохраняет данные PR.
 *
 * <p>Решения владелицы (заметка задачи): «данные PR при мерже — да»; связь PR → задача — «ставить
 * автоматом, возвращать в ответе» (16.11: код вида СПРИНТ/КОД, задача существует; одинокий код не
 * связывается — он принадлежит многим спринтам).
 */
class ForgejoMergeTaskLinksTest {

    @Test
    void sprintSlashCodeFromTitle() {
        assertEquals(List.of("SPRINT_LORE_MODEL_DOCS_TIDY/MD-05"),
            ForgejoBridge.taskUidsInTitle("feat(forgejo): мерж ставит связь PR → задача (SPRINT_LORE_MODEL_DOCS_TIDY/MD-05)"));
        assertEquals(List.of("SPRINT_UXR_S13_KIT4/K4-CHARTS", "SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG"),
            ForgejoBridge.taskUidsInTitle("analytics: SPRINT_UXR_S13_KIT4/K4-CHARTS, SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG; ещё"));
        // строчная часть в id спринта и цифровой код
        assertEquals(List.of("SPRINT_HOUSEKEEPING_JUL26_v2/H-1"),
            ForgejoBridge.taskUidsInTitle("chore: SPRINT_HOUSEKEEPING_JUL26_v2/H-1"));
    }

    @Test
    void duplicatesOnceInOrder() {
        assertEquals(List.of("SPRINT_A_B/X-1", "SPRINT_A_B/X-2"),
            ForgejoBridge.taskUidsInTitle("SPRINT_A_B/X-1 и SPRINT_A_B/X-2, снова SPRINT_A_B/X-1"));
    }

    @Test
    void bareCodesAndNonTaskSlashesAreIgnored() {
        // одинокий код принадлежит многим спринтам — не связываем
        assertTrue(ForgejoBridge.taskUidsInTitle("fix: CO-11 и MD-05").isEmpty());
        // ветки и прочие дроби — не коды задач
        assertTrue(ForgejoBridge.taskUidsInTitle("Merge develop → preprod, CI/CD, feat/charts-batch-1").isEmpty());
        assertTrue(ForgejoBridge.taskUidsInTitle(null).isEmpty());
    }

    @Test
    void matchedAndUnmatchedSplit() {
        Set<String> known = Set.of("SPRINT_A_B/X-1");
        ForgejoBridge.TaskMatch m = ForgejoBridge.matchTasks(
            List.of("SPRINT_A_B/X-1", "SPRINT_A_B/NOPE-9"), known::contains);
        assertEquals(List.of("SPRINT_A_B/X-1"), m.matched());
        assertEquals(List.of("SPRINT_A_B/NOPE-9"), m.unmatched());
    }

    @Test
    void prRecordAfterMergeCarriesState() {
        JsonObject pr = new JsonObject()
            .put("title", "feat: x (SPRINT_A_B/X-1)")
            .put("html_url", "https://git.example/AIDA/UnlimitedLORE/pulls/7")
            .put("merged_at", "2026-11-20T10:00:00Z")
            .put("state", "closed")
            .put("merged", true)
            .put("head", new JsonObject().put("ref", "feat/x"))
            .put("base", new JsonObject().put("ref", "develop"));
        Map<String, Object> f = ForgejoBridge.prFields(pr);
        assertEquals("feat: x (SPRINT_A_B/X-1)", f.get("title"));
        assertEquals("https://git.example/AIDA/UnlimitedLORE/pulls/7", f.get("url"));
        assertEquals("2026-11-20T10:00:00Z", f.get("merged_at"));
        // «закрыт» у Forgejo — и влитый, и отклонённый; влитый PR — state=merged
        assertEquals("merged", f.get("state"));
    }

    @Test
    void closedUnmergedAndOpenStates() {
        assertEquals("closed", ForgejoBridge.prFields(new JsonObject().put("state", "closed").put("merged", false)).get("state"));
        assertEquals("open", ForgejoBridge.prFields(new JsonObject().put("state", "open")).get("state"));
        assertFalse(ForgejoBridge.prFields(new JsonObject()).containsKey("state"), "нет данных — нет поля, не пустая строка");
    }
}
