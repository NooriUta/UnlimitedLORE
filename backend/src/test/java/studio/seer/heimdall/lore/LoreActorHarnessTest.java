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
        assertFalse(sql.stream().anyMatch(s -> s.startsWith("UPDATE KnowActor")),
            "в SQL-шаге после v1 только аддитивное — заполнение идёт Java-шагом V76");
        assertTrue(LoreSchemaMigrations.STEPS.stream().anyMatch(s -> s.version() == 75), "шаг V75 зарегистрирован");
        assertTrue(LoreSchemaMigrations.STEPS.stream().anyMatch(s -> s.version() == 76 && s.name().equals("java__actor_harness_backfill")));
    }

    @Test
    void backfillPlanAssignsOnlyUnambiguous() {
        List<LoreActorHarness.Assign> plan = LoreActorHarness.plan(List.of(
            Map.of("actor_id", "A1", "name", "Claude Code (full)"),
            Map.of("actor_id", "A2", "name", "lore-mcp-full"),
            Map.of("actor_id", "A3", "name", "Claude Code vs Codex")));
        assertEquals(List.of(new LoreActorHarness.Assign("A1", "claude-code")), plan, "только однозначные");
    }

    /** Факт владелицы 09.11: «все кроме Kimi и basilisk harness Claude». Имя врёт у vasilisk. */
    @Test
    void backfillPlanFollowsOwnerFactsForProdAgents() {
        List<LoreActorHarness.Assign> plan = LoreActorHarness.plan(List.of(
            Map.of("actor_id", "AGENT-FULL_KIMI-mw8ykenh", "name", "Kimi (full)"),
            Map.of("actor_id", "AGENT-FULL_VASILISK-mw85b6r4", "name", "Claude Code (full) vasilisk"),
            Map.of("actor_id", "AGENT-PM-msbt4bye", "name", "Claude Code (pm)")));
        assertEquals(List.of(
            new LoreActorHarness.Assign("AGENT-FULL_KIMI-mw8ykenh", "kimi-code"),
            new LoreActorHarness.Assign("AGENT-PM-msbt4bye", "claude-code")), plan,
            "Kimi (full) — kimi-code; vasilisk не Claude, harness не угадываем — остаётся null");
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
