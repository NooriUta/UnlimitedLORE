package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-MACH-1 — программное заведение машины miniLORE (пробел OWN-1): актор
 * {@code minilore-link-<machine>} с kind=agent, client_id, владельцем, harness — одним вызовом, без
 * админки. Заметка задачи: «Права: полная роль (или admin), журналирование». Чистый JUnit.
 */
class MachineEnrollTest {

    private static final List<String> HARNESSES = List.of("claude-code", "dsh");
    private static final String ME = "arharaga-sub";
    private static final String OTHER = "lorcetus-sub";

    private static MachineEnroll.Request req(String machine, String sub) {
        return new MachineEnroll.Request(machine, sub, null, null, null, null);
    }

    // ── форма запроса ──────────────────────────────────────────────────────

    @Test
    void requestError_machineNameAndHarnessFromDictionary() {
        assertNull(MachineEnroll.requestError(req("lorcetus", ME), HARNESSES));
        assertNull(MachineEnroll.requestError(req("lorcetus", null), HARNESSES), "kc_sub выводится из вызывающего");
        assertNotNull(MachineEnroll.requestError(null, HARNESSES));
        assertNotNull(MachineEnroll.requestError(req(null, ME), HARNESSES));
        assertNotNull(MachineEnroll.requestError(req("minilore-link-lorcetus", ME), HARNESSES),
            "имя машины без префикса учётки — иначе выйдет minilore-link-minilore-link-…");
        assertNotNull(MachineEnroll.requestError(req("a/b", ME), HARNESSES));
        assertNotNull(MachineEnroll.requestError(req("lorcetus", "bad sub"), HARNESSES));
        assertTrue(MachineEnroll.requestError(
            new MachineEnroll.Request("lorcetus", ME, "vim", null, null, null), HARNESSES).contains("vim"));
        assertNull(MachineEnroll.requestError(new MachineEnroll.Request("lorcetus", ME, "dsh", "Lorcetus", "full", true), HARNESSES));
    }

    // ── кто заводит и на кого ─────────────────────────────────────────────

    @Test
    void owner_agentFull_onlyForItsOwnOwner() {
        var c = new MachineEnroll.Caller("full", "admin", null, ME);
        assertEquals(ME, MachineEnroll.owner(c, null).kcSub());
        assertEquals(ME, MachineEnroll.owner(c, ME).kcSub());
        var foreign = MachineEnroll.owner(c, OTHER);
        assertNull(foreign.kcSub());
        assertEquals(403, foreign.status());
        assertTrue(foreign.refusal().contains("своему владельцу"), foreign.refusal());
    }

    @Test
    void owner_agentNotFull_orOrphanAgent_refused() {
        var dev = MachineEnroll.owner(new MachineEnroll.Caller("developer", "admin", null, ME), null);
        assertEquals(403, dev.status());
        assertTrue(dev.refusal().contains("full"), dev.refusal());
        var orphan = MachineEnroll.owner(new MachineEnroll.Caller("full", "admin", null, null), null);
        assertEquals(403, orphan.status());
        assertTrue(orphan.refusal().contains("владельца"), orphan.refusal());
    }

    @Test
    void owner_humanAdmin_anyone_humanOwner_onlySelf() {
        assertEquals(OTHER, MachineEnroll.owner(new MachineEnroll.Caller(null, "admin", ME, null), OTHER).kcSub());
        assertEquals(OTHER, MachineEnroll.owner(new MachineEnroll.Caller(null, "superadmin", null, null), OTHER).kcSub());
        var noSub = MachineEnroll.owner(new MachineEnroll.Caller(null, "admin", null, null), null);
        assertEquals(400, noSub.status(), "admin без токена и без kc_sub — не на кого заводить");
        assertEquals(ME, MachineEnroll.owner(new MachineEnroll.Caller(null, "editor", ME, null), null).kcSub());
        assertEquals(ME, MachineEnroll.owner(new MachineEnroll.Caller(null, "editor", ME, null), ME).kcSub());
        var foreign = MachineEnroll.owner(new MachineEnroll.Caller(null, "editor", ME, null), OTHER);
        assertEquals(403, foreign.status());
        assertEquals(403, MachineEnroll.owner(new MachineEnroll.Caller(null, "editor", null, null), null).status());
    }

    // ── занятое имя: отказ с именем владельца (как мастер «Новый ноутбук») ─

    @Test
    void conflict_existingMachineOfAnotherOwner_namesTheOwner() {
        var ex = new MachineEnroll.Existing("minilore-link-lorcetus", "agent", List.of(OTHER), "Лорцетус", null, null);
        String c = MachineEnroll.conflict("lorcetus", ME, ex, List.of(), false);
        assertNotNull(c);
        assertTrue(c.contains("Лорцетус"), c);
        assertNull(MachineEnroll.conflict("lorcetus", OTHER, ex, List.of(), false), "своя — повтор законен");
        assertNotNull(MachineEnroll.conflict("lorcetus", ME, ex, List.of(), true), "и admin не переписывает чужую машину молча");
    }

    @Test
    void conflict_orphanMachine_onlyAdminAdopts_nonAgentActor_refused() {
        var orphan = new MachineEnroll.Existing("minilore-link-x", "agent", List.of(), null, null, null);
        assertNotNull(MachineEnroll.conflict("x", ME, orphan, List.of(), false));
        assertNull(MachineEnroll.conflict("x", ME, orphan, List.of(), true));
        var human = new MachineEnroll.Existing("minilore-link-x", "human-role", List.of(), null, null, null);
        assertNotNull(MachineEnroll.conflict("x", ME, human, List.of(), true));
    }

    @Test
    void conflict_nameTakenByAgentOfAnotherOwner_orByAnotherMachine() {
        var foreignAgent = new MachineEnroll.Neighbour("lore-mcp-full_x", "lore-mcp-full_x", List.of(OTHER), "Лорцетус");
        String c = MachineEnroll.conflict("x", ME, null, List.of(foreignAgent), false);
        assertNotNull(c);
        assertTrue(c.contains("Лорцетус"), c);
        var mine = new MachineEnroll.Neighbour("lore-mcp-full_x", "lore-mcp-full_x", List.of(ME), "Я");
        assertNull(MachineEnroll.conflict("x", ME, null, List.of(mine), false));
        var twin = new MachineEnroll.Neighbour("minilore-link-y", "minilore-link-y", List.of(ME), "Я");
        assertTrue(MachineEnroll.conflict("x", ME, null, List.of(twin), true).contains("S7B-16"));
    }

    // ── план и идемпотентность ────────────────────────────────────────────

    @Test
    void plan_createThenUnchanged_harnessChangeIsUpdate() {
        var r = new MachineEnroll.Request("lorcetus", ME, "dsh", null, null, null);
        Map<String, Object> created = MachineEnroll.plan(null, r, ME);
        assertEquals("create", created.get("kind"));
        @SuppressWarnings("unchecked")
        Map<String, Object> after = (Map<String, Object>) created.get("after");
        assertEquals("minilore-link-lorcetus", after.get("client_id"));
        assertEquals("minilore-link-lorcetus", after.get("actor_id"));
        assertEquals(ME, after.get("owner_kc_sub"));
        assertEquals("dsh", after.get("harness"));

        var same = new MachineEnroll.Existing("minilore-link-lorcetus", "agent", List.of(ME), "Я", "dsh", "minilore-link-lorcetus");
        assertEquals("unchanged", MachineEnroll.plan(same, r, ME).get("kind"));
        assertEquals("unchanged", MachineEnroll.plan(same, req("lorcetus", ME), ME).get("kind"), "harness не назван — не трогаем");
        var other = new MachineEnroll.Request("lorcetus", ME, "claude-code", null, null, null);
        assertEquals("update", MachineEnroll.plan(same, other, ME).get("kind"));
        var orphan = new MachineEnroll.Existing("acl-actor", "agent", List.of(), null, null, null);
        Map<String, Object> adopt = MachineEnroll.plan(orphan, req("lorcetus", ME), ME);
        assertEquals("update", adopt.get("kind"));
        @SuppressWarnings("unchecked")
        Map<String, Object> adoptAfter = (Map<String, Object>) adopt.get("after");
        assertEquals("acl-actor", adoptAfter.get("actor_id"), "актор уже есть под своим id — его и берём");
    }

    @Test
    void linkable_agentsOfTheSameOwnerOnThatMachine() {
        var mine = new MachineEnroll.Neighbour("a1", "lore-mcp-full_x", List.of(ME), "Я");
        var foreign = new MachineEnroll.Neighbour("a2", "lore-mcp-full_x2", List.of(OTHER), "Он");
        var self = new MachineEnroll.Neighbour("minilore-link-x", "minilore-link-x", List.of(ME), "Я");
        assertEquals(List.of("a1"), MachineEnroll.linkable(List.of(mine, foreign, self), "x", ME));
    }

    // ── права агентного фильтра: подпуть сужен до full ────────────────────

    @Test
    void agentScopeFilter_actorMachine_onlyFull() {
        assertNull(AgentScopeFilter.decide("full", "/lore/actor/machine"));
        assertNotNull(AgentScopeFilter.decide("architect", "/lore/actor/machine"), "семейство actor открыто architect — подпуть нет");
        assertNotNull(AgentScopeFilter.decide("pm", "/lore/actor/machine"));
        assertNotNull(AgentScopeFilter.decide("developer", "/lore/actor/machine"));
        assertNotNull(AgentScopeFilter.decide("full", "/lore/user/machine-activity"), "окно активности — человеческое семейство user");
    }
}
