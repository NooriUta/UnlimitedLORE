package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-14: release_link(rel:"pr") заводил KnowPR только с
 * номером — title / url / merged_at оставались пустыми, и по релизу нельзя было понять,
 * что уехало. Обогащение берёт поля из ответа Forgejo GET /repos/{o}/{r}/pulls/{n}.
 * Чистая функция разбора — без сети и без БД.
 */
class ForgejoPrFieldsTest {

    @Test
    void mergedPrGivesTitleUrlMergedAtAndRefs() {
        Map<String, Object> f = ForgejoBridge.prFields(new JsonObject(
            "{\"number\":919,\"title\":\"feat(record): контракты паспорта\","
                + "\"html_url\":\"https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/919\","
                + "\"merged\":true,\"merged_at\":\"2026-11-08T17:50:02Z\","
                + "\"head\":{\"ref\":\"feature/record-contracts\"},\"base\":{\"ref\":\"develop\"}}"));
        assertEquals("feat(record): контракты паспорта", f.get("title"));
        assertEquals("https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/919", f.get("url"));
        assertEquals("2026-11-08T17:50:02Z", f.get("merged_at"));
        assertEquals("feature/record-contracts", f.get("head_ref"));
        assertEquals("develop", f.get("base_ref"));
    }

    // Не влитый PR: merged_at в Forgejo — null. Поле не пишется вовсе (а не пустой
    // строкой), чтобы «не влит» не выглядело как «влит в пустую дату».
    @Test
    void unmergedPrHasNoMergedAt() {
        Map<String, Object> f = ForgejoBridge.prFields(new JsonObject(
            "{\"title\":\"wip\",\"html_url\":\"https://h/o/r/pulls/1\",\"merged\":false,\"merged_at\":null,"
                + "\"head\":null,\"base\":{\"ref\":\"develop\"}}"));
        assertEquals("wip", f.get("title"));
        assertFalse(f.containsKey("merged_at"));
        assertFalse(f.containsKey("head_ref"));
        assertEquals("develop", f.get("base_ref"));
    }

    @Test
    void emptyOrNullResponseGivesNoFields() {
        assertTrue(ForgejoBridge.prFields(null).isEmpty());
        assertTrue(ForgejoBridge.prFields(new JsonObject("{\"title\":\"  \",\"html_url\":\"\"}")).isEmpty());
    }
}
