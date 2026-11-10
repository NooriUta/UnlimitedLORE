package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 50а/51а/55а: чипы шапки — свои первыми, унаследованные с источником и по частоте. */
class LoreRecordChipsTest {

    private static LoreRecordChips.Inherited from(String id, String type, String src) {
        return new LoreRecordChips.Inherited(id, type, src);
    }

    @Test
    void ownFirst_thenInherited_withSource_andLabel() {
        List<Map<String, Object>> c = LoreRecordChips.chips(List.of("OWN"),
            List.of(from("SPR", "sprint", "S1")), Map.of("OWN", "Свой", "SPR", "От спринта"));
        assertEquals(List.of("OWN", "SPR"), c.stream().map(m -> m.get("id")).toList());
        assertEquals("Свой", c.get(0).get("label"));
        assertNull(c.get(0).get("inherited_from"));
        assertEquals(Map.of("type", "sprint", "id", "S1"), c.get(1).get("inherited_from"));
    }

    @Test
    void inheritedThatIsOwn_isNotRepeated_andLabelFallsBackToId() {
        List<Map<String, Object>> c = LoreRecordChips.chips(List.of("A"),
            List.of(from("A", "sprint", "S1"), from("B", "sprint", "S1")), Map.of());
        assertEquals(List.of("A", "B"), c.stream().map(m -> m.get("id")).toList());
        assertNull(c.get(0).get("inherited_from"), "своё остаётся своим");
        assertEquals("B", c.get(1).get("label"), "подпись не выдумывается");
    }

    @Test
    void inherited_byFrequency_thenFirstSeen_firstSourceWins() {
        List<Map<String, Object>> c = LoreRecordChips.chips(List.of(), List.of(
            from("RARE", "sprint", "S1"), from("OFTEN", "sprint", "S2"), from("OFTEN", "sprint", "S3"),
            from("TIE", "sprint", "S4")), Map.of());
        assertEquals(List.of("OFTEN", "RARE", "TIE"), c.stream().map(m -> m.get("id")).toList());
        assertEquals(Map.of("type", "sprint", "id", "S2"), c.get(0).get("inherited_from"));
    }

    @Test
    void ownComponents_specAndTechCarryTheSingleComponent() {
        Map<String, Object> v = new HashMap<>();
        v.put("component", "LORE");
        assertEquals(List.of("LORE"), LoreRecordChips.ownComponents("spec", v));
        assertEquals(List.of("LORE"), LoreRecordChips.ownComponents("tech", v));
        assertEquals(List.of(), LoreRecordChips.ownComponents("milestone", v));
    }
}
