package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * decision:D-2026-LORE-QUESTION-VISIBILITY-INHERIT-OR-LANE (accepted 06.11.2026).
 * Слово владелицы: «по вопросам вне проекта админам и супер админам остальное
 * обычная механика».
 *
 * <p>Вопрос видит участник проекта, если проект находится хотя бы одним путём:
 * своё ребро, место, где поднят (RAISED_IN), или — новое — компонент вопроса,
 * который через спринты принадлежит проекту (компонент достигает проекта только
 * через спринты). Вопрос, проект которого не находится никак, — «полоса вне
 * проектов»: её видят admin и superadmin (они обходят скоуп целиком,
 * {@link AidaLoreResource#bypassesScope}), остальным она не показывается.
 * Замер прода 06.11: открытых 202, без проекта 120, наследование открывает 80.
 */
class QuestionVisibilityLaneTest {

    static final String VIA_COMPONENT =
        "out('BELONGS_TO').in('BELONGS_TO')[@type='KnowSprint'].out('BELONGS_TO_PROJECT').slug";

    @Test
    void questionInheritsTheProjectThroughItsComponentSprints() {
        for (String slice : new String[] {"questions", "open_questions"}) {
            String scope = LoreSlices.PROJECT_SCOPED.get(slice);
            assertNotNull(scope, slice);
            assertTrue(scope.contains(VIA_COMPONENT), slice + " наследует проект через компонент: " + scope);
            assertTrue(scope.contains("out('BELONGS_TO_PROJECT').slug"), "своё ребро — по-прежнему");
            assertTrue(scope.contains("out('RAISED_IN').out('BELONGS_TO_PROJECT').slug"), "RAISED_IN — по-прежнему");
        }
    }

    @Test
    void scopedSqlOffersTheComponentPath() {
        String sql = LoreSlices.compose("questions", Map.of(), Set.of("NooriUta/UnlimitedLORE")).sql();
        assertTrue(sql.contains(VIA_COMPONENT + " CONTAINS :__scope0"), sql);
    }

    @Test
    void adminsSeeTheOutOfProjectLaneOthersDoNot() {
        assertTrue(AidaLoreResource.bypassesScope("admin", null), "admin видит полосу вне проектов");
        assertTrue(AidaLoreResource.bypassesScope("superadmin", null), "superadmin видит полосу вне проектов");
        assertFalse(AidaLoreResource.bypassesScope("viewer", null), "обычная роль — только свои проекты");
        assertFalse(AidaLoreResource.bypassesScope("admin", "lore-mcp-pm"), "агент не обходит скоуп никогда");
    }
}
