package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.LoreReleaseRepositoryMigration.Pr;
import studio.seer.heimdall.lore.LoreReleaseRepositoryMigration.PrPlan;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * ADR-LORE-066 фаза А, PR_OF: репозиторий PR однозначен из его адреса (…/owner/repo/pulls/N).
 * Связь не выдумывается: адрес без /pulls/ или репозиторий, которого нет в LORE, — в отчёт, не в план.
 */
class LorePrRepositoryPlanTest {

    static final String F = "https://git.example.org/AIDA/";
    static final List<String> REPOS = List.of(F + "UnlimitedLORE", F + "miniLORE.git", "https://github.com/NooriUta/seidr-site/");

    @Test
    void адрес_PR_даёт_репозиторий_до_pulls() {
        assertEquals(F + "UnlimitedLORE", LoreReleaseRepositoryMigration.repoUrlOfPr(F + "UnlimitedLORE/pulls/1917"));
        assertEquals("https://github.com/NooriUta/seidr-site", LoreReleaseRepositoryMigration.repoUrlOfPr("https://github.com/NooriUta/seidr-site/pull/5"));
        assertNull(LoreReleaseRepositoryMigration.repoUrlOfPr(F + "UnlimitedLORE"));
        assertNull(LoreReleaseRepositoryMigration.repoUrlOfPr(null));
        assertNull(LoreReleaseRepositoryMigration.repoUrlOfPr("  "));
    }

    @Test
    void план_ставит_ребро_к_известному_репозиторию_с_нормализацией_url() {
        PrPlan p = LoreReleaseRepositoryMigration.planPrs(List.of(
            new Pr("NooriUta/UnlimitedLORE#1917", F + "UnlimitedLORE/pulls/1917"),
            new Pr("AIDA/miniLORE#12", F + "miniLORE/pulls/12/"),
            new Pr("NooriUta/seidr-site#5", "https://github.com/NooriUta/seidr-site/pull/5")), REPOS, Set.of());
        assertEquals(3, p.items().size());
        // url — ровно как ключ KnowRepository.url (с .git и хвостом как есть), иначе CREATE EDGE не найдёт вершину
        assertEquals(F + "miniLORE.git", p.items().stream().filter(i -> i.uid().equals("AIDA/miniLORE#12")).findFirst().orElseThrow().repo());
        assertEquals("https://github.com/NooriUta/seidr-site/", p.items().get(2).repo());
        assertTrue(p.unresolved().isEmpty());
        assertEquals(3, p.toCreate());
    }

    @Test
    void неизвестный_репозиторий_и_адрес_без_pulls_уходят_в_отчёт() {
        PrPlan p = LoreReleaseRepositoryMigration.planPrs(List.of(
            new Pr("X/Y#1", F + "Unknown/pulls/1"),
            new Pr("X/Y#2", null),
            new Pr("X/Y#3", F + "UnlimitedLORE/commit/abc")), REPOS, Set.of());
        assertTrue(p.items().isEmpty());
        assertEquals(3, p.unresolved().size());
        assertEquals("репозитория нет в LORE", p.unresolved().get(0).get("reason"));
        assertEquals("у PR нет адреса", p.unresolved().get(1).get("reason"));
        assertEquals("адрес PR без /pulls/", p.unresolved().get(2).get("reason"));
    }

    @Test
    void стоящее_ребро_не_создаётся_заново() {
        PrPlan p = LoreReleaseRepositoryMigration.planPrs(List.of(new Pr("NooriUta/UnlimitedLORE#1", F + "UnlimitedLORE/pulls/1")),
            REPOS, Set.of("NooriUta/UnlimitedLORE#1|" + F + "UnlimitedLORE"));
        assertTrue(p.items().get(0).exists());
        assertEquals(0, p.toCreate());
        Map<String, Object> m = p.toMap();
        assertEquals(1, m.get("prs_resolved"));
        assertEquals(0, m.get("prs_to_create"));
        assertEquals(0, m.get("prs_unresolved_count"));
    }
}
