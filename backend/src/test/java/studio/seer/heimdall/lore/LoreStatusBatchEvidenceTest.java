package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-BATCH-EVIDENCE. Пачка статусов обязана нести то же, что
 * одиночный status_set: причину ({@code reason}) и доказательство
 * ({@code evidence_type}/{@code evidence_ref}).
 *
 * <p>14.11.2026, два случая за день:
 * <ul>
 *   <li>125 задач UAT → done по слову владелицы пришлось ставить по одной: пачка не несла owner_word;</li>
 *   <li>31 задача → blocked упала целиком: у blocked обязательна причина, а пачка её не передаёт.
 *   При этом каждая ошибка была голым «HTTP 400», без кода и текста отказа сервера.</li>
 * </ul>
 * Правило: всё, что пачка принимает, доходит до каждого элемента, а отказ элемента
 * назван кодом и текстом, как у одиночного вызова.
 */
class LoreStatusBatchEvidenceTest {

    @Test
    void причинаИДоказательствоДоходятДоКаждогоЭлемента() {
        var req = new LoreStatusResource.BatchStatusRequest("task", List.of("S/T-1", "S/T-2"), "done",
            "по слову владелицы", "owner_word", "14.11.2026 08:31 «закрывай»");
        for (String id : req.ids()) {
            var item = LoreStatusResource.batchItem(req, id);
            assertEquals("task", item.entity_type());
            assertEquals(id, item.id());
            assertEquals("done", item.status());
            assertEquals("по слову владелицы", item.reason());
            assertEquals("owner_word", item.evidence_type());
            assertEquals("14.11.2026 08:31 «закрывай»", item.evidence_ref());
        }
    }

    @Test
    void безПричиныИДоказательства_пустыеПоля_аНеВыдуманные() {
        var req = new LoreStatusResource.BatchStatusRequest("task", List.of("S/T-1"), "active", null, null, null);
        var item = LoreStatusResource.batchItem(req, "S/T-1");
        assertEquals(null, item.reason());
        assertEquals(null, item.evidence_type());
        assertEquals(null, item.evidence_ref());
    }

    @Test
    void отказЭлемента_названКодомИТекстом_аНеГолымHttp() {
        Response r = Response.status(400)
            .entity(Map.of("error", "REASON_REQUIRED", "detail", "у blocked обязательна причина (reason)"))
            .build();
        String e = LoreStatusResource.batchError("S/T-1", r);
        assertTrue(e.startsWith("S/T-1: "), e);
        assertTrue(e.contains("REASON_REQUIRED"), e);
        assertTrue(e.contains("у blocked обязательна причина"), e);
        assertTrue(e.contains("400"), "код HTTP тоже виден: " + e);
    }

    /**
     * 15.11.2026, живая проверка на проде: done агента без доказательства в пачке вернул
     * голое «HTTP 409». Гейт (LoreDoneGate) кладёт в ответ не Map, а {@link LoreResourceBase.LoreError} —
     * разбор понимал только Map, и код DONE_BY_HUMAN_ONLY с текстом терялись.
     */
    @Test
    void отказГейтаТипомLoreError_тожеНазванКодомИТекстом() {
        Response r = Response.status(409)
            .entity(new LoreResourceBase.LoreError("DONE_BY_HUMAN_ONLY", "агент не ставит done"))
            .build();
        String e = LoreStatusResource.batchError("S/T-1", r);
        assertEquals("S/T-1: HTTP 409 DONE_BY_HUMAN_ONLY — агент не ставит done", e);
    }

    @Test
    void отказБезТела_честноHttpКод() {
        String e = LoreStatusResource.batchError("S/T-1", Response.status(503).build());
        assertEquals("S/T-1: HTTP 503", e);
    }
}
