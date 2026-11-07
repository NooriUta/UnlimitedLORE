package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-06 — категория статуса на сервере.
 * Таблица — SPEC-LORE-UXR-S1-CONTRACTS, контракт 2; ось —
 * decision:D-2026-UXR-STATUS-AXIS. Главный кейс, ради которого задача:
 * {@code accepted} у ADR/спек/решений — «действует» и ОТКРЫТО (при наивной
 * связке 180 принятых ADR из 241 прятались как закрытые).
 */
class LoreStatusCategoryTest {

    @Test
    void acceptedУДокументов_действует_иОткрыто() {
        for (String type : List.of("adr", "spec", "decision")) {
            assertEquals("in_force", LoreStatusCategory.of(type, "accepted"), type);
        }
        assertFalse(LoreStatusCategory.isClosed("in_force"));
    }

    @Test
    void таблицаДокументов() {
        assertEquals("not_started", LoreStatusCategory.of("adr", "draft"));
        assertEquals("not_started", LoreStatusCategory.of("adr", "deferred"));
        assertEquals("in_progress", LoreStatusCategory.of("adr", "proposed"));
        assertEquals("withdrawn", LoreStatusCategory.of("spec", "deprecated"));
        assertEquals("withdrawn", LoreStatusCategory.of("adr", "superseded"));
    }

    @Test
    void таблицаЗадачИСпринтов_поКанонам() {
        assertEquals("not_started", LoreStatusCategory.of("task", "todo"));
        assertEquals("not_started", LoreStatusCategory.of("task", "planned"));
        assertEquals("not_started", LoreStatusCategory.of("task", "backlog"));
        assertEquals("not_started", LoreStatusCategory.of("task", "design"));
        assertEquals("in_progress", LoreStatusCategory.of("task", "active"));
        assertEquals("in_progress", LoreStatusCategory.of("task", "partial"));
        assertEquals("in_progress", LoreStatusCategory.of("task", "blocked"));
        assertEquals("in_progress", LoreStatusCategory.of("sprint", "ready_for_deploy"));
        assertEquals("finished", LoreStatusCategory.of("sprint", "done"));
        assertEquals("withdrawn", LoreStatusCategory.of("sprint", "cancelled"));
    }

    @Test
    void свободныйТекстStatusRawЧитаетсяЧерезСловарьЗначков() {
        assertEquals("finished", LoreStatusCategory.of("task", "✅ MERGED — ветка влита"));
        assertEquals("withdrawn", LoreStatusCategory.of("task", "🚫 CANCELLED"));
        assertEquals("in_progress", LoreStatusCategory.of("sprint", "🔄 IN PROGRESS"));
        assertEquals("in_progress", LoreStatusCategory.of("task", "🔴 BLOCKED — ждём токен"));
        assertEquals("not_started", LoreStatusCategory.of("task", "⬜ TODO"));
        assertEquals("finished", LoreStatusCategory.of("task", "DONE"));
    }

    @Test
    void регистрИПробелыНеВажны() {
        assertEquals("in_force", LoreStatusCategory.of("adr", "  ACCEPTED "));
        assertEquals("finished", LoreStatusCategory.of("task", " Done"));
    }

    @Test
    void нераспознанное_unknown_иСчитаетсяОткрытым() {
        assertEquals("unknown", LoreStatusCategory.of("adr", "какой-то-статус"));
        assertEquals("unknown", LoreStatusCategory.of("adr", null));
        assertEquals("unknown", LoreStatusCategory.of("task", null));
        assertEquals("unknown", LoreStatusCategory.of("task", "  "));
        assertEquals("unknown", LoreStatusCategory.of("неведомый_тип", "accepted"));
        assertFalse(LoreStatusCategory.isClosed("unknown"));
    }

    @Test
    void закрытые_толькоFinishedИWithdrawn() {
        assertTrue(LoreStatusCategory.isClosed("finished"));
        assertTrue(LoreStatusCategory.isClosed("withdrawn"));
        assertFalse(LoreStatusCategory.isClosed("not_started"));
        assertFalse(LoreStatusCategory.isClosed("in_progress"));
    }

    private static List<Map<String, Object>> rows(Map<String, Object>... ms) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> m : ms) out.add(new LinkedHashMap<>(m));
        return out;
    }

    @Test
    void обогащение_добавляетПолеКатегорииАддитивно() {
        List<Map<String, Object>> in = rows(
            Map.of("adr_id", "ADR-1", "status", "accepted"),
            Map.of("adr_id", "ADR-2", "status", "superseded"));
        List<Map<String, Object>> out = LoreStatusCategory.enrich("adrs", in);
        assertEquals("in_force", out.get(0).get(LoreStatusCategory.FIELD));
        assertEquals("withdrawn", out.get(1).get(LoreStatusCategory.FIELD));
        // аддитивно: прежние поля на месте и неизменны
        assertEquals("accepted", out.get(0).get("status"));
        assertEquals("ADR-1", out.get(0).get("adr_id"));
    }

    @Test
    void обогащение_задачИРешенийПоStatusRaw() {
        assertEquals("finished", LoreStatusCategory.enrich("open_tasks",
            rows(Map.of("task_id", "T-1", "status_raw", "✅ DONE"))).get(0).get(LoreStatusCategory.FIELD));
        assertEquals("in_progress", LoreStatusCategory.enrich("sprints",
            rows(Map.of("sprint_id", "S", "status_raw", "🔄 IN PROGRESS"))).get(0).get(LoreStatusCategory.FIELD));
        assertEquals("in_force", LoreStatusCategory.enrich("decisions",
            rows(Map.of("decision_id", "D-1", "status_raw", "accepted"))).get(0).get(LoreStatusCategory.FIELD));
        assertEquals("in_force", LoreStatusCategory.enrich("specs",
            rows(Map.of("spec_id", "SPEC-1", "status", "accepted"))).get(0).get(LoreStatusCategory.FIELD));
    }

    @Test
    void обогащение_строкаБезПоляСтатуса_получаетUnknown_неПропускается() {
        // Поле статуса не пришло (fields-проекция ещё не применена, но колонка
        // пустая) — честное «не распознали», а не отсутствие ключа.
        Map<String, Object> noStatus = new LinkedHashMap<>();
        noStatus.put("adr_id", "ADR-3");
        noStatus.put("status", null);
        List<Map<String, Object>> out = LoreStatusCategory.enrich("adrs", rows(noStatus));
        assertEquals("unknown", out.get(0).get(LoreStatusCategory.FIELD));
    }

    @Test
    void обогащение_чужойСрезНеТрогается() {
        List<Map<String, Object>> in = rows(Map.of("doc_id", "d", "status", "accepted"));
        List<Map<String, Object>> out = LoreStatusCategory.enrich("docs", in);
        assertSame(in, out);
        assertNull(out.get(0).get(LoreStatusCategory.FIELD));
    }

    @Test
    void обогащение_неизменяемыеСтрокиНеРоняют() {
        List<Map<String, Object>> in = List.of(Map.of("adr_id", "ADR-1", "status", "accepted"));
        List<Map<String, Object>> out = LoreStatusCategory.enrich("adr", in);
        assertEquals("in_force", out.get(0).get(LoreStatusCategory.FIELD));
    }

    @Test
    void всеСрезыОбогащенияСуществуютВРеестре() {
        // Опечатка в имени среза = молча не обогащённый ответ; ловим здесь.
        for (String slice : LoreStatusCategory.SLICE_STATUS.keySet()) {
            assertTrue(LoreSlices.get(slice) != null, "среза нет в реестре: " + slice);
        }
    }
}
