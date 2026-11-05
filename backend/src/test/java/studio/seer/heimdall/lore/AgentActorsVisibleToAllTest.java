package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * SPRINT_LORE_PROJECT_SCOPE/AL-106. Решение владельца 04.11.2026
 * (D-2026-LORE-OWNER-ANSWERS-20261104, №4): при включённом проектном скоупе
 * акторы-агенты видны ВСЕМ — «пока; после апробирования можем поменять».
 *
 * <p>Своего ребра проекта у агента нет и быть не должно, поэтому включение
 * {@code actors} в {@link LoreSlices#PROJECT_SCOPED} спрятало бы всех агентов от
 * всех, кроме superadmin. Тест фиксирует решение: если его пересмотрят, правка
 * должна быть явной (вместе с этим тестом), а не побочным эффектом расширения
 * скоупа на «все слайсы».
 */
class AgentActorsVisibleToAllTest {

    @Test
    void слайсАкторовНеРежетсяПроектнымСкоупом() {
        assertFalse(LoreSlices.PROJECT_SCOPED.containsKey("actors"),
            "AL-106: агенты видны всем при включённом скоупе (решение владельца 04.11.2026)");
    }

    @Test
    void сРазрешённымиПроектамиЗапросАкторовНеМеняется() {
        var scoped = LoreSlices.compose("actors", Map.of(), Set.of("NooriUta/UnlimitedLORE"));
        var plain  = LoreSlices.compose("actors", Map.of());
        assertEquals(plain.sql(), scoped.sql(), "скоуп не должен дописывать фильтр в actors");
    }
}
