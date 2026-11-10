package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7C_WHY_CANVAS/S7C-01 — хранение холста на сервере, чистая часть:
 * проверка холста, стикера/рамки, стрелки; DDL только аддитивный.
 */
class LoreCanvasTest {

    private static Map<String, Object> item(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void canvasNeedsTitleAndKnownTemplate() {
        assertNull(LoreCanvas.canvasError("Ценностное предложение LORE", "vp"));
        assertNull(LoreCanvas.canvasError("Свободный", "free"));
        assertNotNull(LoreCanvas.canvasError("", "vp"), "пустое название");
        assertNotNull(LoreCanvas.canvasError("x", "miro"), "шаблон из списка: vp, bmc, story_map, journey, free");
    }

    @Test
    void stickerIsValidatedByFieldName() {
        assertNull(LoreCanvas.itemError(item("item_uid", "st-1", "kind", "sticker", "text", "боль: долго искать",
            "x", 10, "y", 20.5, "w", 160, "h", 90)));
        String noUid = LoreCanvas.itemError(item("kind", "sticker", "x", 0, "y", 0));
        assertTrue(noUid != null && noUid.contains("item_uid"), noUid);
        String badKind = LoreCanvas.itemError(item("item_uid", "a", "kind", "circle", "x", 0, "y", 0));
        assertTrue(badKind != null && badKind.contains("kind"), badKind);
        String noPos = LoreCanvas.itemError(item("item_uid", "a", "kind", "sticker"));
        assertTrue(noPos != null && noPos.contains("x"), "без координат стикер не положить: " + noPos);
        String bigText = LoreCanvas.itemError(item("item_uid", "a", "kind", "sticker", "x", 0, "y", 0,
            "text", "я".repeat(LoreCanvas.TEXT_MAX + 1)));
        assertTrue(bigText != null && bigText.contains(String.valueOf(LoreCanvas.TEXT_MAX)), bigText);
    }

    @Test
    void bindingToAnEntityNeedsBothTypeAndId() {
        assertNull(LoreCanvas.itemError(item("item_uid", "a", "kind", "sticker", "x", 0, "y", 0,
            "ref_type", "pain", "ref_id", "PAIN-1")));
        assertNotNull(LoreCanvas.itemError(item("item_uid", "a", "kind", "sticker", "x", 0, "y", 0,
            "ref_type", "pain")), "привязка — тип И id, иначе висячая");
    }

    @Test
    void linkNeedsBothEndsAndAType() {
        assertNull(LoreCanvas.linkError(item("link_uid", "l1", "from_uid", "a", "to_uid", "b", "edge", "RELIEVES")));
        assertNotNull(LoreCanvas.linkError(item("link_uid", "l1", "from_uid", "a", "edge", "RELIEVES")));
        assertNotNull(LoreCanvas.linkError(item("link_uid", "l1", "from_uid", "a", "to_uid", "a", "edge", "X")),
            "стрелка в себя бессмысленна");
        assertNotNull(LoreCanvas.linkError(item("link_uid", "l1", "from_uid", "a", "to_uid", "b", "edge", "bad edge")),
            "тип ребра — идентификатор в верхнем регистре");
    }

    /** S7C-05: стрелка между привязанными стикерами — ребро графа из каталога S2-06. */
    @Test
    void arrowBetweenBoundStickersIsATypedGraphEdge() {
        LoreCanvas.GraphPlan ok = LoreCanvas.graphPlan("task", "adr", "JUSTIFIED_BY");
        assertNull(ok.error(), ok.error());
        assertFalse(ok.drawing());
        assertEquals("KnowTask", ok.from().vertexClass());
        assertEquals("KnowADR", ok.to().vertexClass());
        assertEquals("JUSTIFIED_BY", ok.edge());

        LoreCanvas.GraphPlan vp = LoreCanvas.graphPlan("use_case", "pain", "RELIEVES");
        assertNull(vp.error(), "VP-канва: сценарий снимает боль — " + vp.error());

        LoreCanvas.GraphPlan fallback = LoreCanvas.graphPlan("adr", "task", "REFERENCES");
        assertNull(fallback.error(), "REFERENCES — запасной для любой пары каталога");
    }

    @Test
    void arrowWithAnUnboundEndStaysADrawing() {
        assertTrue(LoreCanvas.graphPlan(null, "adr", "RELIEVES").drawing());
        assertTrue(LoreCanvas.graphPlan("task", null, "ANYTHING").drawing());
        assertTrue(LoreCanvas.graphPlan(null, null, "X").drawing());
    }

    @Test
    void boundArrowWithAWrongTypeOrDirectionIsRefused() {
        String wrongType = LoreCanvas.graphPlan("task", "adr", "RELIEVES").error();
        assertTrue(wrongType != null && wrongType.contains("JUSTIFIED_BY"),
            "отказ называет, что допустимо: " + wrongType);
        assertNotNull(LoreCanvas.graphPlan("adr", "task", "JUSTIFIED_BY").error(),
            "направление ребра не разворачивается молча");
        String unknown = LoreCanvas.graphPlan("feature", "adr", "REFERENCES").error();
        assertTrue(unknown != null && unknown.contains("feature"), "неизвестный тип привязки: " + unknown);
    }

    @Test
    void canvasRefNamesTheArrow() {
        assertEquals("cv-1/l1", LoreCanvas.canvasRef("cv-1", "l1"));
    }

    @Test
    void batchHasACeiling() {
        assertTrue(LoreCanvas.BATCH_MAX >= 100, "типичный холст (≤100 стикеров) сохраняется одним вызовом");
    }

    @Test
    void schemaIsAdditiveOnly() {
        for (String ddl : LoreCanvas.SCHEMA_SQL) {
            assertTrue(ddl.contains("IF NOT EXISTS"), ddl);
            assertTrue(ddl.contains("KnowCanvas"), "только новые типы холста: " + ddl);
            assertFalse(ddl.toUpperCase().contains("DROP"), ddl);
        }
    }
}
