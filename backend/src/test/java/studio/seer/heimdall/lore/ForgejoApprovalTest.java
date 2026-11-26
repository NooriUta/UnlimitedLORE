package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-07 — гейт рисковых операций: два фактора (слово владельца 26.11 — «два фактора: это
 * диалог и подтверждение в LORE»).
 * <ul>
 *   <li>фактор 1 — диалог: заголовок X-Lore-Human-Approval {message_ref, at, human, intent_hash, challenge_id};</li>
 *   <li>фактор 2 — LORE: агент называет человеку слово-вызов, человек вводит его в LORE под своей учёткой.</li>
 * </ul>
 * Проверки: сообщение и время, человек = владелец сессии, отпечаток операции, срок, фактор LORE (то слово, тот же
 * человек, та же операция, не истёк, не использован). Подтверждение одноразовое.
 */
class ForgejoApprovalTest {

    static final long T0 = 1_800_000_000_000L;
    static final String OWNER = "arharaga";

    static JsonObject args() {
        return new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE").put("branch", "feat/old");
    }

    @Test
    void отпечатокОперации_детерминирован_иНеЗависитОтПорядкаИDryRun() {
        String a = ForgejoApproval.intentHash("delete_branch", args());
        String b = ForgejoApproval.intentHash("delete_branch",
            new JsonObject().put("branch", "feat/old").put("repo", "UnlimitedLORE").put("owner", "AIDA").put("dry_run", true));
        assertEquals(a, b);
        assertNotEquals(a, ForgejoApproval.intentHash("delete_branch", args().put("branch", "feat/other")));
        assertNotEquals(a, ForgejoApproval.intentHash("delete_tag", args()));
    }

    @Test
    void словоВызов_короткое_разное_иСрок() {
        ForgejoApproval g = new ForgejoApproval();
        ForgejoApproval.Challenge c1 = g.issue("delete_branch", "h1", T0);
        ForgejoApproval.Challenge c2 = g.issue("delete_branch", "h1", T0);
        assertNotEquals(c1.id(), c2.id());
        assertTrue(c1.word().length() <= 12 && !c1.word().contains(" "), c1.word());
        assertEquals(T0 + ForgejoApproval.CHALLENGE_TTL_MS, c1.expiresAt());
    }

    private static JsonObject dialog(String hash, String challengeId, long at) {
        return new JsonObject().put("message_ref", "minilore:msg-123").put("at", at).put("human", OWNER)
            .put("intent_hash", hash).put("challenge_id", challengeId);
    }

    @Test
    void обаФактора_проходят_иПодтверждениеОдноразовое() {
        ForgejoApproval g = new ForgejoApproval();
        String h = ForgejoApproval.intentHash("delete_branch", args());
        ForgejoApproval.Challenge c = g.issue("delete_branch", h, T0);
        assertEquals("ok", g.confirm(c.id(), c.word(), OWNER, T0 + 1000));
        assertNull(g.verify(dialog(h, c.id(), T0 + 2000), h, OWNER, T0 + 3000), "оба фактора на месте");
        assertEquals("lore_factor", g.verify(dialog(h, c.id(), T0 + 2000), h, OWNER, T0 + 4000), "повтор — уже использовано");
    }

    @Test
    void безВводаВLore_отказФактора2() {
        ForgejoApproval g = new ForgejoApproval();
        String h = ForgejoApproval.intentHash("delete_branch", args());
        ForgejoApproval.Challenge c = g.issue("delete_branch", h, T0);
        assertEquals("lore_factor", g.verify(dialog(h, c.id(), T0 + 2000), h, OWNER, T0 + 3000));
    }

    @Test
    void неТоСлово_илиДругойЧеловек_вLore() {
        ForgejoApproval g = new ForgejoApproval();
        String h = ForgejoApproval.intentHash("delete_branch", args());
        ForgejoApproval.Challenge c = g.issue("delete_branch", h, T0);
        assertEquals("wrong_word", g.confirm(c.id(), c.word() + "x", OWNER, T0 + 1000));
        assertEquals("ok", g.confirm(c.id(), c.word().toUpperCase(), "someone", T0 + 1000), "регистр не важен");
        assertEquals("lore_factor", g.verify(dialog(h, c.id(), T0 + 2000), h, OWNER, T0 + 3000),
            "в LORE подтвердил другой человек, чем в диалоге");
    }

    @Test
    void проверкиДиалога_поОтдельности() {
        ForgejoApproval g = new ForgejoApproval();
        String h = ForgejoApproval.intentHash("delete_branch", args());
        ForgejoApproval.Challenge c = g.issue("delete_branch", h, T0);
        g.confirm(c.id(), c.word(), OWNER, T0 + 1000);
        assertEquals("message", g.verify(dialog(h, c.id(), T0).put("message_ref", ""), h, OWNER, T0 + 2000));
        assertEquals("human", g.verify(dialog(h, c.id(), T0).put("human", "чужой"), h, OWNER, T0 + 2000));
        assertEquals("intent_hash", g.verify(dialog("другая-операция", c.id(), T0), h, OWNER, T0 + 2000));
        assertEquals("ttl", g.verify(dialog(h, c.id(), T0), h, OWNER, T0 + ForgejoApproval.DIALOG_TTL_MS + 1));
    }

    @Test
    void истёкшийВызов_неПодтверждается() {
        ForgejoApproval g = new ForgejoApproval();
        ForgejoApproval.Challenge c = g.issue("delete_branch", "h", T0);
        assertEquals("expired", g.confirm(c.id(), c.word(), OWNER, T0 + ForgejoApproval.CHALLENGE_TTL_MS + 1));
        assertEquals("unknown", g.confirm("нет-такого", "x", OWNER, T0));
    }

    @Test
    void заголовокНеJson_илиБезПолей_отказMessage() {
        ForgejoApproval g = new ForgejoApproval();
        assertEquals("message", g.verify(null, "h", OWNER, T0));
        assertEquals("message", g.verify(new JsonObject(), "h", OWNER, T0));
        assertFalse(ForgejoApproval.parseHeader("msg 14.11 «да»") != null, "свободный текст — не подтверждение");
    }
}
