package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.LoreReleaseRepositoryMigration.Plan;
import studio.seer.heimdall.lore.LoreReleaseRepositoryMigration.Release;
import studio.seer.heimdall.lore.LoreReleaseRepositoryMigration.Remote;
import studio.seer.heimdall.lore.LoreReleaseRepositoryMigration.Repo;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** ADR-LORE-066 фаза А: чей релиз — по Forgejo, префикс — запасной путь, связь не выдумывается. */
class LoreReleaseRepositoryMigrationTest {

    static final String F = "https://git.seidrstudio.pro/AIDA/";
    static final String SITE = F + "seidr-site", CORE = F + "core-services", ML = F + "miniLORE", MLS = F + "miniLore_serverside";

    static final List<Repo> REPOS = List.of(
        new Repo(SITE, "AIDA/seidr-site", true, null),
        new Repo(CORE, "AIDA/core-services", true, null),
        new Repo(ML, "AIDA/miniLORE", true, null),
        new Repo(MLS, "AIDA/miniLore_serverside", true, null),
        new Repo("https://github.com/NooriUta/seidr-site", "NooriUta/seidr-site", false, SITE));

    static final Map<String, List<String>> PROJECTS = Map.of(
        "AIDA/core-services", List.of(CORE, SITE),
        "AIDA/miniLORE", List.of(ML, MLS));

    static Map<String, Remote> remote() {
        Map<String, Remote> m = new HashMap<>();
        m.put(SITE, new Remote(Set.of("v1.0.0", "v1.1.0", "v1.1.1", "v1.4.0"), Set.of("v1.0.0", "v1.1.0", "v1.1.1", "v1.4.0")));
        m.put(CORE, new Remote(Set.of(), Set.of()));
        m.put(ML, new Remote(Set.of("v1.16.0", "v0.6.3x"), Set.of("v1.16.0")));
        m.put(MLS, new Remote(Set.of("v0.6.3"), Set.of()));
        return m;
    }

    static Map<String, Object> item(Plan p, String uid) {
        return p.items().stream().filter(i -> i.uid().equals(uid)).findFirst().orElseThrow().toMap();
    }

    @Test
    void релиз_сайта_с_Release_в_Forgejo_уходит_в_репозиторий_сайта_а_не_в_проект() {
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("NooriUta/seidr-site#v1.4.0", "v1.4.0", "v1.4.0", "2026-06-29", List.of("AIDA/core-services"))),
            REPOS, PROJECTS, remote(), Set.of());
        Map<String, Object> it = item(p, "NooriUta/seidr-site#v1.4.0");
        assertEquals(SITE, it.get("repository"));
        assertEquals("forgejo_release", it.get("basis"));
        assertEquals(true, it.get("forgejo_release"));
    }

    @Test
    void без_тега_решает_префикс_через_зеркало_GitHub_и_релиз_помечен_неоформленным() {
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("NooriUta/seidr-site#v1.4.3", "v1.4.3", null, "2026-06-30", List.of("AIDA/core-services"))),
            REPOS, PROJECTS, remote(), Set.of());
        Map<String, Object> it = item(p, "NooriUta/seidr-site#v1.4.3");
        assertEquals(SITE, it.get("repository"));
        assertEquals("uid_prefix", it.get("basis"));
        assertEquals(false, it.get("forgejo_release"));
    }

    @Test
    void в_проекте_с_несколькими_репозиториями_решает_тег_git_tag_раньше_release_id() {
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("AIDA/miniLORE#minilore-srv-v0.6.3", "minilore-srv-v0.6.3", "v0.6.3", "2026-11-27", List.of("AIDA/miniLORE"))),
            REPOS, PROJECTS, remote(), Set.of());
        Map<String, Object> it = item(p, "AIDA/miniLORE#minilore-srv-v0.6.3");
        assertEquals(MLS, it.get("repository"));
        assertEquals("forgejo_tag", it.get("basis"));
    }

    @Test
    void префикс_проекта_не_репозитория_и_тега_нигде_нет_в_отчёт_а_не_ребро() {
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("AIDA/miniLORE#v9.9.9", "v9.9.9", null, null, List.of("AIDA/miniLORE"))),
            List.of(new Repo(ML, "AIDA/miniLORE-app", true, null), new Repo(MLS, "AIDA/miniLore_serverside", true, null)),
            PROJECTS, remote(), Set.of());
        assertTrue(p.items().isEmpty());
        assertEquals(1, p.unresolved().size());
    }

    @Test
    void тег_в_двух_репозиториях_без_префикса_неоднозначен() {
        Map<String, Remote> rm = remote();
        rm.put(MLS, new Remote(Set.of("v1.16.0"), Set.of("v1.16.0")));
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("X/other#v1.16.0", "v1.16.0", "v1.16.0", null, List.of("AIDA/miniLORE"))),
            REPOS, PROJECTS, rm, Set.of());
        assertTrue(p.items().isEmpty());
        assertEquals(1, p.ambiguous().size());
    }

    @Test
    void Release_в_Forgejo_без_записи_в_LORE_находка_v1_1_1() {
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("NooriUta/seidr-site#v1.0.0", "v1.0.0", "v1.0.0", null, List.of("AIDA/core-services")),
                    new Release("NooriUta/seidr-site#v1.1.0", "v1.1.0", "v1.1.0", null, List.of("AIDA/core-services")),
                    new Release("NooriUta/seidr-site#v1.4.0", "v1.4.0", "v1.4.0", null, List.of("AIDA/core-services"))),
            REPOS, PROJECTS, remote(), Set.of());
        List<Map<String, Object>> miss = p.missingInLore().stream().filter(m -> SITE.equals(m.get("repository"))).toList();
        assertEquals(List.of("v1.1.1"), miss.stream().map(m -> m.get("tag")).toList());
    }

    @Test
    void репозиторий_без_ответа_Forgejo_не_пустой_а_не_проверенный() {
        Map<String, Remote> rm = remote();
        rm.put(MLS, null);
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("AIDA/miniLORE#minilore-srv-v0.6.3", "minilore-srv-v0.6.3", "v0.6.3", null, List.of("AIDA/miniLORE"))),
            List.of(new Repo(ML, "AIDA/miniLORE-app", true, null), new Repo(MLS, "AIDA/miniLore_serverside", true, null)),
            PROJECTS, rm, Set.of());
        assertTrue(p.items().isEmpty());
        assertEquals(1, p.unchecked().size());
        assertTrue(p.uncheckedRepos().contains(MLS));
    }

    @Test
    void стоящее_ребро_не_создаётся_повторно() {
        Plan p = LoreReleaseRepositoryMigration.plan(
            List.of(new Release("NooriUta/seidr-site#v1.4.0", "v1.4.0", "v1.4.0", null, List.of())),
            REPOS, PROJECTS, remote(), Set.of("NooriUta/seidr-site#v1.4.0|" + SITE));
        assertEquals(0, p.toCreate());
        assertEquals(1, p.items().size());
    }
}
