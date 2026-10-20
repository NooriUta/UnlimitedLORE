package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_SLICE_ERGONOMICS/SE-18, пункт 3: «текущий» релиз проекта — тот,
 * чей тег стоит в репозитории последним. Поле git_tag может опережать факт
 * (план несёт имя тега заранее), поэтому истина — список тегов репозитория,
 * а не поле. Релиз узнаётся по git_tag, а если поле пусто — по release_id,
 * совпадающему с тегом (v1.12.0 заведён без git_tag).
 */
class ReleaseCurrentReconcilerTest {

    private static LoreReleaseCurrentReconciler.Rel rel(String id, String tag) {
        return new LoreReleaseCurrentReconciler.Rel(id, tag);
    }

    @Test
    void newestRepoTagThatHasAReleaseWins() {
        // v1.11.161 вырезан, но записи релиза ещё нет — его пропускаем, текущим становится 160.
        assertEquals(Optional.of("v1.11.160"), LoreReleaseCurrentReconciler.pickCurrent(
            List.of("v1.11.161", "v1.11.160", "v1.11.159"),
            List.of(rel("minilore-1.11.151", "v1.11.151"), rel("v1.11.159", "v1.11.159"), rel("v1.11.160", "v1.11.160"))));
    }

    @Test
    void releaseWithEmptyTagFieldIsRecognisedByItsId() {
        assertEquals(Optional.of("v1.12.0"), LoreReleaseCurrentReconciler.pickCurrent(
            List.of("v1.12.0", "v1.11.2"),
            List.of(rel("v1.11.2", "v1.11.2"), rel("v1.12.0", null), rel("v1.12.1", null))));
    }

    @Test
    void plannedReleaseWhoseTagIsNotInTheRepoNeverWins() {
        // v1.12.1 несёт имя тега заранее, а тега в репозитории нет.
        assertEquals(Optional.of("v1.11.2"), LoreReleaseCurrentReconciler.pickCurrent(
            List.of("v1.11.2"),
            List.of(rel("v1.11.2", "v1.11.2"), rel("v1.12.1", "v1.12.1"))));
    }

    @Test
    void noMatchMeansNoChangeRatherThanClearing() {
        assertEquals(Optional.empty(), LoreReleaseCurrentReconciler.pickCurrent(
            List.of("sjon-v0.3.0"), List.of(rel("midgard-8099-2026-09-22", null))));
        assertEquals(Optional.empty(), LoreReleaseCurrentReconciler.pickCurrent(List.of(), List.of(rel("v1", "v1"))));
    }

    @Test
    void tagListParsingKeepsRepositoryOrder() {
        assertEquals(List.of("v2", "v1"), LoreReleaseCurrentReconciler.tagNames(
            "[{\"name\":\"v2\",\"commit\":{}},{\"name\":\"v1\"}]"));
        assertEquals(List.of(), LoreReleaseCurrentReconciler.tagNames("[]"));
    }

    @Test
    void reconcilerIsOnByDefaultButCanBeSwitchedOff() {
        assertEquals(true, LoreReleaseCurrentReconciler.enabled(k -> Optional.empty()));
        assertEquals(false, LoreReleaseCurrentReconciler.enabled(
            k -> Optional.ofNullable(Map.of("lore.release.current-sync.enabled", "false").get(k))));
    }
}
