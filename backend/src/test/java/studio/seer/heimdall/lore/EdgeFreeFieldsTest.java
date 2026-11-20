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
 * SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE · Свободные поля на ребре TAGGED_WITH (модель 1.18).
 *
 * <p>Решение (док report_supertags_tana_for_lore_2026_11, ред. 2.0; прототип docs/prototypes/supertags-spike.html,
 * «ок по sypertag» владелицы 20.11.2026): костяк полей — у типа (SCD2); тег несёт свободные schemaless-поля как
 * атрибуты ребра TAGGED_WITH, без истории значений. Описание — раздел {@code edge_free_fields} модели, одно на
 * связь; набор полей тега не объявляется — он собирается из данных рёбер.
 */
class EdgeFreeFieldsTest {

    // ── Модель ────────────────────────────────────────────────────────────

    @Test
    void modelDeclaresFreeFieldsOnTaggedWith() {
        LoreModelFile.Content c = LoreModelFile.content();
        LoreEdgeFreeFields.Spec s = c.edgeFreeFields().get("TAGGED_WITH");
        assertNotNull(s, "раздел edge_free_fields называет TAGGED_WITH");
        assertEquals("tag", s.targetType());
        assertEquals("KnowTag", s.vertex());
        assertEquals("tag_id", s.key());
        assertEquals("fields", s.property(), "значения живут в одном свойстве-словаре ребра");
        assertEquals(List.of("tagged_at", "tagged_by", "changed_at", "changed_by"), s.stamp());
        assertFalse(s.why() == null || s.why().isBlank());
        assertEquals(java.util.Set.of("TAGGED_WITH"), c.edgeFreeFields().keySet(), "пока только тег");
    }

    @Test
    void ownersAreTypesWhoseTaggedWithLeadsToTag() {
        // у задачи TAGGED_WITH ведёт к компоненту — поля тега ей не положены (чтения out('TAGGED_WITH').component_id)
        assertEquals(List.of("adr", "decision"), LoreEdgeFreeFields.owners("TAGGED_WITH"));
        assertTrue(LoreEdgeFreeFields.carries("TAGGED_WITH"));
        assertFalse(LoreEdgeFreeFields.carries("PART_OF"));
    }

    @Test
    void sectionMustNameARelationOfTheModel() throws Exception {
        String text = Files.readString(Path.of("src", "main", "resources", "lore-model", "lore-model.json"));
        int at = text.indexOf("\"edge_free_fields\"");
        assertTrue(at > 0, "положительный контроль: раздел в файле есть");
        String broken = text.substring(0, at) + text.substring(at).replaceFirst("\"TAGGED_WITH\" : \\{", "\"NO_SUCH_EDGE\" : {");
        assertNotEquals(text, broken);
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(broken));
        assertTrue(e.getMessage().contains("NO_SUCH_EDGE"), e.getMessage());
    }

    @Test
    void historicEdgeCannotCarryFreeFields() {
        // поля тега — без истории; историчная связь закрывает рёбра, и значения «жили бы» в закрытом ребре
        assertFalse(LoreEdgeHistory.historic("TAGGED_WITH"));
        Map<String, LoreEdgeFreeFields.Spec> m = Map.of("ROLE_HELD_BY",
            new LoreEdgeFreeFields.Spec("tag", "KnowTag", "tag_id", "fields", List.of("tagged_at"), "x"));
        List<String> bad = LoreEdgeFreeFields.problems(m, LoreModelFile.content().typeDefs(), LoreModelFile.content().edgeHistory());
        assertTrue(bad.stream().anyMatch(x -> x.contains("ROLE_HELD_BY") && x.contains("истори")), bad.toString());
    }

    @Test
    void modelDocumentCarriesTheSection() {
        Map<String, Object> d = LoreEdgeFreeFields.surface(LoreModelFile.content(), true);
        @SuppressWarnings("unchecked")
        Map<String, Object> tw = (Map<String, Object>) d.get("TAGGED_WITH");
        assertEquals("fields", tw.get("property"));
        assertEquals(List.of("adr", "decision"), tw.get("owners"), "в /lore/model — кому положены поля");
        @SuppressWarnings("unchecked")
        Map<String, Object> canon = (Map<String, Object>) LoreEdgeFreeFields.surface(LoreModelFile.content(), false).get("TAGGED_WITH");
        assertFalse(canon.containsKey("owners"), "в файле модели owners не пишется — он выводится");
    }

    // ── Значения ──────────────────────────────────────────────────────────

    @Test
    void cleanAcceptsStringsAndMarksRemovals() {
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("risk", "high");
        in.put("due", "2026-11-27");
        in.put("verdict", "");     // пустое — снять поле
        in.put("reviewer", null);  // null — снять поле
        in.put("score", 3);        // число — строкой (у schemaless-полей нет типов)
        Map<String, String> out = LoreEdgeFreeFields.clean(in);
        assertEquals("high", out.get("risk"));
        assertEquals("3", out.get("score"));
        assertTrue(out.containsKey("verdict") && out.get("verdict") == null);
        assertTrue(out.containsKey("reviewer") && out.get("reviewer") == null);
    }

    @Test
    void cleanRefusesBadKeysAndShapes() {
        assertThrows(IllegalArgumentException.class, () -> LoreEdgeFreeFields.clean(Map.of("Risk Level", "x")), "ключ — snake_case");
        assertThrows(IllegalArgumentException.class, () -> LoreEdgeFreeFields.clean(Map.of("@rid", "x")));
        assertThrows(IllegalArgumentException.class, () -> LoreEdgeFreeFields.clean(Map.of("risk", List.of("a"))), "значение — скаляр");
        assertThrows(IllegalArgumentException.class, () -> LoreEdgeFreeFields.clean(Map.of("risk", "x".repeat(501))));
        Map<String, Object> many = new LinkedHashMap<>();
        for (int i = 0; i < 25; i++) many.put("f" + i, "v");
        assertThrows(IllegalArgumentException.class, () -> LoreEdgeFreeFields.clean(many), "не больше 24 полей");
    }

    @Test
    void mergeOverwritesWithoutHistoryAndRemovesNulls() {
        Map<String, Object> cur = new LinkedHashMap<>(Map.of("risk", "medium", "due", "2026-11-27", "reviewer", "arharaga"));
        Map<String, String> patch = new LinkedHashMap<>();
        patch.put("risk", "high");
        patch.put("reviewer", null);
        patch.put("verdict", "нужна санитизация");
        Map<String, String> m = LoreEdgeFreeFields.merge(cur, patch);
        assertEquals(Map.of("risk", "high", "due", "2026-11-27", "verdict", "нужна санитизация"), m);
        assertEquals(List.of("due", "risk", "verdict"), new ArrayList<>(m.keySet()), "порядок ключей — по алфавиту (детерминизм)");
        assertEquals(Map.of(), LoreEdgeFreeFields.merge(null, Map.of()));
    }

    // ── Срез «сущности по тегу с полями» ─────────────────────────────────

    private static Map<String, Object> row(String type, String id, Map<String, Object> fields) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("type", type);
        r.put("id", id);
        r.put("title", "t " + id);
        r.put("fields", fields);
        return r;
    }

    @Test
    void tableColumnsAreTheUnionOfEdgeKeys() {
        List<Map<String, Object>> rows = List.of(
            row("adr", "ADR-LORE-050", Map.of("reviewer", "arharaga", "risk", "high", "due", "2026-11-27")),
            row("decision", "D-1", Map.of("risk", "medium")),
            row("adr", "ADR-2", Map.of("risk", "medium", "verdict", "ок")),
            row("adr", "ADR-3", null));
        Map<String, Object> t = LoreEdgeFreeFields.table("security-review", rows);
        assertEquals("security-review", t.get("tag"));
        assertEquals(4, t.get("total"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cols = (List<Map<String, Object>>) t.get("columns");
        assertEquals(List.of("risk", "due", "reviewer", "verdict"), cols.stream().map(c -> c.get("key")).toList(),
            "по заполненности, при равенстве — по алфавиту");
        assertEquals(3, cols.get(0).get("filled"));
        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> facets = (Map<String, Map<String, Object>>) t.get("facets");
        Map<String, Object> risk = facets.get("risk");
        assertEquals(List.of(Map.of("value", "medium", "count", 2), Map.of("value", "high", "count", 1)), risk.get("values"));
        assertEquals(1, risk.get("empty"), "«не задано» считается явно");
        assertEquals(3, risk.get("nonempty"));
        assertEquals(4, risk.get("total"));
        @SuppressWarnings("unchecked")
        Map<String, Object> types = (Map<String, Object>) t.get("types");
        assertEquals(Map.of("adr", 3, "decision", 1), types);
    }

    @Test
    void emptyTableIsEmptyNotMissing() {
        Map<String, Object> t = LoreEdgeFreeFields.table("nothing", List.of());
        assertEquals(0, t.get("total"));
        assertEquals(List.of(), t.get("columns"));
        assertEquals(Map.of(), t.get("facets"));
        assertEquals("empty", t.get("state"), "пусто — состояние, а не отсутствие ответа");
        assertEquals("ok", LoreEdgeFreeFields.table("x", List.of(row("adr", "A", Map.of()))).get("state"));
    }

    @Test
    void facetCapsDistinctValues() {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (int i = 0; i < 20; i++) rows.add(row("adr", "A" + i, Map.of("note", "v" + i)));
        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> facets = (Map<String, Map<String, Object>>) LoreEdgeFreeFields.table("x", rows).get("facets");
        assertEquals(12, ((List<?>) facets.get("note").get("values")).size());
        assertEquals(true, facets.get("note").get("truncated"), "обрезанная ось названа, а не выдана за полную");
    }

    @Test
    void sqlReadsEdgesOfTheTagOnly() {
        String sql = LoreEdgeFreeFields.entitiesSql("TAGGED_WITH");
        assertTrue(sql.contains("FROM TAGGED_WITH"), sql);
        assertTrue(sql.contains("@in.tag_id = :tag"), sql);
        assertTrue(sql.contains("@in.@type = 'KnowTag'"), "только рёбра к тегу, не к компоненту: " + sql);
        assertTrue(sql.contains("fields"), sql);
        assertTrue(sql.contains("KnowADR") && sql.contains("KnowDecision"), "тип записи — по вершине из модели: " + sql);
    }
}
