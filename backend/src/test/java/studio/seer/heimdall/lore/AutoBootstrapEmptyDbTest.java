package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * decision:D-2026-LORE-AUTO-BOOTSTRAP-EMPTY-DB · SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE.
 *
 * <p>На чужой инсталляции LORE встал с битым продуктовым слоем: ядро схемы
 * поднимается только флагом lore.bootstrap, а про флаг знает лишь наш compose.
 * Теперь пустая база (нет ни одного ядрового типа) поднимает ядро сама; флаг
 * остаётся явным принуждением. На общем стенде типы есть — поведение прежнее.
 */
class AutoBootstrapEmptyDbTest {

    @Test
    void explicitFlagAlwaysBootstraps() {
        assertTrue(LoreSchemaInitializer.shouldBootstrap(true, true));
        assertTrue(LoreSchemaInitializer.shouldBootstrap(true, false));
        assertTrue(LoreSchemaInitializer.shouldBootstrap(true, null));
    }

    @Test
    void emptyDatabaseBootstrapsWithoutTheFlag() {
        assertTrue(LoreSchemaInitializer.shouldBootstrap(false, false),
            "ядровых типов нет — поднимаем без флага, иначе критерий «без ручной правки флагов» не выполняется");
    }

    @Test
    void initializedDatabaseIsLeftAlone() {
        assertFalse(LoreSchemaInitializer.shouldBootstrap(false, true),
            "общий стенд: типы есть — DDL на старте не гоняем, как и раньше");
    }

    @Test
    void unknownStateDoesNotBootstrap() {
        // Проба не ответила — это «не смогли проверить», а не «пусто».
        // Гнать DDL наудачу по недоступной базе нельзя: решит предохранитель старта.
        assertFalse(LoreSchemaInitializer.shouldBootstrap(false, null));
    }

    @Test
    void coreTypesAreReadFromTheProbeRows() {
        assertEquals(Boolean.TRUE, LoreSchemaInitializer.coreTypesPresent(
            List.of(Map.of("name", "KnowTask"), Map.of("name", "LoreBootProbe"))));
        assertEquals(Boolean.FALSE, LoreSchemaInitializer.coreTypesPresent(
            List.of(Map.of("name", "V"), Map.of("name", "E"))));
        assertEquals(Boolean.FALSE, LoreSchemaInitializer.coreTypesPresent(List.of()),
            "пустая база отвечает пустым списком типов");
        assertNull(LoreSchemaInitializer.coreTypesPresent("not a list"),
            "непонятный ответ — неизвестно, а не «пусто»");
        assertNull(LoreSchemaInitializer.coreTypesPresent(null));
    }
}
