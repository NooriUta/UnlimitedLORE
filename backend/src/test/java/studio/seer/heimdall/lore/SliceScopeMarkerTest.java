package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PROJECT_SCOPE/AL-91 — условие шлюза miniLORE (06.11.2026): «вне
 * скоупа — явный отказ (403 или поле с причиной), а не 200 с пустым телом.
 * Пустое тело у меня неотличимо от „человек ни в чём не состоит“».
 *
 * <p>До правки построчный скоуп молча выкидывал строки: ответ 200, строк меньше,
 * признака нет. Теперь скоупный срез несёт {@code scope}, а пустое множество
 * разрешённых проектов — отказ, а не пустой список.
 */
class SliceScopeMarkerTest {

    @Test
    void scopedSliceSaysSo() {
        Map<String, Object> m = AidaLoreResource.scopeMeta("sprints", Set.of("org/a", "org/b"));
        assertNotNull(m);
        assertEquals(true, m.get("applied"));
        assertEquals(2, m.get("projects"));
    }

    @Test
    void noMarkerWithoutScope() {
        assertNull(AidaLoreResource.scopeMeta("sprints", null), "скоуп выключен или superadmin");
        assertNull(AidaLoreResource.scopeMeta("user_project_roles", Set.of("org/a")),
            "срез вне PROJECT_SCOPED скоупом не режется — и признака нет");
    }

    @Test
    void emptyScopeIsADenialNotAnEmptyList() {
        assertTrue(AidaLoreResource.scopeDenies("sprints", Set.of()));
        assertFalse(AidaLoreResource.scopeDenies("sprints", Set.of("org/a")));
        assertFalse(AidaLoreResource.scopeDenies("sprints", null));
        assertFalse(AidaLoreResource.scopeDenies("project_users", Set.of()), "срез не скоупный");
    }
}
