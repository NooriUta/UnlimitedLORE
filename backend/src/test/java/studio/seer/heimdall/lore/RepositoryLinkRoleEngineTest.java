package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import com.arcadedb.query.sql.executor.ResultSet;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-REPO-LINK-ROLE · связь «репозиторий → проект» с ролью.
 *
 * <p><b>Повод (23.11.2026):</b> {@code entity_link type=repository rel=project fields={"role":"primary"}} падал 502:
 * дверь собирала {@code CREATE EDGE … SET role = :role IF NOT EXISTS}, а в ArcadeDB {@code IF NOT EXISTS} стоит
 * ПЕРЕД {@code SET}. Без роли {@code SET} нет — вызов проходил, ребро рождалось с role = null. Второй дефект:
 * {@code IF NOT EXISTS} не трогает существующее ребро, поэтому повторная связь с ролью роль не проставляла.
 *
 * <p>Решение владелицы [[D-2026-LORE-PROJECT-SEVERAL-PRIMARY-REPOS]]: у проекта может быть несколько primary —
 * сторожа «один primary» нет, и тест это закрепляет.
 *
 * <p>Чистый JUnit на встроенном движке ArcadeDB (временная папка, без Quarkus и без общей базы): SQL двери
 * исполняется как есть, поэтому тест ловит грамматику, а не только смысл.
 */
class RepositoryLinkRoleEngineTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    static final String R1 = "https://git.example.org/ORG/one";
    static final String R2 = "https://git.example.org/ORG/two";

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-repo-link-role-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.getSchema().createVertexType("KnowGitProject");
        db.getSchema().createVertexType("KnowRepository");
        db.getSchema().createVertexType("LoreComponent");
        db.getSchema().createEdgeType("HAS_REPOSITORY");
        db.getSchema().createEdgeType("COMPONENT_REPOSITORY");
        db.getSchema().createEdgeType("USES_REPOSITORY");
        db.getSchema().createEdgeType("MIRRORED_TO");
        db.transaction(() -> {
            db.newVertex("KnowGitProject").set("slug", "ORG/proj").save();
            db.newVertex("KnowRepository").set("url", R1).save();
            db.newVertex("KnowRepository").set("url", R2).save();
        });
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private void exec(String sql, String url, String target, String role) {
        Map<String, Object> p = new HashMap<>();
        p.put("url", url);
        p.put("t", target);
        if (role != null) p.put("role", role);
        db.transaction(() -> db.command("sql", sql, p).close());
    }

    private List<Object> roles(String edge) {
        List<Object> out = new ArrayList<>();
        try (ResultSet rs = db.query("sql", "SELECT role FROM " + edge)) {
            while (rs.hasNext()) out.add(rs.next().getProperty("role"));
        }
        return out;
    }

    @Test
    void связь_с_ролью_пишется_одним_вызовом() {
        String sql = LoreRepositoryResource.createEdgeSql("HAS_REPOSITORY", "KnowGitProject", "slug", false, true);
        exec(sql, R1, "ORG/proj", "primary");
        assertEquals(List.of("primary"), roles("HAS_REPOSITORY"),
            "CREATE EDGE с ролью обязан и пройти грамматику ArcadeDB, и записать роль");
    }

    @Test
    void связь_без_роли_как_и_раньше_пишется_без_роли() {
        String sql = LoreRepositoryResource.createEdgeSql("HAS_REPOSITORY", "KnowGitProject", "slug", false, false);
        exec(sql, R1, "ORG/proj", null);
        assertEquals(1, roles("HAS_REPOSITORY").size());
        assertNull(roles("HAS_REPOSITORY").get(0));
    }

    @Test
    void повторная_связь_с_ролью_проставляет_роль_существующему_ребру() {
        exec(LoreRepositoryResource.createEdgeSql("HAS_REPOSITORY", "KnowGitProject", "slug", false, false),
            R1, "ORG/proj", null);
        exec(LoreRepositoryResource.setRoleSql("HAS_REPOSITORY", "slug", false), R1, "ORG/proj", "primary");
        assertEquals(List.of("primary"), roles("HAS_REPOSITORY"),
            "ребро, заведённое без роли, обязано получить роль, а не остаться null");
        exec(LoreRepositoryResource.setRoleSql("HAS_REPOSITORY", "slug", false), R1, "ORG/proj", "mirror");
        assertEquals(List.of("mirror"), roles("HAS_REPOSITORY"), "другая роль заменяет прежнюю");
    }

    @Test
    void смена_роли_трогает_только_свою_связь() {
        String create = LoreRepositoryResource.createEdgeSql("HAS_REPOSITORY", "KnowGitProject", "slug", false, true);
        exec(create, R1, "ORG/proj", "primary");
        exec(create, R2, "ORG/proj", "primary");
        exec(LoreRepositoryResource.setRoleSql("HAS_REPOSITORY", "slug", false), R2, "ORG/proj", "mirror");
        List<Object> r = roles("HAS_REPOSITORY");
        assertEquals(2, r.size());
        assertTrue(r.contains("primary") && r.contains("mirror"), "UPDATE ушёл не на ту связь: " + r);
    }

    @Test
    void у_проекта_может_быть_несколько_primary() {
        // D-2026-LORE-PROJECT-SEVERAL-PRIMARY-REPOS: сторожа «один primary на проект» нет.
        String create = LoreRepositoryResource.createEdgeSql("HAS_REPOSITORY", "KnowGitProject", "slug", false, true);
        exec(create, R1, "ORG/proj", "primary");
        exec(create, R2, "ORG/proj", "primary");
        assertEquals(List.of("primary", "primary"), roles("HAS_REPOSITORY"));
    }

    @Test
    void ребро_от_репозитория_с_ролью_тоже_проходит_грамматику() {
        exec(LoreRepositoryResource.createEdgeSql("MIRRORED_TO", "KnowRepository", "url", true, true), R1, R2, "mirror");
        assertEquals(List.of("mirror"), roles("MIRRORED_TO"));
        exec(LoreRepositoryResource.setRoleSql("MIRRORED_TO", "url", true), R1, R2, "primary");
        assertEquals(List.of("primary"), roles("MIRRORED_TO"));
    }

    @Test
    void решение_о_роли_существующей_связи() {
        assertFalse(LoreRepositoryResource.roleChanges(null, null), "роль не передана — существующую не трогаем");
        assertFalse(LoreRepositoryResource.roleChanges("primary", null), "роль не передана — не стираем имеющуюся");
        assertFalse(LoreRepositoryResource.roleChanges("primary", "primary"), "та же роль — без записи");
        assertTrue(LoreRepositoryResource.roleChanges(null, "primary"), "была без роли — проставить");
        assertTrue(LoreRepositoryResource.roleChanges("primary", "mirror"), "другая роль — заменить");
    }
}
