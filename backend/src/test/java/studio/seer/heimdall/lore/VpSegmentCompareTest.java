package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/FIT-04 · сравнение сегментов СОСТАВОМ: какие ценности общие,
 * какие только у одного — чистая функция поверх строк среза {@code segment_values}.
 */
class VpSegmentCompareTest {

    private static Map<String, Object> row(String type, String id, String title, String... actors) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("value_type", type);
        m.put("value_id", id);
        m.put("title", title);
        m.put("actor_ids", Arrays.asList(actors));
        return m;
    }

    private static final Map<String, String> NAMES = Map.of(
        "ROLE-DEV", "Разработчик", "ROLE-PM", "Менеджер продукта", "ROLE-AGENT", "Агент сессии");

    private static final List<Map<String, Object>> ROWS = List.of(
        row("job", "JOB-SHIP", "Выкатить изменение", "ROLE-DEV", "ROLE-AGENT"),
        row("pain", "PAIN-CI", "CI красный без причины", "ROLE-DEV"),
        row("gain", "GAIN-TRUST", "Доверять выдаче", "ROLE-AGENT", "ROLE-PM"),
        row("pain", "PAIN-STALE", "Статусы протухли", "ROLE-PM"),
        row("job", "JOB-NOBODY", "Работа без роли"),
        row("gain", "GAIN-PM-ONLY", "Выгода только менеджера", "ROLE-PM"));

    private static Map<String, String> byId(VpSegmentCompare.Result r) {
        Map<String, String> m = new LinkedHashMap<>();
        for (VpSegmentCompare.Value v : r.values()) m.put(v.value_id(), v.membership() + (v.only_of() == null ? "" : ":" + v.only_of()));
        return m;
    }

    @Test
    void два_сегмента_общая_и_только_у_каждого() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of("ROLE-DEV", "ROLE-AGENT"), NAMES);
        assertTrue(r.comparable());
        assertEquals(Map.of("JOB-SHIP", "shared", "PAIN-CI", "only:ROLE-DEV", "GAIN-TRUST", "only:ROLE-AGENT"), byId(r),
            "ценность вне обоих сегментов в состав не входит");
        assertEquals(List.of("JOB-SHIP", "PAIN-CI", "GAIN-TRUST"), r.values().stream().map(VpSegmentCompare.Value::value_id).toList(),
            "порядок: общие, затем «только у» в порядке сегментов");
    }

    @Test
    void у_ценности_видны_прочие_роли_вне_выборки() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of("ROLE-DEV", "ROLE-AGENT"), NAMES);
        VpSegmentCompare.Value trust = r.values().stream().filter(v -> v.value_id().equals("GAIN-TRUST")).findFirst().orElseThrow();
        assertEquals(List.of("ROLE-AGENT"), trust.in_segments());
        assertEquals(List.of("ROLE-PM"), trust.other_actors(), "«только у агента» среди выбранных, но есть и у менеджера");
        assertEquals("Доверять выдаче", trust.title());
        assertEquals("gain", trust.value_type());
    }

    @Test
    void три_сегмента_частичная_общность() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of("ROLE-DEV", "ROLE-AGENT", "ROLE-PM"), NAMES);
        Map<String, String> m = byId(r);
        assertEquals("partial", m.get("JOB-SHIP"), "у двух из трёх — не «общая» и не «только»");
        assertEquals("partial", m.get("GAIN-TRUST"));
        assertEquals("only:ROLE-PM", m.get("PAIN-STALE"));
        assertFalse(m.containsKey("JOB-NOBODY"));
    }

    @Test
    void общая_для_всех_трёх() {
        List<Map<String, Object>> rows = List.of(row("job", "JOB-ALL", "Всем", "ROLE-PM", "ROLE-DEV", "ROLE-AGENT"));
        VpSegmentCompare.Result r = VpSegmentCompare.compare(rows, List.of("ROLE-DEV", "ROLE-AGENT", "ROLE-PM"), NAMES);
        assertEquals(Map.of("JOB-ALL", "shared"), byId(r));
        assertEquals(List.of("ROLE-DEV", "ROLE-AGENT", "ROLE-PM"), r.values().get(0).in_segments(), "порядок — порядок выбора, не порядок рёбер");
    }

    @Test
    void ценности_без_роли_отдельно_а_не_молча() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of("ROLE-DEV", "ROLE-AGENT"), NAMES);
        assertEquals(List.of("JOB-NOBODY"), r.unassigned().stream().map(VpSegmentCompare.Value::value_id).toList());
    }

    @Test
    void сегмент_без_ценностей_и_неизвестный_сегмент_различаются() {
        Map<String, String> names = new LinkedHashMap<>(NAMES);
        names.put("ROLE-EMPTY", "Пустая роль");
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of("ROLE-DEV", "ROLE-EMPTY", "ROLE-GHOST"), names);
        assertEquals(List.of("ROLE-GHOST"), r.unknown_segments(), "такой роли нет вовсе");
        assertEquals(List.of("ROLE-EMPTY"), r.segments_without_values(), "роль есть, ценностей у неё нет");
        assertEquals(List.of("ROLE-DEV", "ROLE-EMPTY"), r.segments().stream().map(VpSegmentCompare.Segment::actor_id).toList());
        assertEquals("Пустая роль", r.segments().get(1).name());
        assertTrue(r.comparable(), "две известные роли — сравнимо, пусть одна и пуста");
        assertEquals(Map.of("JOB-SHIP", "only:ROLE-DEV", "PAIN-CI", "only:ROLE-DEV"), byId(r));
    }

    @Test
    void меньше_двух_известных_несравнимо() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of("ROLE-DEV", "ROLE-GHOST"), NAMES);
        assertFalse(r.comparable());
        assertEquals(List.of(), r.values(), "сравнивать не с чем — состав пуст, а не «всё только у одного»");
    }

    @Test
    void повторы_и_пробелы_в_выборе_схлопываются() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(ROWS, List.of(" ROLE-DEV", "ROLE-DEV", "", "ROLE-AGENT"), NAMES);
        assertEquals(List.of("ROLE-DEV", "ROLE-AGENT"), r.segments().stream().map(VpSegmentCompare.Segment::actor_id).toList());
    }

    @Test
    void разбор_параметра_segments() {
        assertEquals(List.of("ROLE-DEV", "ROLE-AGENT"), VpSegmentCompare.parseSegments("ROLE-DEV, ROLE-AGENT,,ROLE-DEV"));
        assertEquals(List.of(), VpSegmentCompare.parseSegments(null));
        assertThrows(IllegalArgumentException.class, () -> VpSegmentCompare.parseSegments("ROLE-DEV,ROLE'; DROP"));
    }

    @Test
    void null_и_одиночное_значение_в_actor_ids() {
        Map<String, Object> single = new LinkedHashMap<>(row("pain", "PAIN-X", "x"));
        single.put("actor_ids", "ROLE-DEV");
        Map<String, Object> withNull = new LinkedHashMap<>(row("pain", "PAIN-Y", "y"));
        withNull.put("actor_ids", Arrays.asList(null, "ROLE-AGENT"));
        Map<String, Object> missing = new LinkedHashMap<>(row("pain", "PAIN-Z", "z"));
        missing.remove("actor_ids");
        VpSegmentCompare.Result r = VpSegmentCompare.compare(List.of(single, withNull, missing), List.of("ROLE-DEV", "ROLE-AGENT"), NAMES);
        assertEquals(Map.of("PAIN-X", "only:ROLE-DEV", "PAIN-Y", "only:ROLE-AGENT"), byId(r));
        assertEquals(List.of("PAIN-Z"), r.unassigned().stream().map(VpSegmentCompare.Value::value_id).toList());
    }
}
