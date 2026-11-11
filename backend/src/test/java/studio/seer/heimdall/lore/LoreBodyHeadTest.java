package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-BODY-MORE — «голова» тела в строке среза.
 *
 * <p>Боль: вид «Лента» у задач, ADR, решений, спек и фич не показывал первые
 * абзацы до раскрытия — тела в строке среза нет, и kit писал «Ещё» над пустым
 * местом. Слово владелицы 10.11: «грузить первые 3 абзаца сразу, остальное при
 * раскрытии». Голова режется НА СЕРВЕРЕ: тяжёлые тела в ответ среза не едут.
 */
class LoreBodyHeadTest {

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static Map<String, Object> one(Map<String, Object> r) {
        List<Map<String, Object>> in = new ArrayList<>();
        in.add(r);
        Map<String, Object> out = LoreBodyHead.fold(in).get(0);
        for (String k : out.keySet()) assertFalse(k.startsWith(LoreBodyHead.SRC), "служебная колонка наружу не выходит: " + out);
        return out;
    }

    @Test
    void firstThreeParagraphsAndTheRestCount() {
        Map<String, Object> out = one(row("task_uid", "S/T-1",
            LoreBodyHead.SRC + "1", "Первый.\n\nВторой\nс переносом.\r\n\r\nТретий.\n  \nЧетвёртый.\n\nПятый."));
        assertEquals(List.of("Первый.", "Второй\nс переносом.", "Третий."), out.get("body_head"));
        assertEquals(2, out.get("body_rest"));
        assertEquals(true, out.get("body_more"));
    }

    @Test
    void severalFieldsAreOneBodyInLeadOrder() {
        // ADR: контекст, затем решение — тот же порядок, что lead в web-next и тела паспорта.
        Map<String, Object> out = one(row("adr_id", "ADR-1",
            LoreBodyHead.SRC + "1", "Контекст.", LoreBodyHead.SRC + "2", "Решение А.\n\nРешение Б."));
        assertEquals(List.of("Контекст.", "Решение А.", "Решение Б."), out.get("body_head"));
        assertEquals(0, out.get("body_rest"));
        assertEquals(false, out.get("body_more"));
    }

    @Test
    void emptyBodyIsVerifiedEmptyNotUnknown() {
        Map<String, Object> out = one(row("adr_id", "ADR-1", LoreBodyHead.SRC + "1", null, LoreBodyHead.SRC + "2", "  \n\n "));
        assertEquals(List.of(), out.get("body_head"));
        assertEquals(0, out.get("body_rest"));
        assertEquals(false, out.get("body_more"));
    }

    @Test
    void hugeParagraphIsCutAndCountedAsRest() {
        String huge = "x".repeat(LoreBodyHead.HEAD_CHARS * 3);
        Map<String, Object> out = one(row("spec_id", "S", LoreBodyHead.SRC + "1", "Коротко.\n\n" + huge + "\n\nХвост."));
        @SuppressWarnings("unchecked")
        List<String> head = (List<String>) out.get("body_head");
        int chars = head.stream().mapToInt(String::length).sum();
        assertTrue(chars <= LoreBodyHead.HEAD_CHARS + 1, "голова не тяжёлая: " + chars);
        assertTrue(head.get(head.size() - 1).endsWith("…"), "обрезанный абзац помечен");
        assertEquals(2, out.get("body_rest"), "обрезанный абзац и хвост — остаток");
        assertEquals(true, out.get("body_more"));
    }

    @Test
    void redactedBodyGivesNoHeadRatherThanAnEmptyOne() {
        // Нет роли в проекте спеки: «пусто» соврало бы, что тела нет. Головы нет — клиент
        // честно предлагает раскрыть, а паспорт скажет «скрыто».
        Map<String, Object> out = one(row("spec_id", "S", LoreBodyHead.SRC + "1", null, "body_redacted", true));
        assertFalse(out.containsKey("body_head"), String.valueOf(out));
        assertFalse(out.containsKey("body_more"), String.valueOf(out));
    }

    @Test
    void rowsWithoutSourceAreUntouched() {
        Map<String, Object> r = row("sprint_id", "S1", "context_md", "x");
        assertEquals(r, one(new LinkedHashMap<>(r)));
    }

    @Test
    void feedSectionsGetHeadColumnsAndCountsDoNot() {
        for (String id : List.of("adrs", "open_tasks", "closed_tasks", "decisions", "specs", "use_cases")) {
            LoreSlices.Composed c = LoreSlices.compose(id, Map.of());
            String sql = LoreBodyHead.withSources(id, c.sql());
            assertTrue(sql.contains("AS " + LoreBodyHead.SRC + "1"), id + ": " + sql);
            assertFalse(c.sql().contains(LoreBodyHead.SRC), id + ": счётчик и фасеты тела не тянут — колонки только у выдачи");
        }
        assertEquals("SELECT x FROM T", LoreBodyHead.withSources("sprints", "SELECT x FROM T"), "раздел без головы — SQL как был");
        // Спека: голова — тоже тело, обнуляется читателю без роли (как content_md в spec_by_id).
        assertTrue(LoreSlices.BODY_SCOPED.getOrDefault("specs", List.of()).contains(LoreBodyHead.SRC + "1"));
    }

    @Test
    void sliceEndpointFoldsTheHead() throws Exception {
        String src = Files.readString(Path.of("src/main/java/studio/seer/heimdall/lore/AidaLoreResource.java"));
        assertTrue(src.contains("LoreBodyHead.withSources(id"), "выдача среза добавляет колонки головы");
        assertTrue(src.contains("LoreBodyHead.fold("), "выдача среза сворачивает голову");
    }
}
