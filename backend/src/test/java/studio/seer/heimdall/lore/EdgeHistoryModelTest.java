package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 · Историчность связи — признаком в модели, одним описанием на все связи.
 *
 * <p>Слова владелицы 15.11.2026: «История рёбер: версии рёбер, кажется, ведутся в самом ребре, проверь».
 * Проверено: так ведёт историю только ROLE_HELD_BY (valid_from у всех, valid_to закрывает TaskRoleService).
 * Решение (её «согласна» в книге «Декларация модели»): у связи в модели признак «историчная», и тогда на
 * ребре служебные «действует с» / «действует по». Описание одно на модель (раздел {@code edge_history}):
 * какие поля версии у ребра и какие связи ведут историю, — а не флаг, разбросанный по сторонам связи.
 */
class EdgeHistoryModelTest {

    @Test
    void modelDeclaresHistoricEdgesOnce() {
        LoreModelFile.Content c = LoreModelFile.content();
        assertEquals(List.of("valid_from", "valid_to"), c.edgeHistory().fields(),
            "поля версии у историчного ребра — «действует с» и «действует по», одни на все связи");
        assertEquals(Set.of("ROLE_HELD_BY", "IN_PHASE", "TARGETS_MILESTONE", "HAS_PROJECT_ROLE", "FILLS_ROLE", "ANSWERABLE_BY"),
            c.edgeHistory().edges().keySet());
        for (var e : c.edgeHistory().edges().entrySet())
            assertFalse(e.getValue() == null || e.getValue().isBlank(), e.getKey() + ": не сказано, почему связь историчная");
    }

    @Test
    void serverAsksTheModel() {
        assertTrue(LoreEdgeHistory.historic("IN_PHASE"));
        assertTrue(LoreEdgeHistory.historic("ROLE_HELD_BY"));
        assertFalse(LoreEdgeHistory.historic("PART_OF"), "состав спринта — не историчная связь");
        assertFalse(LoreEdgeHistory.historic("CAMPAIGN_IN_PHASE"), "совпадение по подстроке — не та связь");
        assertEquals("outE('IN_PHASE')[valid_to IS NULL].inV()", LoreEdgeHistory.out("IN_PHASE"));
        assertEquals("inE('TARGETS_MILESTONE')[valid_to IS NULL].outV()", LoreEdgeHistory.in("TARGETS_MILESTONE"));
        assertEquals("out('PART_OF')", LoreEdgeHistory.out("PART_OF"), "неисторичная связь — обычный переход");
        assertEquals(" AND valid_to IS NULL", LoreEdgeHistory.andCurrent("HAS_PROJECT_ROLE"));
        assertEquals("", LoreEdgeHistory.andCurrent("PART_OF"));
    }

    @Test
    void historicEdgeMustBeARelationOfTheModel() throws Exception {
        String text = Files.readString(Path.of("src", "main", "resources", "lore-model", "lore-model.json"));
        String broken = text.replace("\"FILLS_ROLE\" : \"", "\"NO_SUCH_EDGE\" : \"");
        assertNotEquals(text, broken, "положительный контроль: раздел edge_history в файле есть");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(broken));
        assertTrue(e.getMessage().contains("NO_SUCH_EDGE"), e.getMessage());
    }

    @Test
    void modelDocumentCarriesEdgeHistory() {
        var doc = LoreEdgeHistory.surface(LoreModelFile.content());
        assertEquals(List.of("valid_from", "valid_to"), doc.get("fields"));
        assertTrue(((java.util.Map<?, ?>) doc.get("edges")).containsKey("HAS_PROJECT_ROLE"));
    }
}
