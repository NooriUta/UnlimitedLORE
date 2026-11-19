package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * D-2026-MIG-REPOSITORY-ORGANIZATION · прототип «Репозитории и организации» (docs/prototypes/mig-repos-orgs.html)
 * принят владелицей 19.11.2026: «ок делаем пока так».
 *
 * <p>Репозиторий — отдельный объект (хост, владелец на хосте, имя, полный путь; ключ — адрес url). У проекта —
 * основной репозиторий ребром {@code HAS_REPOSITORY role=primary}, у компонента — свой ({@code COMPONENT_REPOSITORY}),
 * зеркало ({@code MIRRORED_TO}) и «использует» ({@code USES_REPOSITORY}) — связи между репозиториями.
 * Организация {@code KnowOrganization {org_id, name}} — самостоятельный объект, пока пустой.
 *
 * <p>До этого теста срезы были (RepositorySlicesTest), а паспорта и разделов не было: тип не заведён в модели,
 * у фасада нет источника, у проекта и компонента нет вкладки «Репозитории».
 */
class RepositoryOrganizationPassportTest {

    @Test
    void обаТипа_паспорта_только_чтение_проект_последним() {
        for (String t : List.of("repository", "organization")) {
            assertTrue(LoreRecordRegistry.TYPES.contains(t), t + ": нет паспорта v2");
            assertTrue(LoreRecordRegistry.READ_ONLY.contains(t), t + ": путей записи у фасада нет — только чтение");
        }
        assertEquals("project", LoreRecordRegistry.TYPES.get(LoreRecordRegistry.TYPES.size() - 1), "проект — последним");
    }

    @Test
    void источник_одна_строка_по_ключу() {
        Map<String, String[]> want = Map.of(
            "repository", new String[]{"repo_by_id", "FROM KnowRepository", "KnowRepository", "url"},
            "organization", new String[]{"org_by_id", "FROM KnowOrganization", "KnowOrganization", "org_id"});
        for (Map.Entry<String, String[]> e : want.entrySet()) {
            LoreRecordResource.Source s = LoreRecordResource.sourceOf(e.getKey());
            assertNotNull(s, e.getKey() + ": нет главного среза");
            assertEquals(e.getValue()[0], s.slice());
            LoreSlices.SliceDef d = LoreSlices.get(s.slice());
            assertNotNull(d, s.slice() + " не зарегистрирован");
            assertEquals(List.of(s.param()), d.required());
            assertTrue(d.baseSql().contains(e.getValue()[1]), d.baseSql());
            LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(e.getKey());
            assertNotNull(g, e.getKey() + ": нет вершины в модели");
            assertEquals(e.getValue()[2], g.vertex());
            assertEquals(e.getValue()[3], g.key());
            assertNull(g.hist(), e.getKey() + ": истории SCD2 нет");
        }
        assertTrue(LoreSlices.get("org_by_id").baseSql().contains("WHERE org_id = :id"));
    }

    /** Ключ репозитория — адрес: «https://…» с двоеточием проходит проверку ключа, мусор — нет. */
    @Test
    void ключ_репозитория_адрес() {
        assertTrue(LoreRecordResource.idAllowed("repository", "https://git.seidrstudio.pro/AIDA/UnlimitedLORE"));
        assertTrue(LoreRecordResource.idAllowed("repository", "https://github.com/NooriUta/UnlimitedLORE.git"));
        assertFalse(LoreRecordResource.idAllowed("repository", "https://h/a b"), "пробел — нет");
        assertFalse(LoreRecordResource.idAllowed("repository", "x' OR 1=1"), "кавычка — нет");
        assertFalse(LoreRecordResource.idAllowed("task", "https://h/a"), "двоеточие — только у репозитория");
        assertTrue(LoreRecordResource.idAllowed("organization", "SEIDR_STUDIO"));
    }

    @Test
    void значения_паспорта_репозитория_из_строки_среза() {
        Map<String, Object> row = new HashMap<>();
        row.put("url", "https://git.seidrstudio.pro/AIDA/UnlimitedLORE");
        row.put("full_path", "git.seidrstudio.pro/AIDA/UnlimitedLORE");
        row.put("host", "git.seidrstudio.pro");
        row.put("owner", "AIDA");
        row.put("name", "UnlimitedLORE");
        row.put("default_branch", "develop");
        Map<String, Object> v = LoreRecordValues.values("repository", row);
        assertEquals("UnlimitedLORE", v.get("title"));
        assertEquals("git.seidrstudio.pro/AIDA/UnlimitedLORE", v.get("full_path"));
        assertEquals("git.seidrstudio.pro", v.get("host"));
        assertEquals("AIDA", v.get("owner"));
        assertEquals("develop", v.get("default_branch"));
        assertEquals("https://git.seidrstudio.pro/AIDA/UnlimitedLORE", v.get("url"));
        row.remove("name");
        assertEquals("git.seidrstudio.pro/AIDA/UnlimitedLORE", LoreRecordValues.values("repository", row).get("title"), "без имени — полный путь");
    }

    /** Связи прототипа: основной у проекта, компонент, зеркало в обе стороны, «использует» в обе стороны. */
    @Test
    void связи_репозитория_из_строки() {
        Map<String, Object> row = new HashMap<>();
        row.put("projects", List.of("AIDA/UnlimitedLORE"));
        row.put("components", List.of("FORGEJO_MCP"));
        row.put("mirrors", List.of("https://github.com/NooriUta/UnlimitedLORE"));
        row.put("mirror_of", List.of());
        row.put("uses", List.of("https://git.seidrstudio.pro/AIDA/kit"));
        row.put("used_by", List.of());
        List<String> got = LoreRecordValues.rowLinks("repository", row).stream()
            .map(m -> m.get("rel") + ":" + m.get("dir") + ":" + m.get("type") + ":" + m.get("id")).toList();
        assertEquals(List.of(
            "HAS_REPOSITORY:in:project:AIDA/UnlimitedLORE",
            "COMPONENT_REPOSITORY:in:component:FORGEJO_MCP",
            "MIRRORED_TO:out:repository:https://github.com/NooriUta/UnlimitedLORE",
            "USES_REPOSITORY:out:repository:https://git.seidrstudio.pro/AIDA/kit"), got);
        for (String k : List.of("projects", "components", "mirrors", "mirrorOf", "uses", "usedBy"))
            assertTrue(LoreRecordRegistry.get("repository").relations().stream().anyMatch(r -> r.key().equals(k) && "link_tab".equals(r.place())),
                "repository." + k + " — связь вкладкой");
    }

    /** У проекта и у компонента — вкладка «Репозитории» отдельным срезом. */
    @Test
    void вкладка_репозитории_у_проекта_и_компонента() {
        Map<String, String[]> want = Map.of(
            "project", new String[]{"repos_of_project", "project", "HAS_REPOSITORY"},
            "component", new String[]{"repos_of_component", "id", "COMPONENT_REPOSITORY"});
        for (Map.Entry<String, String[]> e : want.entrySet()) {
            LoreRecordFrom.SliceLink sl = LoreRecordFrom.sliceLinkDef(e.getKey(), "repositories");
            assertNotNull(sl, e.getKey() + ": нет вкладки repositories");
            assertEquals(e.getValue()[0], sl.slice());
            assertEquals(e.getValue()[1], sl.param());
            assertEquals(e.getValue()[2], sl.rel());
            assertEquals("out", sl.dir());
            assertEquals("repository", sl.type());
            LoreRecordRegistry.Relation r = LoreRecordRegistry.get(e.getKey()).relations().stream()
                .filter(x -> x.key().equals("repositories")).findFirst().orElse(null);
            assertNotNull(r, e.getKey() + ": связь repositories не объявлена в модели");
            assertEquals(List.of(e.getValue()[2], "out", "repository", "link_tab"), List.of(r.rel(), r.dir(), r.targetType(), r.place()));
            Map<String, Object> link = LoreRecordFrom.sliceLink(sl, Map.of(
                "url", "https://git.seidrstudio.pro/AIDA/GLADSHEIM", "full_path", "git.seidrstudio.pro/AIDA/GLADSHEIM"));
            assertEquals("https://git.seidrstudio.pro/AIDA/GLADSHEIM", link.get("id"));
            assertEquals("git.seidrstudio.pro/AIDA/GLADSHEIM", link.get("title"));
        }
    }

    @Test
    void организация_код_и_название() {
        Map<String, Object> v = LoreRecordValues.values("organization", Map.of("org_id", "SEIDR_STUDIO", "name", "Seiðr Studio"));
        assertEquals("Seiðr Studio", v.get("title"));
        assertEquals("SEIDR_STUDIO", v.get("code"));
        assertEquals("SEIDR_STUDIO", LoreRecordValues.values("organization", Map.of("org_id", "SEIDR_STUDIO")).get("title"));
    }

    /** Оба раздела — в группе «Система» (проекты, компоненты, технологии), видны всем. */
    @Test
    void разделы_в_группе_система() {
        List<String> nav = LoreModelNavTest.navSections(LoreModelGoldenTest.modelDoc());
        for (String t : List.of("repository", "organization")) {
            assertTrue(nav.contains(t), "раздела " + t + " нет в меню: " + nav);
            assertEquals("everywhere", LoreModelFile.content().audience().get(t));
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> groups = (List<Map<String, Object>>)
            ((Map<String, Object>) LoreModelGoldenTest.modelDoc().get("surfaces")).get("nav");
        Map<String, Object> system = groups.stream().filter(g -> "system".equals(g.get("id"))).findFirst().orElseThrow();
        String items = String.valueOf(system.get("items"));
        assertTrue(items.contains("repository") && items.contains("organization"), items);
    }
}
