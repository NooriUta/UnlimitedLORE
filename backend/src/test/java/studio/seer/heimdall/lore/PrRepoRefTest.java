package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Привязка PR к задаче, когда PR живёт в репозитории проекта, а не в репозитории-тёзке проекта.
 * Повод (27.11.2026, сессия miniLORE): SPRINT_MINILORE_LINK_PIPE/LP-31 ← AIDA/miniLore_serverside#209 —
 * 400 «git project not registered»: дверь task/pr знала только KnowGitProject.slug, а
 * AIDA/miniLore_serverside — зарегистрированный репозиторий (KnowRepository) проекта AIDA/miniLORE.
 * Общее правило: «owner/repo» принимается, если это slug проекта ИЛИ full_path репозитория из реестра.
 */
class PrRepoRefTest {

    /** Строка как в реестре: full_path — с хостом, owner/name — отдельно. */
    private static Map<String, Object> repo(String ownerRepo, String url, Object projects) {
        String[] p = ownerRepo.split("/");
        return Map.of("owner", p[0], "name", p[1], "full_path", "git.seidrstudio.pro/" + ownerRepo, "url", url, "projects", projects);
    }

    @Test
    void параметрыЗапроса_изOwnerRepo() {
        assertEquals(Map.of("o", "aida", "n", "minilore_serverside"), PrRepoRef.repoParams("AIDA/miniLore_serverside"));
        assertNull(PrRepoRef.repoParams("git.seidrstudio.pro/AIDA/x"));
        assertNull(PrRepoRef.repoParams("nope"));
    }

    @Test
    void slugПроекта_принимаетсяКакРаньше() {
        PrRepoRef.Resolved r = PrRepoRef.resolve("NooriUta/UnlimitedLORE", true, List.of(), 7);
        assertEquals("NooriUta/UnlimitedLORE", r.hostProject());
        assertNull(r.prUrl(), "путь проекта — данные PR тянет мост по своему hosts[]");
    }

    @Test
    void репозиторийПроекта_принимается_иАдресPrИзАдресаРепозитория() {
        PrRepoRef.Resolved r = PrRepoRef.resolve("AIDA/miniLore_serverside", false,
            List.of(repo("AIDA/miniLore_serverside", "https://git.seidrstudio.pro/AIDA/miniLore_serverside", List.of("AIDA/miniLORE"))),
            209);
        assertEquals("AIDA/miniLORE", r.hostProject(), "данные PR тянутся через проект репозитория");
        assertEquals("https://git.seidrstudio.pro/AIDA/miniLore_serverside/pulls/209", r.prUrl());
    }

    @Test
    void регистрБезразличен_иАдресСGitНаКонце() {
        PrRepoRef.Resolved r = PrRepoRef.resolve("aida/minilore_serverside", false,
            List.of(repo("AIDA/miniLore_serverside", "https://git.seidrstudio.pro/AIDA/miniLore_serverside.git", "AIDA/miniLORE")),
            3);
        assertEquals("AIDA/miniLORE", r.hostProject());
        assertEquals("https://git.seidrstudio.pro/AIDA/miniLore_serverside/pulls/3", r.prUrl());
    }

    @Test
    void дотяжка_черезПроект_поАдресуPrРепозитория() throws Exception {
        String[] seen = new String[2];
        PrBackfill.GitHost base = (gp, n, url) -> { seen[0] = gp; seen[1] = url; return PrBackfill.Fetch.skip("X", "y"); };
        PrRepoRef.Resolved owner = new PrRepoRef.Resolved("AIDA/miniLORE", "https://git.seidrstudio.pro/AIDA/miniLore_serverside/pulls/209");
        PrRepoRef.viaProject(base, owner).fetch("AIDA/miniLore_serverside", 209, null);
        assertEquals("AIDA/miniLORE", seen[0], "хосты — проекта");
        assertEquals("https://git.seidrstudio.pro/AIDA/miniLore_serverside/pulls/209", seen[1], "путь — из адреса PR репозитория");
    }

    @Test
    void нетНиПроектаНиРепозитория_отказ() {
        assertNull(PrRepoRef.resolve("ghost/repo", false, List.of(), 1));
    }

    @Test
    void репозиторийБезПроекта_принимается_безДотяжки() {
        PrRepoRef.Resolved r = PrRepoRef.resolve("AIDA/orphan", false,
            List.of(repo("AIDA/orphan", "https://git.seidrstudio.pro/AIDA/orphan", List.of())), 5);
        assertNull(r.hostProject(), "проекта нет — дотягивать данные PR не через что, связь всё равно ставится");
        assertEquals("https://git.seidrstudio.pro/AIDA/orphan/pulls/5", r.prUrl());
    }
}
