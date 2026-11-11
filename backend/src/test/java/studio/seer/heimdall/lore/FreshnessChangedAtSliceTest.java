package studio.seer.heimdall.lore;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04):
 * каждый срез, которым web-next строит раздел-список, отдаёт {@code changed_at}
 * — время последнего изменения записи. Поведение на движке проверяет
 * {@link FreshnessChangedAtLiveDbTest}; здесь — сторож без базы, чтобы колонка
 * не потерялась при правке SQL среза и в прогоне без живой БД.
 */
class FreshnessChangedAtSliceTest {

    @ParameterizedTest
    @ValueSource(strings = {
        "open_tasks", "closed_tasks", "specs", "adrs", "decisions", "use_cases", "sprints", "questions", "releases", "components"})
    void sectionSliceCarriesChangedAt(String id) {
        LoreSlices.SliceDef def = LoreSlices.get(id);
        assertNotNull(def, id);
        assertTrue(def.baseSql().contains(" AS changed_at"), id + ": нет колонки changed_at");
    }
}
