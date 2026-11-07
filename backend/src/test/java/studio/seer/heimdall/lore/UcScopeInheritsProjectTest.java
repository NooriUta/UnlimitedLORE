package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-08 — правило, а не кейс FEAT-VP-FIT.
 *
 * <p>Проект у некорневого сценария НАСЛЕДУЕТСЯ по DECOMPOSES_INTO (своего ребра
 * BELONGS_TO_PROJECT у детей нет — второй источник правды запрещён). Значит
 * read-скоуп любого среза по KnowUseCase, где в строках бывают НЕ только корни,
 * обязан пускать и по предкам — иначе при включённом скоупе дети пропадают,
 * а счётчик корня в {@code features} продолжает их считать.
 *
 * <p>Срезы только по корням ({@code features}, {@code feature_vp_analytics} —
 * {@code goal_level IN ['cloud','kite']}) правилом не обязаны: у корня ребро своё.
 */
class UcScopeInheritsProjectTest {

    static final String PARENT = "in('DECOMPOSES_INTO').out('BELONGS_TO_PROJECT').slug";
    static final String GRANDPARENT = "in('DECOMPOSES_INTO').in('DECOMPOSES_INTO').out('BELONGS_TO_PROJECT').slug";
    /** Шкала Коберна — 4 уровня (cloud → kite → sea-level → subfunction): до корня максимум 3 шага. */
    static final String GREAT = "in('DECOMPOSES_INTO').in('DECOMPOSES_INTO').in('DECOMPOSES_INTO').out('BELONGS_TO_PROJECT').slug";

    /** Срезы по KnowUseCase, чьи строки — и некорневые сценарии. */
    static final List<String> NON_ROOT_UC_SLICES =
        List.of("use_cases_of_feature", "uc_by_id", "use_cases_of_component", "shipped_dynamics");

    @Test
    void срезыПоСценариямПускаютПоПроектуПредка() {
        List<String> broken = new ArrayList<>();
        for (String id : NON_ROOT_UC_SLICES) {
            String scope = LoreSlices.PROJECT_SCOPED.get(id);
            List<String> paths = scope == null ? List.of() : List.of(scope.split("\\|"));
            if (!paths.contains("out('BELONGS_TO_PROJECT').slug")
                || !paths.contains(PARENT) || !paths.contains(GRANDPARENT) || !paths.contains(GREAT)) {
                broken.add(id + " → " + scope);
            }
        }
        assertEquals(List.of(), broken,
            "скоуп среза по сценариям не наследует проект от корня — дети без своего ребра отсекаются (S1-08)");
    }

    @Test
    void наследованиеДоходитДоSQL() {
        var c = LoreSlices.compose("use_cases_of_feature", java.util.Map.of("id", "FEAT-X"), Set.of("org/a"));
        assertTrue(c.sql().contains(PARENT + " CONTAINS") || c.sql().contains(PARENT),
            "путь через родителя не попал в SQL: " + c.sql());
    }
}
