package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24 (решение: «Новая» для решений и спек — да): паспорт создания
 * {@code _new} говорит форме, КУДА писать, КАКИЕ поля просить и что обязательно, — из модели, а не из
 * кода клиента. Решение — проект ИЛИ родительский ADR; спека — проект. Код записи вводит человек,
 * поэтому перед записью — проверка «записи нет» (запись на сервере — upsert, строгий 409 — MT-MCP-TRUTH).
 */
class LoreModelCreateTest {

    @Test
    void decisionNeedsProjectOrParentAdr() {
        LoreModelCreate.Spec d = LoreModelFile.content().create().get("decision");
        assertNotNull(d, "у решения есть паспорт создания");
        assertEquals("/lore/decision", d.endpoint());
        assertEquals("decision_id", d.id_field());
        assertEquals(List.of("projects", "adr"), d.require_one_of());
    }

    @Test
    void specNeedsProject() {
        LoreModelCreate.Spec s = LoreModelFile.content().create().get("spec");
        assertNotNull(s);
        assertEquals("/lore/spec", s.endpoint());
        assertEquals("spec_id", s.id_field());
        assertEquals(List.of("projects"), s.require_one_of());
        // проект уходит телом создания — запись и связь одним вызовом, без спеки-сироты
        assertEquals("project", s.fields().stream().filter(f -> f.key().equals("projects")).findFirst().orElseThrow().body());
    }

    @Test
    @SuppressWarnings("unchecked")
    void newPassportCarriesTheCreateBlock() {
        Map<String, Object> b = LoreModelCreate.block("decision");
        assertEquals("/lore/decision", b.get("endpoint"));
        assertEquals("/lore/record/decision/{id}", b.get("absent_check"), "404 — код свободен, 200 — занят, иное — не проверено");
        List<Map<String, Object>> fields = (List<Map<String, Object>>) b.get("fields");
        Map<String, Object> adr = fields.stream().filter(f -> "adr".equals(f.get("key"))).findFirst().orElseThrow();
        assertEquals("adr_id", adr.get("body"));
        assertEquals("ref", adr.get("kind"), "вид и подпись поля — из модели типа");
        assertNotNull(adr.get("label"));
        assertEquals("everywhere", b.get("audience"));
        assertNull(LoreModelCreate.block("release"), "типа без паспорта создания — нет блока, форма скажет «пути нет»");
    }

    @Test
    void brokenCreateSectionIsNamed() {
        LoreModelFile.Content c = LoreModelFile.content();
        Map<String, LoreModelCreate.Spec> bad = Map.of(
            "decision", new LoreModelCreate.Spec("/lore/decision", "decision_id",
                List.of(new LoreModelCreate.Field("nope", "x"), new LoreModelCreate.Field("adr", null)), List.of("ghost")),
            "unknown_type", new LoreModelCreate.Spec("", "x_id", List.of(), List.of()));
        List<String> p = LoreModelCreate.problems(bad, c.typeDefs());
        String all = String.join("\n", p);
        assertTrue(all.contains("nope"), all);
        assertTrue(all.contains("decision.adr") && all.contains("body"), all);
        assertTrue(all.contains("ghost"), all);
        assertTrue(all.contains("unknown_type"), all);
        assertEquals(List.of(), LoreModelCreate.problems(c.create(), c.typeDefs()), "раздел в файле согласован");
    }
}
