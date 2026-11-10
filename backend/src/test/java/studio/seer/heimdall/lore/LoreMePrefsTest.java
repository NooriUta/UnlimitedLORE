package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-04 · decision:D-2026-UXR-VIEWS-SERVER.
 *
 * <p>Виды, избранное, недавние и личные настройки — на сервере. Здесь без живой
 * базы: шаг схемы (аддитивность), правила настроек (белый список ключей и типов),
 * правила вида (видимость «я / все / роли») и место семейства в матрице агентов.
 */
class LoreMePrefsTest {

    /**
     * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-17: место показа паспорта — личная настройка, а не только
     * адрес текущего сеанса. Владелица 10.11: «в настройках нет указания, где паспорт показывать —
     * справа или внизу». «auto» — выбора не было, экран решает сам; подменять его умолчанием нельзя.
     */
    @Test
    void passportPlaceIsAPersonalSetting() {
        assertEquals("auto", LoreMePrefs.defaults().get("passport_place"), "умолчание — «выбора не было»");
        for (String p : List.of("auto", "right", "bottom", "full"))
            assertEquals(List.of(), LoreMePrefs.validateSettingsPatch(Map.of("passport_place", p)), p);
        assertEquals(1, LoreMePrefs.validateSettingsPatch(Map.of("passport_place", "left")).size(),
            "неизвестное место — отказ, а не молчаливое умолчание");
    }

    /**
     * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-16: масштаб текста — ползунок-множитель (владелица 10.11:
     * «ползунок с сохранением множителя… сколько мин/макс оставить — скажу после выкатки»).
     * Границы предварительные — значение вне них прижимается к краю, а не отвергается:
     * после сужения границ человек придёт со старым значением, отказ прочтётся как поломка.
     */
    @Test
    void textScaleIsANumberClampedToBounds() {
        assertEquals(1.0, ((Number) LoreMePrefs.defaults().get("text_scale")).doubleValue(), 1e-9);
        Map<String, Object> sch = (Map<String, Object>) LoreMePrefs.schema().get("text_scale");
        assertEquals("number", sch.get("type"));
        assertEquals(0.8, ((Number) sch.get("min")).doubleValue(), 1e-9);
        assertEquals(1.6, ((Number) sch.get("max")).doubleValue(), 1e-9);
        assertEquals(0.05, ((Number) sch.get("step")).doubleValue(), 1e-9);
        assertEquals(List.of(), LoreMePrefs.validateSettingsPatch(Map.of("text_scale", 1.25)));
        assertEquals(List.of(), LoreMePrefs.validateSettingsPatch(Map.of("text_scale", 3)),
            "вне границ — не отказ, а прижатие");
        assertEquals(1, LoreMePrefs.validateSettingsPatch(Map.of("text_scale", "big")).size(), "не число — отказ");
        Map<String, Object> eff = LoreMePrefs.effective(Map.of("text_scale", 3));
        assertEquals(1.6, ((Number) eff.get("text_scale")).doubleValue(), 1e-9, "прижато к верхней границе");
        assertEquals(0.8, ((Number) LoreMePrefs.effective(Map.of("text_scale", 0.1)).get("text_scale")).doubleValue(), 1e-9);
        assertFalse(LoreMePrefs.clampNotes(Map.of("text_scale", 3)).isEmpty(), "о прижатии сказано словами");
        assertTrue(LoreMePrefs.clampNotes(Map.of("text_scale", 1.2)).isEmpty());
    }

    // ── Схема: один аддитивный шаг, только новые типы ───────────────────────

    @Test
    void schemaStepIsAdditiveAndCreatesOnlyNewTypes() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("user_views_prefs")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы user_views_prefs не зарегистрирован"));
        assertEquals(17, step.compatMajor(), "аддитивно: major не поднимается, v1 переживает");
        for (String sql : step.sql()) {
            assertTrue(sql.startsWith("CREATE VERTEX TYPE") || sql.startsWith("CREATE PROPERTY")
                    || sql.startsWith("CREATE INDEX"), "только аддитивный DDL: " + sql);
            assertTrue(sql.contains("IF NOT EXISTS"), "идемпотентно: " + sql);
            assertTrue(sql.matches(".*\\b(KnowSavedView|KnowUserFavorite|KnowUserRecent|KnowUserSettings)\\b.*"),
                "шаг трогает только свои новые типы: " + sql);
        }
        List<String> types = LoreSchemaMigrations.requiredLiveTypes();
        for (String t : List.of("KnowSavedView", "KnowUserFavorite", "KnowUserRecent", "KnowUserSettings"))
            assertTrue(types.contains(t), "тип " + t + " обязан сверяться на старте");
    }

    @Test
    void ownerAndKeysAreIndexed() {
        String all = String.join("\n", LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("user_views_prefs")).findFirst().orElseThrow().sql());
        assertTrue(all.contains("ON KnowSavedView (view_uid) UNIQUE"), all);
        assertTrue(all.contains("ON KnowSavedView (owner_sub) NOTUNIQUE"), all);
        assertTrue(all.contains("ON KnowUserFavorite (owner_sub, ref_type, ref_id) UNIQUE"), all);
        assertTrue(all.contains("ON KnowUserRecent (owner_sub, ref_type, ref_id) UNIQUE"), all);
        assertTrue(all.contains("ON KnowUserSettings (owner_sub) UNIQUE"), all);
    }

    // ── Настройки ───────────────────────────────────────────────────────────

    @Test
    void settingsCoverTheListFromTheTask() {
        Set<String> keys = LoreMePrefs.SETTINGS.keySet();
        for (String k : List.of("nav_collapse_on_read", "right_column", "text_size", "theme",
                "density", "single_key_shortcuts", "stripes", "new_navigation"))
            assertTrue(keys.contains(k), "нет настройки " + k);
    }

    @Test
    void defaultsAreCompleteAndValid() {
        Map<String, Object> d = LoreMePrefs.defaults();
        assertEquals(LoreMePrefs.SETTINGS.keySet(), d.keySet());
        assertEquals(List.of(), LoreMePrefs.validateSettingsPatch(d), "умолчания обязаны проходить свою же проверку");
        assertEquals(false, d.get("new_navigation"), "новая навигация — только по явному выбору");
    }

    // S5-14: v2 (kit prefs) хранит палитру и плотность «roomy» — сервер обязан их
    // принимать, иначе живой клиент получает 400, а значения остаются в браузере.
    @Test
    void v2PaletteAndRoomyDensityAreAccepted() {
        assertEquals(List.of(), LoreMePrefs.validateSettingsPatch(Map.of("density", "roomy")));
        for (String p : List.of("amber-forest", "lichen", "slate", "juniper", "warm-dark"))
            assertEquals(List.of(), LoreMePrefs.validateSettingsPatch(Map.of("palette", p)), "палитра kit " + p);
        assertEquals(1, LoreMePrefs.validateSettingsPatch(Map.of("palette", "neon")).size(),
            "неизвестная палитра отбивается по имени");
        Map<String, Object> d = LoreMePrefs.defaults();
        assertEquals("roomy", d.get("density"), "умолчание плотности — решение владелицы 08.11 (S4-21)");
        assertEquals("amber-forest", d.get("palette"), "умолчание палитры — как у kit и v1");
    }

    @Test
    void unknownKeyAndWrongTypeAreRejectedByName() {
        Map<String, Object> bad = new HashMap<>();
        bad.put("colour", "red");
        bad.put("stripes", "yes");
        bad.put("text_size", "huge");
        List<String> errs = LoreMePrefs.validateSettingsPatch(bad);
        assertEquals(3, errs.size(), errs.toString());
        assertTrue(errs.stream().anyMatch(e -> e.contains("colour")));
        assertTrue(errs.stream().anyMatch(e -> e.contains("stripes")));
        assertTrue(errs.stream().anyMatch(e -> e.contains("text_size") && e.contains("huge")));
    }

    @Test
    void mergeIsPartialAndNullResetsToDefault() {
        Map<String, Object> stored = Map.of("theme", "light", "stripes", true);
        Map<String, Object> patch = new HashMap<>();
        patch.put("density", "comfortable");
        patch.put("theme", null);
        Map<String, Object> out = LoreMePrefs.merge(stored, patch);
        assertEquals(Map.of("stripes", true, "density", "comfortable"), out,
            "незатронутое сохраняется, null снимает личное значение");
    }

    @Test
    void effectiveDropsObsoleteStoredKeys() {
        Map<String, Object> eff = LoreMePrefs.effective(Map.of("gone_setting", 1, "stripes", true));
        assertFalse(eff.containsKey("gone_setting"), "снятая настройка не утекает в ответ");
        assertEquals(true, eff.get("stripes"));
        assertEquals(LoreMePrefs.SETTINGS.keySet(), eff.keySet());
    }

    // ── Вид ─────────────────────────────────────────────────────────────────

    @Test
    void viewValidation() {
        assertNull(LoreMePrefs.validateView("Мои задачи", "tasks", "status=open", "me", List.of()));
        assertNotNull(LoreMePrefs.validateView("", "tasks", "", "me", List.of()), "пустое имя");
        assertNotNull(LoreMePrefs.validateView("x", "Tasks!", "", "me", List.of()), "раздел вне шаблона");
        assertNotNull(LoreMePrefs.validateView("x", "tasks", "", "team", List.of()), "неизвестная видимость");
        assertNotNull(LoreMePrefs.validateView("x", "tasks", "", "roles", List.of()), "roles без ролей");
        assertNotNull(LoreMePrefs.validateView("x", "tasks", "q".repeat(4001), "me", List.of()), "запрос длиннее предела");
        assertNull(LoreMePrefs.validateView("x", "tasks", "", "roles", List.of("pm")));
    }

    @Test
    void visibilityRule() {
        assertTrue(LoreMePrefs.visibleTo("u1", "me", List.of(), "u1", Set.of()));
        assertFalse(LoreMePrefs.visibleTo("u1", "me", List.of(), "u2", Set.of("admin")),
            "чужой личный вид не виден даже админу");
        assertTrue(LoreMePrefs.visibleTo("u1", "all", List.of(), "u2", Set.of()));
        assertTrue(LoreMePrefs.visibleTo("u1", "roles", List.of("pm", "tester"), "u2", Set.of("tester")));
        assertFalse(LoreMePrefs.visibleTo("u1", "roles", List.of("pm"), "u2", Set.of("viewer")));
    }

    @Test
    void rolesCsvRoundTrip() {
        assertEquals("pm,tester", LoreMePrefs.rolesCsv(List.of("tester", "pm", "pm")));
        assertEquals(List.of("pm", "tester"), LoreMePrefs.parseRolesCsv("pm,tester"));
        assertEquals(List.of(), LoreMePrefs.parseRolesCsv(null));
    }

    // ── Матрица агентов ─────────────────────────────────────────────────────

    @Test
    void meFamilyIsInAgentMatrixForEveryProfile() {
        // «Видимость — сам пользователь и его агенты» (D-2026-UXR-VIEWS-SERVER):
        // агент пишет от имени владельца, поэтому семейство открыто всем профилям —
        // но строкой в матрице, а не молчаливым пропуском «неизвестного семейства».
        Set<String> me = AgentScopeFilter.FAMILY_AGENTS.get("me");
        assertNotNull(me, "семейство me обязано быть в матрице явно");
        assertEquals(AgentScopeFilter.FAMILY_AGENTS.get("quality"), me);
    }
}
