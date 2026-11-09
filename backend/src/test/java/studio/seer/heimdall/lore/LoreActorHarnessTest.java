package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-15, ADR-MINILORE-007 (поправка 09.11): harness — поле актора-агента
 * из закрытого реестра claude-code | kimi-code | dsh | codex | opencode. Реестр — справочник
 * LORE «harness» (как agent_role), сервер проверяет значения по нему. Неизвестное — null,
 * а не угадка.
 */
class LoreActorHarnessTest {

    @Test
    void registryIsTheAdrList() {
        assertEquals(List.of("claude-code", "kimi-code", "dsh", "codex", "opencode"), LoreActorHarness.REGISTRY);
    }

    @Test
    void fromNameOnlyWhenExactlyOneRuleMatches() {
        assertEquals("claude-code", LoreActorHarness.fromName("Claude Code (full)"));
        assertEquals("claude-code", LoreActorHarness.fromName("claude code (architect)"));
        assertEquals("kimi-code", LoreActorHarness.fromName("Kimi Code (full)"));
        assertEquals("opencode", LoreActorHarness.fromName("OpenCode (dev)"));
        assertNull(LoreActorHarness.fromName("lore-mcp-full"), "по имени не понять — null");
        assertNull(LoreActorHarness.fromName("Claude Code vs Codex"), "два правила — неоднозначно, null");
        assertNull(LoreActorHarness.fromName(null));
    }

    @Test
    void migrationSeedsDictionaryAndBackfillsFromTheSameRules() {
        List<String> sql = LoreActorHarness.SCHEMA_SQL_V75;
        assertTrue(sql.contains("CREATE PROPERTY KnowActor.harness IF NOT EXISTS STRING"), sql.toString());
        for (String code : LoreActorHarness.REGISTRY)
            assertTrue(sql.stream().anyMatch(s -> s.contains("dict_type='harness'") && s.contains("code='" + code + "'")),
                "в справочнике есть " + code);
        assertTrue(sql.stream().anyMatch(s -> s.startsWith("UPDATE KnowActor SET harness='claude-code'") && s.contains("harness IS NULL")),
            "заполнение не затирает уже выставленное");
        assertTrue(LoreSchemaMigrations.STEPS.stream().anyMatch(s -> s.version() == 75), "шаг V75 зарегистрирован");
    }

    @Test
    void agentOwnersSliceCarriesHarness() {
        assertTrue(LoreSlices.compose("agent_owners", Map.of()).sql().contains("harness"));
    }

    @Test
    void validationAgainstRegistry() {
        assertNull(LoreActorHarness.error(null, LoreActorHarness.REGISTRY), "не передан — не трогаем");
        assertNull(LoreActorHarness.error("", LoreActorHarness.REGISTRY), "пусто — сброс в null");
        assertNull(LoreActorHarness.error("kimi-code", LoreActorHarness.REGISTRY));
        String err = LoreActorHarness.error("cursor", LoreActorHarness.REGISTRY);
        assertNotNull(err);
        assertTrue(err.contains("claude-code"), "отказ называет допустимые: " + err);
    }
}
