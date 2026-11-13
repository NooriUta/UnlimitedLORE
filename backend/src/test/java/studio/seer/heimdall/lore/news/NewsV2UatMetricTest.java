package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static studio.seer.heimdall.lore.news.NewsV2EngineFixtureTest.*;

/**
 * Замечание владелицы 13.11.2026: «в новостях не учитывается в метриках uat что бы было легче
 * производить сверку». UAT входил в «ждёт выкатки» (Y) вместе с RFD, и по метрикам нельзя было
 * сверить, сколько задач ждёт человеческой приёмки. Теперь у UAT своя цифра: на t0 и t1, по дням,
 * по группам осей, «вошло в UAT за период» и примеры. «Ждёт выкатки» UAT по-прежнему включает —
 * это его подмножество, а не замена.
 */
class NewsV2UatMetricTest {

    static final String UAT = "🧪 UAT TESTING";

    static NewsV2Engine engine() {
        List<TaskRecord> tasks = List.of(
            // RFD в периоде — ждёт выкатки, но не приёмки.
            new TaskRecord("S3/D", "S3", "D", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-05T10:00", RFD)), RFD),
            // RFD → UAT внутри периода: вошла в UAT.
            new TaskRecord("S3/X", "S3", "X", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-03T10:00", RFD),
                v("2026-11-05T12:00", UAT)), UAT),
            // В UAT с до-периода, человек принял в периоде.
            new TaskRecord("S3/Y", "S3", "Y", null, List.of(v("2026-10-20T10:00", PL), v("2026-10-25T10:00", UAT),
                v("2026-11-04T10:00", DONE)), DONE),
            // В UAT с до-периода и до конца.
            new TaskRecord("S3/Z", "S3", "Z", null, List.of(v("2026-10-20T10:00", PL), v("2026-10-26T10:00", UAT)), UAT));
        Input in = new Input(T0, T1, Instant.parse("2026-11-07T20:00:00Z"), MSK, tasks, sprints(), List.of(),
            List.of(), List.of(), null);
        return new NewsV2Engine(in, AGENT_ON_C, KnowledgeStatusHistory.NONE);
    }

    @SuppressWarnings("unchecked")
    @Test
    void uatСчитаетсяОтдельнойЦифрой() {
        NewsV2Engine e = engine();
        NewsV2Engine.ShipModel M = e.shipModel(Query.none());
        Map<String, Object> out = e.tasksOut(M);
        Map<String, Object> all = (Map<String, Object>) out.get("all");
        assertEquals(2, all.get("uat_t0"), "Y и Z в UAT на t0");
        assertEquals(2, all.get("uat_t1"), "X и Z в UAT на t1");
        assertEquals(List.of("S3/X", "S3/Z"), ((Map<String, Object>) all.get("examples")).get("uat"));
        // «Ждёт выкатки» UAT не теряет: D + X + Z (спринт S3 без релиза).
        assertEquals(3, all.get("waiting_t1"));
        assertEquals(1, out.get("entered_uat"), "за период в UAT вошла только X");
        List<Map<String, Object>> days = (List<Map<String, Object>>) out.get("days");
        assertEquals(2, days.get(days.size() - 1).get("uat_end"));
        assertEquals(2, days.get(2).get("uat_end"), "конец 03.11 МСК: Y и Z (X ещё в RFD)");
        assertEquals(1, days.get(3).get("uat_end"), "конец 04.11 МСК: Y принята, осталась Z");
    }

    @SuppressWarnings("unchecked")
    @Test
    void uatВГруппахОсей() {
        NewsV2Engine e = engine();
        Map<String, Object> out = e.tasksOut(e.shipModel(Query.none()));
        Map<String, Object> sprint = (Map<String, Object>) ((Map<String, Object>) out.get("by_axis")).get("sprint");
        Map<String, Object> s3 = ((List<Map<String, Object>>) sprint.get("groups")).get(0);
        assertEquals("S3", s3.get("key"));
        assertEquals(2, ((Map<String, Object>) s3.get("total")).get("uat_t1"));
    }
}
