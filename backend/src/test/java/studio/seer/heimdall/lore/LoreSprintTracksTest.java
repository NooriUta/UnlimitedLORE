package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24: трек спринта — ссылка на вершину PlanTrack. Выбор
 * в паспорте идёт из среза track_options, а запись track_id через /lore/sprint/plan принимает
 * только существующий трек: опечатка раньше молча писалась в план, и спринт выпадал из дорожки.
 */
class LoreSprintTracksTest {

    @Test
    void sliceListsPlanTracksAsCodeAndTitleWithoutParams() {
        LoreSlices.SliceDef def = LoreSlices.get(LoreSprintTracks.SLICE);
        assertNotNull(def, "срез треков для выпадающего списка зарегистрирован");
        assertTrue(def.required().isEmpty(), "общий список — без обязательных параметров");
        String sql = def.baseSql();
        assertTrue(sql.contains("FROM PlanTrack"), "строки — вершины PlanTrack: " + sql);
        assertTrue(sql.contains("track_id AS code"), "value = track_id (то, что пишется в спринт): " + sql);
        assertTrue(sql.contains("AS title"), "label = подпись трека: " + sql);
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey(LoreSprintTracks.SLICE),
            "скоуп — как у plan_tracks (план: общий или проектный — решение владелицы)");
    }

    @Test
    void checkOnlyWhenTrackIsActuallySet() {
        assertFalse(LoreSprintTracks.needsCheck(null), "поле не передано — не трогаем");
        assertFalse(LoreSprintTracks.needsCheck(""), "пусто — снятие трека, проверять нечего");
        assertFalse(LoreSprintTracks.needsCheck("  "), "пробелы — то же снятие");
        assertTrue(LoreSprintTracks.needsCheck("TRK_CORE"));
    }

    @Test
    void unknownTrackIsRefusedWithReason() {
        LoreResourceBase.LoreError e = LoreSprintTracks.refusal("TRK_TYPO", List.of());
        assertNotNull(e, "трека нет — отказ, а не молчаливая запись");
        assertEquals("TRACK_NOT_FOUND", e.error());
        assertTrue(e.detail().contains("TRK_TYPO"), "в причине — что именно не нашлось: " + e.detail());
        assertTrue(e.detail().contains(LoreSprintTracks.SLICE), "в причине — откуда брать треки: " + e.detail());
        assertNotNull(LoreSprintTracks.refusal("TRK_TYPO", null), "нет ответа — тоже не «нашли»");
    }

    @Test
    void existingTrackPasses() {
        assertNull(LoreSprintTracks.refusal("TRK_CORE", List.of(Map.of("track_id", "TRK_CORE"))));
    }

    @Test
    void existsQueryIsByExactTrackId() {
        assertTrue(LoreSprintTracks.EXISTS_SQL.contains("FROM PlanTrack"));
        assertTrue(LoreSprintTracks.EXISTS_SQL.contains("track_id = :track_id"), LoreSprintTracks.EXISTS_SQL);
    }

    /** Проверка подключена к записи плана спринта — до чтения и записи версии. */
    @Test
    void sprintPlanWriteUsesTheCheck() throws Exception {
        String src = Files.readString(Path.of(
            "src/main/java/studio/seer/heimdall/lore/LoreStatusResource.java"));
        int handler = src.indexOf("public Uni<Response> updateSprintPlan(");
        assertTrue(handler > 0, "обработчик /lore/sprint/plan найден");
        int end = src.indexOf("private Uni<Response> checkTaskDoneGate", handler);
        String body = src.substring(handler, end);
        assertTrue(body.contains("LoreSprintTracks.needsCheck("), "запись трека проверяется");
        assertTrue(body.contains("LoreSprintTracks.EXISTS_SQL"), "по вершинам PlanTrack");
        assertTrue(body.contains("LoreSprintTracks.refusal("), "отказ с причиной");
    }
}
