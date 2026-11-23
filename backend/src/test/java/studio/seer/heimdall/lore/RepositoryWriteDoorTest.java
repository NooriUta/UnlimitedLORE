package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Дверь записи реестра репозиториев (решение владелицы 22.11.2026, на вопрос «реестровые правки руками или
 * через дверь MCP»: «а что я, пусть доделывает MCP»).
 *
 * <p><b>Повод.</b> Сверка 22.11.2026 показала: 13 репозиториев Forgejo нет в реестре LORE вовсе, у четырёх
 * (TestPlayGround, forgejo-mcp, miniLoremobilekit, qwen-code-fork) проекта не видно ниоткуда, связей «использует»
 * нет ни одной. Починить это было НЕЧЕМ: вершины {@code KnowRepository} и их рёбра создавал только инструмент
 * переноса, то есть реестр чинился раз в миграцию, а между миграциями протухал.
 *
 * <p><b>Права — слово владелицы:</b> «репозиторий только админам, и кто заводит проекты; организацию только с
 * административными правами full и с подтверждением». Поэтому запись репозитория — {@code requireSuperAdmin},
 * как у проекта и организации; агенту без админской роли дверь закрыта.
 *
 * <p><b>Ключ записи — адрес</b> (D-2026-MIG-REPOSITORY-ORGANIZATION): {@code url} уникален у KnowRepository,
 * вид «https://хост/владелец/имя». Остальные поля вычисляются из него, чтобы в реестре не появилось записи,
 * чей {@code full_path} не сходится с адресом.
 */
class RepositoryWriteDoorTest {

    /** Рёбра реестра — те же, что читает срез repositories (LoreSlices.REPO_COLUMNS). */
    static final Map<String, String[]> RELS = Map.of(
        "project", new String[]{"HAS_REPOSITORY", "KnowGitProject", "slug"},
        "component", new String[]{"COMPONENT_REPOSITORY", "LoreComponent", "component_id"},
        "uses", new String[]{"USES_REPOSITORY", "KnowRepository", "url"},
        "mirror", new String[]{"MIRRORED_TO", "KnowRepository", "url"});

    @Test
    void разбор_адреса_даёт_хост_владельца_имя_и_полный_путь() {
        LoreRepositoryResource.RepoKey k = LoreRepositoryResource.parseUrl("https://git.example.org/ORG/repo-name");
        assertNotNull(k, "адрес вида https://хост/владелец/имя обязан разбираться");
        assertEquals("git.example.org", k.host());
        assertEquals("ORG", k.owner());
        assertEquals("repo-name", k.name());
        assertEquals("git.example.org/ORG/repo-name", k.fullPath(), "полный путь — без схемы, он же ключ показа");
    }

    @Test
    void адрес_без_владельца_или_имени_не_принимается() {
        for (String bad : List.of("https://git.example.org/repo", "https://git.example.org/", "git.example.org/a/b",
            "https://git.example.org/a/b/c", "ftp://git.example.org/a/b", "")) {
            assertNull(LoreRepositoryResource.parseUrl(bad), "не адрес репозитория: " + bad);
        }
    }

    @Test
    void хвостовой_слеш_и_git_в_конце_приводятся_к_одному_адресу() {
        LoreRepositoryResource.RepoKey a = LoreRepositoryResource.parseUrl("https://git.example.org/ORG/repo/");
        LoreRepositoryResource.RepoKey b = LoreRepositoryResource.parseUrl("https://git.example.org/ORG/repo.git");
        assertNotNull(a);
        assertNotNull(b);
        assertEquals("repo", a.name());
        assertEquals("repo", b.name(), "адрес для клонирования и адрес страницы — один репозиторий, а не два");
        assertEquals(a.url(), b.url(), "в реестре у них обязан быть ОДИН ключ, иначе появится двойник");
    }

    @Test
    void связи_реестра_те_же_рёбра_что_читает_срез() {
        for (Map.Entry<String, String[]> e : RELS.entrySet()) {
            List<String> t = LoreRepositoryResource.target(e.getKey());
            assertNotNull(t, "связь «" + e.getKey() + "» обязана быть известна двери");
            assertEquals(e.getValue()[0], t.get(0), e.getKey() + ": имя ребра");
            assertEquals(e.getValue()[1], t.get(1), e.getKey() + ": вершина цели");
            assertEquals(e.getValue()[2], t.get(2), e.getKey() + ": деловой ключ цели");
        }
        assertNull(LoreRepositoryResource.target("выдумка"), "неизвестная связь — отказ, а не тихое создание ребра");
    }

    @Test
    void у_связи_проект_репозиторий_есть_роль_основной_или_зеркало() {
        assertTrue(LoreRepositoryResource.validRole("primary"));
        assertTrue(LoreRepositoryResource.validRole("mirror"));
        assertFalse(LoreRepositoryResource.validRole("какая-то"), "роль ребра — только primary или mirror");
        assertTrue(LoreRepositoryResource.validRole(null), "роль не задана — ребро без роли, это допустимо");
    }

    @Test
    void репозиторий_сам_на_себя_не_ссылается() {
        assertFalse(LoreRepositoryResource.linkAllowed("uses",
            "https://git.example.org/A/b", "https://git.example.org/A/b"),
            "«использует сам себя» — не связь, а порча графа");
        assertTrue(LoreRepositoryResource.linkAllowed("uses",
            "https://git.example.org/A/b", "https://git.example.org/A/c"));
    }
}
