package studio.seer.heimdall.lore;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * AO-SESSION-LOG (владелица 16.11.2026): «просить каждый mcp писать harness … указать его
 * константой». Сервер сверяет присланный код со справочником harness и с harness клиента KC;
 * расхождение — пометкой, не догадкой.
 */
class HarnessCheckTest {

    private static final HarnessCheck.Snapshot SNAP = new HarnessCheck.Snapshot(true,
        Set.of("claude-code", "kimi-code", "codex"),
        Map.of("lore-mcp-full", "claude-code", "lore-mcp-full_kimi", "kimi-code"));

    @Test
    void matchesDictionaryAndClient() {
        HarnessCheck.Result r = HarnessCheck.judge("claude-code", "lore-mcp-full", SNAP);
        assertEquals("claude-code", r.code());
        assertNull(r.note());
    }

    @Test
    void mismatchWithClientIsNotedNotGuessed() {
        HarnessCheck.Result r = HarnessCheck.judge("claude-code", "lore-mcp-full_kimi", SNAP);
        assertEquals("claude-code", r.code(), "пишем присланное, а не подменяем");
        assertEquals("client:kimi-code", r.note());
    }

    @Test
    void unknownCodeAndMissingHeaderAndUnverified() {
        assertEquals("not_in_dictionary", HarnessCheck.judge("cursor", "lore-mcp-full", SNAP).note());
        HarnessCheck.Result none = HarnessCheck.judge(null, "lore-mcp-full", SNAP);
        assertNull(none.code());
        assertEquals("not_sent", none.note());
        HarnessCheck.Result cold = HarnessCheck.judge("claude-code", "lore-mcp-full", HarnessCheck.Snapshot.EMPTY);
        assertEquals("claude-code", cold.code());
        assertEquals("unverified", cold.note());
    }

    @Test
    void clientWithoutRegisteredHarnessIsNotAMismatch() {
        assertNull(HarnessCheck.judge("codex", "lore-mcp-full_vasilisk", SNAP).note());
    }

    @Test
    void garbageIsNotWritten() {
        HarnessCheck.Result r = HarnessCheck.judge("Claude Code; DROP", "lore-mcp-full", SNAP);
        assertNull(r.code());
        assertEquals("invalid", r.note());
    }
}
