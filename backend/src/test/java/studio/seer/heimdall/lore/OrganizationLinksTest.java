package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * D-2026-MIG-REPOSITORY-ORGANIZATION, решение владелицы 19.11.2026: «организацию пока с проектами, продуктами и
 * людьми в админке связи и всё, и в админку её минимально».
 *
 * <p>Связи организации — рёбра от неё: {@code ORG_HAS_PROJECT} (→ проект), {@code ORG_HAS_PRODUCT} (→ продукт),
 * {@code ORG_MEMBER} (→ человек). В паспорте организации — вкладка «Связи» тремя группами, управляемыми; у проекта,
 * продукта и человека — связь «Организации» (только чтение). Путь записи — создание и привязка под super-admin
 * (как у проекта); связи читаются по ребру — на базе без этих рёбер паспорт проекта не ломается, вкладка честно
 * говорит «не смогли проверить».
 */
class OrganizationLinksTest {

    static final Map<String, String[]> EDGES = Map.of(
        "projects", new String[]{"ORG_HAS_PROJECT", "project"},
        "products", new String[]{"ORG_HAS_PRODUCT", "product"},
        "members", new String[]{"ORG_MEMBER", "user"});

    @Test
    void связи_организации_вкладкой_связи_тремя_группами_управляемые() {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get("organization");
        for (Map.Entry<String, String[]> e : EDGES.entrySet()) {
            LoreRecordRegistry.Relation r = d.relations().stream().filter(x -> x.key().equals(e.getKey())).findFirst().orElse(null);
            assertNotNull(r, "organization." + e.getKey());
            assertEquals(List.of(e.getValue()[0], "out", e.getValue()[1], "link_tab"), List.of(r.rel(), r.dir(), r.targetType(), r.place()));
            assertTrue(r.manageable(), e.getKey() + " — правится из паспорта");
            assertNotNull(LoreRecordRelationRoutes.find("organization", r.rel(), "out"), e.getKey() + ": нет пути привязки");
        }
        LoreRecordRegistry.LinkTab tab = d.linkTabs().stream().filter(t -> t.key().equals("links")).findFirst().orElseThrow();
        assertEquals(List.of("ORG_HAS_PROJECT", "ORG_HAS_PRODUCT", "ORG_MEMBER"), tab.rels().stream().map(LoreRecordRegistry.TabRel::rel).toList());
        assertEquals(java.util.Set.of("projects", "products", "members"), LoreRecordValues.readByEdge("organization"),
            "связи организации читаются по ребру");
    }

    @Test
    void у_проекта_продукта_человека_связь_организации_только_чтение() {
        Map<String, String> want = Map.of("project", "ORG_HAS_PROJECT", "product", "ORG_HAS_PRODUCT", "user", "ORG_MEMBER");
        for (Map.Entry<String, String> e : want.entrySet()) {
            LoreRecordRegistry.Relation r = LoreRecordRegistry.get(e.getKey()).relations().stream()
                .filter(x -> x.key().equals("organizations")).findFirst().orElse(null);
            assertNotNull(r, e.getKey() + ": нет связи «Организации»");
            assertEquals(List.of(e.getValue(), "in", "organization", "link_tab"), List.of(r.rel(), r.dir(), r.targetType(), r.place()));
            assertFalse(r.manageable(), e.getKey() + ": управление — из организации (админка)");
            assertTrue(LoreRecordValues.readByEdge(e.getKey()).contains("organizations"),
                e.getKey() + ": по ребру — без новой колонки в главном срезе (на старой схеме ребра нет)");
        }
    }

    @Test
    void организация_как_конец_ребра_названа_своим_кодом() {
        assertEquals("organization", LoreRecordEdgeLinks.kindOf("KnowOrganization", "SEIDR_STUDIO"));
        assertTrue(LoreRecordEdgeLinks.ID_FIELDS.contains("org_id"));
    }

    @Test
    void права_правка_и_создание_только_superadmin() {
        Map<String, Object> su = LoreRecordPerms.of("organization", "superadmin", true, null, 0);
        assertEquals(true, su.get("can_edit"));
        assertEquals(true, su.get("can_create"));
        assertEquals(false, su.get("can_status"));
        Map<String, Object> admin = LoreRecordPerms.of("organization", "admin", true, null, 0);
        assertEquals(false, admin.get("can_edit"), "как у создания проекта — super-admin, не admin");
        assertEquals(false, admin.get("can_create"));
        // положительный контроль: прежнее правило READ_ONLY с полем-путём записи (ранбук) — admin правит
        assertEquals(true, LoreRecordPerms.of("runbook", "admin", true, null, 0).get("can_edit"));
        assertEquals(false, LoreRecordPerms.of("runbook", "superadmin", true, null, 0).get("can_create"));
    }

    @Test
    void путь_создания_в_модели() {
        Map<String, Object> b = LoreModelCreate.block("organization");
        assertNotNull(b, "у организации нет блока create");
        assertEquals("/lore/organization", b.get("endpoint"));
        assertEquals("org_id", b.get("id_field"));
    }

    @Test
    void цели_привязки_и_рёбра_схемы_из_модели() {
        assertEquals(List.of("KnowGitProject", "slug"), LoreOrganizationResource.target("ORG_HAS_PROJECT"));
        assertEquals(List.of("KnowDictEntry", "code"), LoreOrganizationResource.target("ORG_HAS_PRODUCT"));
        assertEquals(List.of("KnowUser", "kc_sub"), LoreOrganizationResource.target("ORG_MEMBER"));
        assertNull(LoreOrganizationResource.target("BELONGS_TO_PROJECT"), "чужое ребро — не путь организации");
        for (String e : List.of("ORG_HAS_PROJECT", "ORG_HAS_PRODUCT", "ORG_MEMBER"))
            assertTrue(LoreModelConsistency.MODEL_SCHEMA_EDGES.containsKey(e), e);
    }
}
