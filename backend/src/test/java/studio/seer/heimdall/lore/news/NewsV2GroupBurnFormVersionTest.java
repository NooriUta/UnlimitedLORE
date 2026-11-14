package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-14-GROUP-BURN-FORM-VERSION — форма ответа GET /lore/news/v2 для miniLORE.
 * <ul>
 *   <li>в каждой группе дня {@code days[].groups[]} есть {@code burn} — тот же расчёт §7.2a, что у
 *       {@code metrics.tasks} (открытые на начало и конец ведра); клиент не считает сгорание сам;</li>
 *   <li>{@code meta.form_version} — версия формы ответа, константа {@link NewsV2Engine#FORM_VERSION}:
 *       клиент узнаёт, какую форму разбирает, а не угадывает по набору ключей.</li>
 * </ul>
 */
class NewsV2GroupBurnFormVersionTest {

    @SuppressWarnings("unchecked")
    static Map<String, Object> m(Object o, String k) { return (Map<String, Object>) ((Map<String, Object>) o).get(k); }
    static int n(Object o, String k) { return ((Number) ((Map<?, ?>) o).get(k)).intValue(); }

    @Test
    @SuppressWarnings("unchecked")
    void everyDayGroupCarriesBurn() {
        for (String axis : List.of("project", "component", "sprint", "type")) {
            Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(NewsV2DaysContractTest.query(axis, null, null));
            List<Map<String, Object>> days = (List<Map<String, Object>>) out.get("days");
            assertFalse(days.isEmpty(), axis);
            int groups = 0;
            for (Map<String, Object> d : days)
                for (Map<String, Object> g : (List<Map<String, Object>>) d.get("groups")) {
                    groups++;
                    Map<String, Object> b = m(g, "burn");
                    assertNotNull(b, axis + " " + d.get("day") + "/" + g.get("key") + ": нет burn");
                    assertEquals(n(b, "open_start") - n(b, "open_end"), n(b, "burn"),
                        "burn группы = открытые на начало − на конец (§7.2a)");
                }
            assertTrue(groups > 0, axis + ": в днях нет групп");
        }
    }

    @Test
    void metaCarriesFormVersion() {
        Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(NewsV2DaysContractTest.query("project", null, null));
        assertEquals(NewsV2Engine.FORM_VERSION, m(out, "meta").get("form_version"));
        assertTrue(NewsV2Engine.FORM_VERSION.matches("news/\\d+\\.\\d+"), NewsV2Engine.FORM_VERSION);
    }
}
