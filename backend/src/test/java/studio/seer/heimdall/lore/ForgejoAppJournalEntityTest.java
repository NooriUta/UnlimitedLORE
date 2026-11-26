package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-09: каждый вызов миниаппа Forgejo — точка журнала agent_actions с kind и исходом.
 * До правки ресурс отдавал конверт строкой, entityIdOf строку не разбирал, и в object_id писался путь
 * {@code lore/forgejo-app/<route>}; found и empty оба 200 — в журнале неразличимы.
 */
class ForgejoAppJournalEntityTest {

    private static String env(String kind, String outcome) {
        return new JsonObject().put("v", 1).put("kind", kind).put("outcome", outcome).putNull("data")
            .put("meta", new JsonObject().put("took_ms", 3)).encode();
    }

    @Test
    void найденоПустоОтказ_различаются() {
        String found = LoreRequestStatsFilter.forgejoAppEntityOf(env("forgejo:list_prs", "found"));
        String empty = LoreRequestStatsFilter.forgejoAppEntityOf(env("forgejo:list_prs", "empty"));
        String failed = LoreRequestStatsFilter.forgejoAppEntityOf(env("forgejo:list_prs", "failed"));
        assertEquals("forgejo:list_prs#found", found);
        assertEquals("forgejo:list_prs#empty", empty);
        assertEquals("forgejo:list_prs#failed", failed);
        assertNotEquals(found, empty);
    }

    @Test
    void конвертОбъектом_тожеРазбирается() {
        assertEquals("forgejo:get_pr#failed", LoreRequestStatsFilter.forgejoAppEntityOf(
            new JsonObject(env("forgejo:get_pr", "failed"))));
    }

    @Test
    void неКонвертМиниаппа_null_иПишетсяКакРаньше() {
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf(null));
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf("не json"));
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf("[1,2]"));
        // ответ confirm подтверждения — {result: ok}, конверта нет
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf(new JsonObject().put("result", "ok").encode()));
        // QG-прогон read — отчёт, не конверт
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf(new JsonObject().put("verdict", "PASS").encode()));
        // чужой kind или без исхода
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf(env("task", "found")));
        assertNull(LoreRequestStatsFilter.forgejoAppEntityOf(new JsonObject().put("v", 1).put("kind", "forgejo:x").encode()));
    }
}
