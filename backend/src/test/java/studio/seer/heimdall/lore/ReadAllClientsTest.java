package studio.seer.heimdall.lore;

import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PROJECT_SCOPE/AL-91 — служебный читатель всего корпуса.
 *
 * <p>Владелица 06.11: «вдруг я поменяю суперадмина» — видимость miniLORE не должна
 * держаться на одном человеке (вариант «читатель от лица владельца» снят); выбор
 * отдан шлюзу miniLORE («пусть решает»), он выбрал «служебный читатель всего»
 * с условием: «признак „читает всё“ не должен расширять права. Только чтение».
 *
 * <p>Исключение из скоупа — ровно для перечисленных client_id, точным
 * совпадением (не префиксом: сторож по имени уже однажды ослеп — см.
 * LoreKcResource.hasServiceAccount). Действует только в callerAllowedProjects —
 * пути ЧТЕНИЯ; запись идёт через allowedProjectsForAgent и AgentScopeFilter и
 * этим списком не расширяется.
 */
class ReadAllClientsTest {

    @Test
    void listedClientReadsTheWholeCorpus() {
        assertTrue(AidaLoreResource.readsWholeCorpus("lore-reader-minilore", "lore-reader-minilore"));
        assertTrue(AidaLoreResource.readsWholeCorpus("b", "a, b ,c"));
    }

    @Test
    void exactMatchOnlyNoPrefixNoSubstring() {
        assertFalse(AidaLoreResource.readsWholeCorpus("lore-reader-minilore-2", "lore-reader-minilore"));
        assertFalse(AidaLoreResource.readsWholeCorpus("lore-reader", "lore-reader-minilore"));
        assertFalse(AidaLoreResource.readsWholeCorpus("lore-mcp-full", "lore-reader-minilore"));
    }

    @Test
    void noClientOrEmptyListReadsNothingExtra() {
        assertFalse(AidaLoreResource.readsWholeCorpus(null, "lore-reader-minilore"));
        assertFalse(AidaLoreResource.readsWholeCorpus("lore-reader-minilore", ""));
        assertFalse(AidaLoreResource.readsWholeCorpus("lore-reader-minilore", null));
        assertFalse(AidaLoreResource.readsWholeCorpus("", " , "));
    }

    @Test
    void defaultIsExactlyTheMiniLoreReader() throws Exception {
        var f = AidaLoreResource.class.getDeclaredField("readAllClients");
        var cp = f.getAnnotation(ConfigProperty.class);
        assertEquals("lore.scope.read-all-clients", cp.name());
        assertEquals("lore-reader-minilore", cp.defaultValue(),
            "исключение — одна учётка, решение 06.11; расширять список — отдельным решением");
    }
}
