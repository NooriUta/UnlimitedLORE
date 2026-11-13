package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** SPRINT_UXR_POLISH_UAT_1113/PU-20 — свёртка проверки: план автопочинки и ручной список, без базы. */
@SuppressWarnings("unchecked")
class MdRefCheckTest {

    static final MdRefRules.Ctx CTX = new MdRefRules.Ctx(Map.of(
        "task", Set.of("SPRINT_A/PU-09", "SPRINT_A/PU-15", "SPRINT_B/PU-15"),
        "sprint", Set.of("SPRINT_A", "SPRINT_B"),
        "adr", Set.of("ADR-LORE-050")), Set.of(), Map.of(), Map.of());

    @SuppressWarnings("unchecked")
    static Map<String, Object> run(List<MdRefCheck.Field> fields) {
        return MdRefCheck.compute(fields, CTX, Map.of(), MdRefRules.defaults());
    }

    @Test
    void oneRowPerRecordEvenWithSeveralFieldsAndPlaces() {
        Map<String, Object> out = run(List.of(
            new MdRefCheck.Field("KnowADR", "ADR-X", "context_md", "PU-15 и ADR-NOPE-1", false, true),
            new MdRefCheck.Field("KnowADR", "ADR-X", "decision_md", "ещё PU-15", false, true)));
        Map<String, Object> manual = (Map<String, Object>) out.get("manual");
        assertEquals(1, manual.get("records"), "одна строка на запись");
        assertEquals(3, manual.get("places"));
        List<Map<String, Object>> rows = (List<Map<String, Object>>) manual.get("rows");
        assertEquals(Map.of("ambiguous_code", 2, "no_record", 1), rows.get(0).get("by_kind"));
    }

    @Test
    void autoPlanCountsEditsRecordsAndSignatures() {
        Map<String, Object> out = run(List.of(
            new MdRefCheck.Field("KnowTask", "SPRINT_A/PU-15", "note_md", "см. PU-09 и ADR-LORE-050", false, true),
            new MdRefCheck.Field("KnowTask", "SPRINT_B/PU-15", "note_md", "ADR-LORE-050", false, true)));
        Map<String, Object> auto = (Map<String, Object>) out.get("auto");
        assertEquals(3, auto.get("edits"));
        assertEquals(2, auto.get("records"));
        assertEquals(Map.of("lone_own_sprint,shape", 1, "shape", 1), auto.get("signatures"));
        Map<String, Object> shape = (Map<String, Object>) ((Map<String, Object>) auto.get("rules")).get("shape");
        assertEquals(2, shape.get("edits"));
        assertEquals(2, shape.get("records"));
    }

    @Test
    void divergedTextIsNotAutoFixedButShownToHuman() {
        Map<String, Object> out = run(List.of(
            new MdRefCheck.Field("KnowTask", "SPRINT_A/PU-15", "note_md", "см. ADR-LORE-050", true, true)));
        assertEquals(0, ((Map<String, Object>) out.get("auto")).get("edits"), "расходящийся текст не правим автоматом");
        Map<String, Object> manual = (Map<String, Object>) out.get("manual");
        assertEquals(Map.of("records", 1, "places", 1), ((Map<String, Object>) manual.get("groups")).get("diverged"));
    }

    @Test
    void notWritableTypeGoesToHumanToo() {
        Map<String, Object> out = run(List.of(
            new MdRefCheck.Field("BragiInsight", "INS-1", "statement_md", "ADR-LORE-050", false, false)));
        assertEquals(0, ((Map<String, Object>) out.get("auto")).get("edits"));
        assertTrue(((Map<String, Object>) ((Map<String, Object>) out.get("manual")).get("groups")).containsKey("not_writable"));
    }

    @Test
    void externalLinksAreNeitherAutoNorManual() {
        Map<String, Object> out = run(List.of(
            new MdRefCheck.Field("KnowTask", "SPRINT_A/PU-15", "note_md", "https://github.com/x/y/pull/1", false, true)));
        assertEquals(0, ((Map<String, Object>) out.get("auto")).get("edits"));
        assertEquals(0, ((Map<String, Object>) out.get("manual")).get("records"));
    }

    @Test
    void deterministic() {
        List<MdRefCheck.Field> f = List.of(
            new MdRefCheck.Field("KnowTask", "SPRINT_B/PU-15", "note_md", "PU-15 ADR-LORE-050", false, true),
            new MdRefCheck.Field("KnowTask", "SPRINT_A/PU-15", "note_md", "PU-09", false, true));
        assertEquals(run(f).toString(), run(List.of(f.get(1), f.get(0))).toString(), "порядок входа не влияет на ответ");
    }
}
