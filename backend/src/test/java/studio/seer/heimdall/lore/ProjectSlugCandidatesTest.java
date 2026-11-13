package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, пункт A13: слуг проекта исторический (NooriUta/volva при
 * репозитории AIDA/volva), и неверный слуг давал noop без подсказки — три вызова там, где нужен один.
 * Правило общее для всех привязок к проекту: noop из-за незарегистрированного слуга называет
 * ближайших кандидатов реестра в том же ответе.
 */
class ProjectSlugCandidatesTest {

    static final List<String> REGISTRY = List.of("NooriUta/volva", "NooriUta/AIDA", "NooriUta/UnlimitedLORE", "AIDA/miniLORE");

    @Test
    void shortNameAndForeignOwnerFindTheRegisteredSlug() {
        assertEquals(List.of("NooriUta/volva"), LoreResourceBase.slugCandidates("volva", REGISTRY));
        assertEquals(List.of("NooriUta/volva"), LoreResourceBase.slugCandidates("AIDA/volva", REGISTRY));
        assertEquals(List.of("NooriUta/volva"), LoreResourceBase.slugCandidates("Volva", REGISTRY), "регистр не важен");
    }

    @Test
    void partOfNameFindsCandidatesButUnrelatedFindsNothing() {
        assertEquals(List.of("NooriUta/UnlimitedLORE"), LoreResourceBase.slugCandidates("unlimited", REGISTRY));
        assertEquals(List.of(), LoreResourceBase.slugCandidates("frigg", REGISTRY));
    }

    @Test
    void noopOnUnknownSlugCarriesCandidates() {
        Map<String, Object> out = LoreResourceBase.withSlugCandidates(
            new java.util.LinkedHashMap<>(Map.of("outcome", LoreOutcome.NOOP)), "AIDA/volva", REGISTRY);
        assertEquals(List.of("NooriUta/volva"), out.get("project_candidates"));
        assertTrue(String.valueOf(out.get("hint")).contains("NooriUta/volva"), String.valueOf(out.get("hint")));
    }

    /** Положительный контроль: слуг есть в реестре — значит, не нашёлся другой конец, кандидаты слуга не нужны. */
    @Test
    void registeredSlugGetsNoCandidates() {
        Map<String, Object> out = LoreResourceBase.withSlugCandidates(
            new java.util.LinkedHashMap<>(Map.of("outcome", LoreOutcome.NOOP)), "NooriUta/volva", REGISTRY);
        assertFalse(out.containsKey("project_candidates"));
    }
}
