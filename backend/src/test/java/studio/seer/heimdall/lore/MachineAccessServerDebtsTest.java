package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-ACL-3 — серверные долги экрана «Доступ к машинам»: срез machine_acl
 * отдаёт проекты, harness и право записи машины (раньше клиент собирал их сам), запись
 * допусков — пачкой с batch_id и отменой undo_of. Чистый JUnit.
 */
class MachineAccessServerDebtsTest {

    private static final String OWNER = "owner-sub";
    private static final String KID = "kid-sub";

    // ── can_write: одно правило с проверкой записи ─────────────────────────

    @Test
    void canManage_ownerOrAdmin_agentNever() {
        assertTrue(MachineAccess.canManage(null, "viewer", OWNER, OWNER));
        assertTrue(MachineAccess.canManage(null, "admin", KID, OWNER));
        assertTrue(MachineAccess.canManage(null, "superadmin", null, null));
        assertFalse(MachineAccess.canManage(null, "editor", KID, OWNER));
        assertFalse(MachineAccess.canManage("full", "admin", OWNER, OWNER), "агент — никогда");
        assertFalse(MachineAccess.canManage(null, "editor", KID, null), "без владельца — только admin");
        assertFalse(MachineAccess.canManage(null, null, null, OWNER));
    }

    @Test
    void canManage_isTheSameRuleAsWriteRefusal_onEveryCombination() {
        List<String> scopes = Arrays.asList(null, "full");
        List<String> roles = Arrays.asList(null, "viewer", "editor", "admin", "superadmin");
        List<String> subs = Arrays.asList(null, OWNER, KID);
        List<String> owners = Arrays.asList(null, "", OWNER);
        for (String s : scopes) for (String r : roles) for (String c : subs) for (String o : owners)
            assertEquals(MachineAccess.writeRefusal(s, r, c, o, "m1") == null, MachineAccess.canManage(s, r, c, o),
                "scope=" + s + " role=" + r + " caller=" + c + " owner=" + o);
    }

    // ── обогащение строки среза ───────────────────────────────────────────

    private static Map<String, Object> row(String clientId, String actorId, String owner, List<List<String>> grantProjects) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("actor_id", actorId);
        r.put("client_id", clientId);
        r.put("machine_id", null);
        r.put("owner_kc_sub", owner == null ? List.of() : List.of(owner));
        List<String> subs = new ArrayList<>();
        for (int i = 0; i < grantProjects.size(); i++) subs.add("g" + i);
        r.put("grant_kc_subs", subs);
        r.put("grant_projects", grantProjects);
        return r;
    }

    private static Map<String, Object> agent(String actorId, String clientId, String machineId, String harness, List<String> machines) {
        Map<String, Object> a = new HashMap<>();
        a.put("actor_id", actorId);
        a.put("client_id", clientId);
        a.put("machine_id", machineId);
        a.put("harness", harness);
        a.put("machines", machines);
        return a;
    }

    @Test
    void enrich_projectsAreOwnerRoleProjectsPlusGrantedProjects_sortedDistinct() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(
            row("minilore-link-m1", "A-m1", OWNER, List.of(List.of("P/z", "P/a"), List.of("P/a")))));
        MachineAccess.enrichAcl(rows, Map.of(OWNER, List.of("P/b", "P/a")), List.of(), null);
        assertEquals(List.of("P/a", "P/b", "P/z"), rows.get(0).get("projects"));
    }

    @Test
    void enrich_ownerWithoutRoles_keepsGrantedProjects_orphanMachineToo() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(
            row("minilore-link-m1", "A-m1", OWNER, List.of(List.of("P/x"))),
            row("minilore-link-m2", "A-m2", null, List.of())));
        MachineAccess.enrichAcl(rows, Map.of(), List.of(), null);
        assertEquals(List.of("P/x"), rows.get(0).get("projects"));
        assertEquals(List.of(), rows.get(1).get("projects"), "проверено: проектов нет — пустой список, не отсутствие");
    }

    @Test
    void enrich_harnessesOfAgentsBoundToTheMachine() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(row("minilore-link-m1", "A-m1", OWNER, List.of())));
        List<Map<String, Object>> agents = List.of(
            agent("A-m1", "minilore-link-m1", null, "claude-code", List.of()),      // сам актор-машина
            agent("A-other", "minilore-link-m1", null, "codex", List.of()),          // тот же client_id
            agent("A-3", "agent-x", "m1", "gemini", List.of()),                      // последний раз писал с m1
            agent("A-4", "agent-y", "m9", "cursor", List.of("m9", "m1")),            // USES_MACHINE → m1
            agent("A-5", "agent-z", "m9", "aider", List.of("m9")),                   // чужая машина
            agent("A-6", "agent-w", "m1", null, List.of()),                          // без harness
            agent("A-7", "agent-v", "m1", "codex", List.of()));                      // дубль
        MachineAccess.enrichAcl(rows, Map.of(), agents, null);
        assertEquals(List.of("claude-code", "codex", "cursor", "gemini"), rows.get(0).get("harnesses"));
    }

    @Test
    void enrich_contextNotRead_fieldsAbsent_notEmpty() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(row("minilore-link-m1", "A-m1", OWNER, List.of(List.of("P/x")))));
        MachineAccess.enrichAcl(rows, null, null, null);
        assertFalse(rows.get(0).containsKey("projects"), "роли владельца не прочитаны — поля нет, клиент соберёт сам");
        assertFalse(rows.get(0).containsKey("harnesses"), "агенты не прочитаны — поля нет");
    }

    @Test
    void enrich_canWrite_trueFalse_andNullWhenCallerUnknown() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(
            row("minilore-link-m1", "A-m1", OWNER, List.of()),
            row("minilore-link-m2", "A-m2", KID, List.of()),
            row("minilore-link-m3", "A-m3", null, List.of())));
        MachineAccess.enrichAcl(rows, Map.of(), List.of(), new MachineAccess.Caller(null, "editor", OWNER));
        assertEquals(Boolean.TRUE, rows.get(0).get("can_write"), "владелец");
        assertEquals(Boolean.FALSE, rows.get(1).get("can_write"), "чужая машина");
        assertEquals(Boolean.FALSE, rows.get(2).get("can_write"), "без владельца — только admin");

        MachineAccess.enrichAcl(rows, Map.of(), List.of(), new MachineAccess.Caller(null, "admin", null));
        assertEquals(Boolean.TRUE, rows.get(1).get("can_write"));
        assertEquals(Boolean.TRUE, rows.get(2).get("can_write"));

        MachineAccess.enrichAcl(rows, Map.of(), List.of(), null);
        for (Map<String, Object> r : rows) {
            assertTrue(r.containsKey("can_write"), "ключ есть всегда");
            assertNull(r.get("can_write"), "права не вычислены — null, а не false");
        }
    }

    @Test
    void enrich_doesNotRenameOrDropExistingKeys() {
        Map<String, Object> r = row("minilore-link-m1", "A-m1", OWNER, List.of(List.of("P/x")));
        List<String> before = new ArrayList<>(r.keySet());
        List<Map<String, Object>> rows = new ArrayList<>(List.of(r));
        MachineAccess.enrichAcl(rows, Map.of(), List.of(), null);
        assertTrue(rows.get(0).keySet().containsAll(before), "контракт только расширяется");
        assertEquals(List.of(OWNER), rows.get(0).get("owner_kc_sub"));
    }

    @Test
    void ownerSubs_ofRows_forTheRolesQuery() {
        List<Map<String, Object>> rows = List.of(
            row("minilore-link-m1", "A-m1", OWNER, List.of()),
            row("minilore-link-m2", "A-m2", OWNER, List.of()),
            row("minilore-link-m3", "A-m3", null, List.of()),
            row("minilore-link-m4", "A-m4", KID, List.of()));
        assertEquals(List.of(OWNER, KID), MachineAccess.ownerSubs(rows));
    }

    @Test
    void projectsBySub_fromTheRolesQueryRows() {
        Map<String, Object> a = new HashMap<>();
        a.put("kc_sub", OWNER);
        a.put("projects", List.of("P/a", "P/b"));
        Map<String, Object> b = new HashMap<>();
        b.put("kc_sub", KID);
        b.put("projects", null);
        Map<String, Object> junk = new HashMap<>();
        junk.put("kc_sub", null);
        Map<String, List<String>> m = MachineAccess.projectsBySub(List.of(a, b, junk));
        assertEquals(List.of("P/a", "P/b"), m.get(OWNER));
        assertEquals(List.of(), m.get(KID), "ролей нет — пустой список: прочитано");
        assertEquals(2, m.size());
    }

    // ── пачка ──────────────────────────────────────────────────────────────

    private static MachineAccess.Request req(String sub, String action, String role, List<String> projects) {
        return new MachineAccess.Request("m1", sub, null, action, role, projects, List.of());
    }

    @Test
    void batchError_emptyTooManyDuplicates() {
        assertNotNull(MachineAccess.batchError(null));
        assertNotNull(MachineAccess.batchError(List.of()));
        List<MachineAccess.Request> many = new ArrayList<>();
        for (int i = 0; i <= MachineAccess.BATCH_MAX; i++) many.add(req("s" + i, "revoke", null, null));
        assertNotNull(MachineAccess.batchError(many));
        String dup = MachineAccess.batchError(List.of(req(KID, "revoke", null, null), req(KID, "grant", "viewer", List.of("P/x"))));
        assertNotNull(dup);
        assertTrue(dup.contains(KID), "дубль назван: " + dup);
        assertNull(MachineAccess.batchError(List.of(req(KID, "revoke", null, null), req("other", "grant", "viewer", List.of("P/x")))));
    }

    @Test
    void undoItem_restoresBefore_orRevokesNewGrant_unchangedSkipped() {
        MachineAccess.Grant before = new MachineAccess.Grant(KID, "viewer", List.of("P/x"), List.of("codex"));
        MachineAccess.Request up = req(KID, "grant", "actor", List.of("P/x", "P/y"));
        Map<String, Object> undoUpdate = MachineAccess.undoItem(MachineAccess.plan(before, up), up);
        assertEquals("grant", undoUpdate.get("action"));
        assertEquals("viewer", undoUpdate.get("role"));
        assertEquals(List.of("P/x"), undoUpdate.get("projects"));
        assertEquals(List.of("codex"), undoUpdate.get("harnesses"));
        assertEquals(KID, undoUpdate.get("kc_sub"));

        MachineAccess.Request fresh = req("new-sub", "grant", "viewer", List.of("P/x"));
        Map<String, Object> undoGrant = MachineAccess.undoItem(MachineAccess.plan(null, fresh), fresh);
        assertEquals("revoke", undoGrant.get("action"));
        assertEquals("new-sub", undoGrant.get("kc_sub"));

        MachineAccess.Request rev = req(KID, "revoke", null, null);
        Map<String, Object> undoRevoke = MachineAccess.undoItem(MachineAccess.plan(before, rev), rev);
        assertEquals("grant", undoRevoke.get("action"));
        assertEquals("viewer", undoRevoke.get("role"));

        assertNull(MachineAccess.undoItem(MachineAccess.plan(null, rev), rev), "ничего не менялось — откатывать нечего");
    }

    @Test
    void batchId_andUndoWindow_sameAsRoleBatch() {
        Instant now = Instant.parse("2026-11-11T10:00:00Z");
        String id = LoreRoleBatch.batchId(now);
        assertNull(LoreRoleBatch.undoError(id, now.plusSeconds(60)));
        assertNotNull(LoreRoleBatch.undoError(id, now.plus(LoreRoleBatch.UNDO_WINDOW).plusSeconds(1)));
    }
}
