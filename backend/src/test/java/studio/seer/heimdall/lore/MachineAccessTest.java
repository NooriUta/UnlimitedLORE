package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-ACL-1 · S7B-ACL-2 — допуск «человек → машина» (круг 2 прав машин).
 * Слова владелицы 11.11: «на машину может быть много человек допущено — как с проектами: один
 * владелец, он решает, кого пустить: показывать и взаимодействовать с диалогами, и по каким
 * проектам на своей машине». Чистый JUnit: модель, правила, срез, миграция.
 */
class MachineAccessTest {

    private static final String OWNER = "owner-sub";
    private static final String KID = "kid-sub";
    private static final List<String> ROLES = List.of("viewer", "actor");
    private static final List<String> HARNESSES = List.of("claude-code", "codex");

    private static MachineAccess.Grant grant(String sub, String role, List<String> projects, List<String> harnesses) {
        return new MachineAccess.Grant(sub, role, projects, harnesses);
    }

    // ── ACL-1: модель и миграция ───────────────────────────────────────────

    @Test
    void schemaStep80_isRegistered_additive_edgeWithScopeProperties() {
        var step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.sql() == MachineAccess.SCHEMA_SQL).findFirst()
            .orElseThrow(() -> new AssertionError("шага миграции с MachineAccess.SCHEMA_SQL нет"));
        assertEquals(80, step.version());
        assertEquals(17, step.compatMajor(), "аддитивно, major 17");
        assertTrue(LoreSchemaMigrations.STEPS.get(LoreSchemaMigrations.STEPS.size() - 1).version() >= 80,
            "V80 не позже последнего шага (V81 — S7B-ACT-1)");
        List<String> sql = MachineAccess.SCHEMA_SQL;
        assertTrue(sql.contains("CREATE EDGE TYPE MACHINE_ACCESS IF NOT EXISTS"));
        for (String p : List.of("role", "projects", "harnesses", "granted_by", "granted_at"))
            assertTrue(sql.stream().anyMatch(s -> s.startsWith("CREATE PROPERTY MACHINE_ACCESS." + p + " IF NOT EXISTS")), p);
        for (String ddl : sql) {
            String u = ddl.toUpperCase();
            assertFalse(u.startsWith("DROP") || u.startsWith("DELETE") || u.startsWith("ALTER"), ddl);
            assertTrue(u.contains("IF NOT EXISTS") || u.contains(" UPSERT WHERE "), "идемпотентно: " + ddl);
        }
    }

    @Test
    void roleDictionary_isSeeded_viewerAndActor_closedList() {
        String seed = String.join("\n", MachineAccess.SCHEMA_SQL);
        for (String code : List.of("viewer", "actor"))
            assertTrue(seed.contains("dict_type='machine_access_role', code='" + code + "'"), code);
        assertTrue(seed.contains("UPSERT WHERE dict_type='machine_access_role' AND code='actor'"));
        assertTrue(seed.contains("is_extensible=false"), "семантика ролей — в коде, новый код без правила бессмыслен");
        assertEquals(List.of("viewer", "actor"), MachineAccess.ROLES_FALLBACK);
        assertEquals("machine_access_role", MachineAccess.ROLE_DICT);
    }

    @Test
    void machineIsTheActorOfItsKcClient() {
        assertEquals("minilore-link-arharaga", MachineAccess.clientIdOf("arharaga"));
        assertEquals("minilore-link-", MachineAccess.PREFIX);
    }

    // ── ACL-2: правила видимости и взаимодействия ──────────────────────────

    @Test
    void ownerHasEverything_evenWithoutGrants() {
        var v = MachineAccess.check(OWNER, List.of(), OWNER, MachineAccess.Action.ACT, "AIDA/miniLORE", "dsh");
        assertTrue(v.allowed());
        assertEquals("owner", v.basis());
    }

    @Test
    void personWithoutGrant_isClosed_notEmpty() {
        var v = MachineAccess.check(OWNER, List.of(), KID, MachineAccess.Action.VIEW, "AIDA/miniLORE", null);
        assertFalse(v.allowed());
        assertEquals("closed", v.basis());
        assertNotNull(v.reason());
        assertTrue(v.reason().contains("допуска"), v.reason());
    }

    @Test
    void viewerSeesOwnProjects_butCannotAct() {
        var g = List.of(grant(KID, "viewer", List.of("AIDA/miniLORE"), List.of()));
        assertTrue(MachineAccess.check(OWNER, g, KID, MachineAccess.Action.VIEW, "AIDA/miniLORE", "claude-code").allowed());
        var act = MachineAccess.check(OWNER, g, KID, MachineAccess.Action.ACT, "AIDA/miniLORE", "claude-code");
        assertFalse(act.allowed());
        assertTrue(act.reason().contains("viewer"), act.reason());
    }

    @Test
    void actorSeesAndActs_withinScope() {
        var g = List.of(grant(KID, "actor", List.of("AIDA/miniLORE"), List.of()));
        assertTrue(MachineAccess.check(OWNER, g, KID, MachineAccess.Action.ACT, "AIDA/miniLORE", "codex").allowed());
        assertEquals("grant", MachineAccess.check(OWNER, g, KID, MachineAccess.Action.ACT, "AIDA/miniLORE", "codex").basis());
    }

    @Test
    void projectOutsideScope_isClosed() {
        var g = List.of(grant(KID, "actor", List.of("AIDA/miniLORE"), List.of()));
        var v = MachineAccess.check(OWNER, g, KID, MachineAccess.Action.VIEW, "NooriUta/UnlimitedLORE", null);
        assertFalse(v.allowed());
        assertTrue(v.reason().contains("NooriUta/UnlimitedLORE"), v.reason());
        assertFalse(MachineAccess.check(OWNER, g, KID, MachineAccess.Action.VIEW, null, null).allowed(),
            "диалог без проекта — не открыт допуском по проектам");
    }

    @Test
    void harnessScope_emptyMeansAll_listRestricts_unknownHarnessClosed() {
        var all = List.of(grant(KID, "viewer", List.of("P/x"), List.of()));
        assertTrue(MachineAccess.check(OWNER, all, KID, MachineAccess.Action.VIEW, "P/x", "dsh").allowed());
        assertTrue(MachineAccess.check(OWNER, all, KID, MachineAccess.Action.VIEW, "P/x", null).allowed());
        var only = List.of(grant(KID, "viewer", List.of("P/x"), List.of("claude-code")));
        assertTrue(MachineAccess.check(OWNER, only, KID, MachineAccess.Action.VIEW, "P/x", "claude-code").allowed());
        assertFalse(MachineAccess.check(OWNER, only, KID, MachineAccess.Action.VIEW, "P/x", "codex").allowed());
        assertFalse(MachineAccess.check(OWNER, only, KID, MachineAccess.Action.VIEW, "P/x", null).allowed(),
            "harness диалога неизвестен, а допуск им ограничен — закрыто");
    }

    @Test
    void machineWithoutOwner_isClosedForEveryone_noIdentityIsClosed() {
        var g = List.of(grant(KID, "actor", List.of("P/x"), List.of()));
        assertFalse(MachineAccess.check(null, g, KID, MachineAccess.Action.VIEW, "P/x", null).allowed(),
            "машина без владельца в графе — осиротевшая, допуски не действуют");
        assertFalse(MachineAccess.check(OWNER, g, null, MachineAccess.Action.VIEW, "P/x", null).allowed());
    }

    @Test
    void unknownRoleCode_grantsNothing() {
        var g = List.of(grant(KID, "superuser", List.of("P/x"), List.of()));
        assertFalse(MachineAccess.check(OWNER, g, KID, MachineAccess.Action.VIEW, "P/x", null).allowed());
    }

    // ── запись: кто решает ─────────────────────────────────────────────────

    @Test
    void writeRefusal_ownerOrAdminOnly_agentNever() {
        assertNull(MachineAccess.writeRefusal(null, "viewer", OWNER, OWNER, "m1"), "владелец машины решает сам");
        assertNull(MachineAccess.writeRefusal(null, "admin", "someone", OWNER, "m1"));
        assertNull(MachineAccess.writeRefusal(null, "superadmin", null, OWNER, "m1"));
        String stranger = MachineAccess.writeRefusal(null, "editor", KID, OWNER, "m1");
        assertNotNull(stranger);
        assertTrue(stranger.contains("владелец"), stranger);
        assertNotNull(MachineAccess.writeRefusal("full", "admin", null, OWNER, "m1"),
            "агент не выдаёт допуск даже с ролью admin — против self-эскалации");
        assertNotNull(MachineAccess.writeRefusal(null, "editor", KID, null, "m1"),
            "у машины без владельца выдаёт только admin");
        assertNotNull(MachineAccess.writeRefusal(null, null, null, OWNER, "m1"));
    }

    // ── запись: проверка запроса ───────────────────────────────────────────

    private static MachineAccess.Request req(String action, String role, List<String> projects, List<String> harnesses) {
        return new MachineAccess.Request("arharaga", KID, null, action, role, projects, harnesses);
    }

    @Test
    void requestError_validGrant_passes() {
        assertNull(MachineAccess.requestError(req(null, "viewer", List.of("AIDA/miniLORE"), null), ROLES, HARNESSES));
        assertNull(MachineAccess.requestError(req("grant", "actor", List.of("AIDA/miniLORE"), List.of("codex")), ROLES, HARNESSES));
        assertNull(MachineAccess.requestError(req("revoke", null, null, null), ROLES, HARNESSES));
    }

    @Test
    void requestError_refusesBadInput() {
        assertNotNull(MachineAccess.requestError(null, ROLES, HARNESSES));
        assertNotNull(MachineAccess.requestError(new MachineAccess.Request(null, KID, null, null, "viewer", List.of("P/x"), null), ROLES, HARNESSES));
        assertNotNull(MachineAccess.requestError(new MachineAccess.Request("a/b", KID, null, null, "viewer", List.of("P/x"), null), ROLES, HARNESSES),
            "machine_id — имя, не путь");
        assertNotNull(MachineAccess.requestError(new MachineAccess.Request("m", " ", null, null, "viewer", List.of("P/x"), null), ROLES, HARNESSES));
        assertNotNull(MachineAccess.requestError(req("drop", "viewer", List.of("P/x"), null), ROLES, HARNESSES));
        String role = MachineAccess.requestError(req(null, "admin", List.of("P/x"), null), ROLES, HARNESSES);
        assertNotNull(role);
        assertTrue(role.contains("machine_access_role"), "отказ называет словарь: " + role);
        assertNotNull(MachineAccess.requestError(req(null, null, List.of("P/x"), null), ROLES, HARNESSES));
        assertNotNull(MachineAccess.requestError(req(null, "viewer", List.of(), null), ROLES, HARNESSES),
            "scope по проектам обязателен — пустой допуск ничего не открывает");
        assertNotNull(MachineAccess.requestError(req(null, "viewer", Arrays.asList("P/x", null), null), ROLES, HARNESSES));
        String h = MachineAccess.requestError(req(null, "viewer", List.of("P/x"), List.of("kimi")), ROLES, HARNESSES);
        assertNotNull(h);
        assertTrue(h.contains("harness"), h);
        assertNotNull(MachineAccess.requestError(req(null, "ghost", List.of("P/x"), null), List.of("viewer", "ghost"), HARNESSES),
            "код словаря без правила в коде — отказ, а не молчаливое «ничего не даёт»");
    }

    // ── план «было → станет» (dry_run) ─────────────────────────────────────

    @Test
    void plan_grantUpdateUnchangedRevoke() {
        var newGrant = MachineAccess.plan(null, req(null, "viewer", List.of("P/x", "P/x", "P/y"), null));
        assertEquals("grant", newGrant.get("kind"));
        assertNull(newGrant.get("before"));
        @SuppressWarnings("unchecked") Map<String, Object> after = (Map<String, Object>) newGrant.get("after");
        assertEquals(List.of("P/x", "P/y"), after.get("projects"), "дубли схлопнуты, порядок сохранён");
        assertEquals(List.of(), after.get("harnesses"), "пусто = все harness");

        var cur = grant(KID, "viewer", List.of("P/x", "P/y"), List.of());
        assertEquals("unchanged", MachineAccess.plan(cur, req(null, "viewer", List.of("P/y", "P/x"), List.of())).get("kind"),
            "порядок проектов — не правка");
        assertEquals("update", MachineAccess.plan(cur, req(null, "actor", List.of("P/x", "P/y"), null)).get("kind"));
        assertEquals("revoke", MachineAccess.plan(cur, req("revoke", null, null, null)).get("kind"));
        assertEquals("unchanged", MachineAccess.plan(null, req("revoke", null, null, null)).get("kind"),
            "снимать нечего — законный повтор");
    }

    @Test
    void ownerCannotBeGrantedToOwnMachine() {
        assertNotNull(MachineAccess.selfGrantRefusal(OWNER, OWNER));
        assertNull(MachineAccess.selfGrantRefusal(KID, OWNER));
    }

    // ── срез machine_acl ───────────────────────────────────────────────────

    @Test
    void slice_isRegistered_readsEdges_filtersByMachineAndPerson_andIsClassified() {
        String sql = LoreSlices.compose("machine_acl", Map.of()).sql();
        assertTrue(sql.contains("FROM KnowActor"), sql);
        assertTrue(sql.contains("client_id LIKE 'minilore-link-%'"), "машина — актор своей учётки KC: " + sql);
        assertTrue(sql.contains("out('OWNED_BY').kc_sub AS owner_kc_sub"), sql);
        for (String col : List.of("grant_kc_subs", "grant_roles", "grant_projects", "grant_harnesses",
                "grant_granted_by", "grant_granted_at"))
            assertTrue(sql.contains(" AS " + col), col + ": " + sql);
        String byMachine = LoreSlices.compose("machine_acl", Map.of("client_id", "minilore-link-arharaga")).sql();
        assertTrue(byMachine.contains("client_id = :client_id"), byMachine);
        String byPerson = LoreSlices.compose("machine_acl", Map.of("kc_sub", KID)).sql();
        assertTrue(byPerson.contains("in('MACHINE_ACCESS').kc_sub CONTAINS :kc_sub"), byPerson);
        assertTrue(byPerson.contains("out('OWNED_BY').kc_sub CONTAINS :kc_sub"), "своя машина тоже в выдаче: " + byPerson);
        assertTrue(LoreSlices.SHARED_SLICES.containsKey("machine_acl"), "классифицирован (ScopeCoverageGuardTest)");
    }

    @Test
    void sliceRow_parsesIntoOwnerAndGrants_parallelArrays() {
        Map<String, Object> row = Map.of(
            "client_id", "minilore-link-arharaga",
            "owner_kc_sub", List.of(OWNER),
            "grant_kc_subs", List.of(KID, "wife-sub"),
            "grant_roles", List.of("viewer", "actor"),
            "grant_projects", List.of(List.of("P/x"), List.of("P/x", "P/y")),
            "grant_harnesses", Arrays.asList(List.of(), null));
        assertEquals(OWNER, MachineAccess.ownerOf(row));
        var grants = MachineAccess.grantsOf(row);
        assertEquals(2, grants.size());
        assertEquals(grant(KID, "viewer", List.of("P/x"), List.of()), grants.get(0));
        assertEquals(grant("wife-sub", "actor", List.of("P/x", "P/y"), List.of()), grants.get(1),
            "harnesses null — то же, что пусто: все");
        assertNull(MachineAccess.ownerOf(Map.of("owner_kc_sub", List.of())));
    }
}
