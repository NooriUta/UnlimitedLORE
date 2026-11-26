package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-07 — путь рискового вызова через исполнитель с гейтом:
 * dry_run → план без похода в Forgejo; без подтверждения → 428 с отпечатком и словом-вызовом;
 * диалог + слово в LORE → вызов уходит в Forgejo ровно один раз; повтор того же подтверждения — 403.
 */
class ForgejoAppApprovalFlowTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();
    private static final String OWNER = "arharaga";

    private static JsonObject args() {
        return new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE").put("branch", "feat/old");
    }

    private static ForgejoApp.Outcome run(JsonObject args, String approval, ForgejoApproval gate, long now, ForgejoAppTest.Stub up) {
        return ForgejoApp.execute(REG, "delete_branch", args, "full", approval, true, up, null, null,
            new ForgejoApp.Approvals(gate, OWNER, now));
    }

    @Test
    void dryRun_планБезПоходаВForgejo() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run(args().put("dry_run", true), null, new ForgejoApproval(), 1000, up);
        assertEquals(200, o.http(), o.envelope().encode());
        JsonObject d = o.envelope().getJsonObject("data");
        assertEquals(true, d.getBoolean("dry_run"));
        assertEquals("DELETE", d.getString("method"));
        assertEquals("/repos/AIDA/UnlimitedLORE/branches/feat/old", d.getString("path"));
        assertEquals(ForgejoApproval.intentHash("delete_branch", args()), d.getString("intent_hash"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void безПодтверждения_428_сОтпечаткомИСловомВызовом() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run(args(), null, new ForgejoApproval(), 1000, up);
        assertEquals(428, o.http());
        JsonObject err = o.envelope().getJsonObject("error");
        assertEquals("APPROVAL_REQUIRED", err.getString("code"));
        JsonObject ch = err.getJsonObject("challenge");
        assertTrue(ch != null && ch.getString("id") != null && ch.getString("word") != null, err.encode());
        assertEquals(ForgejoApproval.intentHash("delete_branch", args()), err.getString("intent_hash"));
        assertTrue(err.getString("hint").contains("LORE"), err.getString("hint"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void диалогИСловоВLore_вызовУходитОдинРаз() {
        ForgejoApproval gate = new ForgejoApproval();
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.status = 204;
        up.body = "";
        JsonObject err = run(args(), null, gate, 1000, up).envelope().getJsonObject("error");
        JsonObject ch = err.getJsonObject("challenge");
        assertEquals("ok", gate.confirm(ch.getString("id"), ch.getString("word"), OWNER, 2000));
        String header = new JsonObject().put("message_ref", "minilore:msg-1").put("at", 1500).put("human", OWNER)
            .put("intent_hash", err.getString("intent_hash")).put("challenge_id", ch.getString("id")).encode();
        ForgejoApp.Outcome ok = run(args(), header, gate, 3000, up);
        assertEquals(200, ok.http(), ok.envelope().encode());
        assertEquals(1, up.calls.size());
        assertEquals("DELETE /repos/AIDA/UnlimitedLORE/branches/feat/old", up.calls.get(0));
        ForgejoApp.Outcome again = run(args(), header, gate, 4000, up);
        assertEquals(403, again.http());
        assertEquals("lore_factor", again.envelope().getJsonObject("error").getString("failed_check"));
        assertEquals(1, up.calls.size(), "повтор подтверждения в Forgejo не уходит");
    }

    @Test
    void подтверждениеДругойОперации_403IntentHash() {
        ForgejoApproval gate = new ForgejoApproval();
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        JsonObject err = run(args(), null, gate, 1000, up).envelope().getJsonObject("error");
        JsonObject ch = err.getJsonObject("challenge");
        gate.confirm(ch.getString("id"), ch.getString("word"), OWNER, 2000);
        String header = new JsonObject().put("message_ref", "m").put("at", 1500).put("human", OWNER)
            .put("intent_hash", err.getString("intent_hash")).put("challenge_id", ch.getString("id")).encode();
        ForgejoApp.Outcome o = run(args().put("branch", "feat/другая"), header, gate, 3000, up);
        assertEquals(403, o.http());
        assertEquals("intent_hash", o.envelope().getJsonObject("error").getString("failed_check"));
        assertTrue(up.calls.isEmpty());
    }
}
