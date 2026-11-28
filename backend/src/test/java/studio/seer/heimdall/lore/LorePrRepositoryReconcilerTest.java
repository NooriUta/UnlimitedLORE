package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Новые PR получают PR_OF сверщиком, а не правкой каждого места записи KnowPR (их пять): ребро ставится тем,
 * у кого его нет и чей адрес сопоставим с KnowRepository; несопоставимые не трогаются.
 */
class LorePrRepositoryReconcilerTest {

    static final String F = "https://git.example.org/AIDA/";

    @Test
    void ставит_ребро_только_недостающим_и_сопоставимым() {
        List<String> created = new ArrayList<>();
        int n = LorePrRepositoryReconciler.sync((sql, p) -> {
            if (sql.equals(LoreReleaseRepositoryResource.PRS_SQL)) return List.of(
                Map.of("pr_uid", "A#1", "url", F + "UnlimitedLORE/pulls/1"),
                Map.of("pr_uid", "A#2", "url", F + "UnlimitedLORE/pulls/2"),
                Map.of("pr_uid", "A#3", "url", F + "Unknown/pulls/3"));
            if (sql.equals(LoreReleaseRepositoryResource.REPO_URLS_SQL)) return List.of(Map.of("url", F + "UnlimitedLORE"));
            if (sql.equals(LoreReleaseRepositoryResource.EXISTING_PR_SQL)) return List.of(Map.of("u", "A#1", "r", F + "UnlimitedLORE"));
            return List.of();
        }, (uid, repo) -> created.add(uid + "→" + repo));
        assertEquals(1, n);
        assertEquals(List.of("A#2→" + F + "UnlimitedLORE"), created);
    }

    @Test
    void сбой_одной_записи_не_останавливает_остальные() {
        List<String> created = new ArrayList<>();
        int n = LorePrRepositoryReconciler.sync((sql, p) -> {
            if (sql.equals(LoreReleaseRepositoryResource.PRS_SQL)) return List.of(
                Map.of("pr_uid", "A#1", "url", F + "X/pulls/1"), Map.of("pr_uid", "A#2", "url", F + "X/pulls/2"));
            if (sql.equals(LoreReleaseRepositoryResource.REPO_URLS_SQL)) return List.of(Map.of("url", F + "X"));
            return List.of();
        }, (uid, repo) -> { if (uid.equals("A#1")) throw new IllegalStateException("сбой"); created.add(uid); });
        assertEquals(1, n);
        assertEquals(List.of("A#2"), created);
    }

    @Test
    void выключается_настройкой() {
        assertTrue(LorePrRepositoryReconciler.enabled(k -> Optional.empty()));
        assertFalse(LorePrRepositoryReconciler.enabled(k -> Optional.of("false")));
    }
}
