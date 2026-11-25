package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS (issue SeidrStudio/UnlimitedLORE#2).
 *
 * <p>На чистой установке в словаре не было ни одной статьи area компонентов, кроме research и
 * business (V89): цвет рисовался из констант фронта, правка цвета в админке ни на что не влияла,
 * а для кода без статьи её и править было негде. V100 заводит недостающие статьи — только INSERT,
 * правленные людьми строки не трогаются (то же правило, что V90/V93).
 */
class AreaDictSeedTest {

    @Test
    void каждыйКодAreaИзСидаКомпонентовЕстьВПосеве() {
        Set<String> seeded = new TreeSet<>();
        for (StatusDictCoreSeed.Entry e : AreaDictSeed.AREA) seeded.add(e.code());
        Set<String> missing = new TreeSet<>();
        for (LoreComponentSeeder.Component c : LoreComponentSeeder.COMPONENTS)
            if (!seeded.contains(c.area())) missing.add(c.area());
        assertEquals(Set.of(), missing, "у area компонента нет статьи словаря — цвет снова уедет в код");
    }

    @Test
    void прежниеЦветаФронтаПереехалиВСловарьБезИзменений() {
        // v1 AREA_COLOR до 25.11.2026 — те же значения, чтобы чистая установка выглядела как прежде.
        Map<String, String> was = Map.ofEntries(
            Map.entry("platform", "var(--acc)"),
            Map.entry("api", "color-mix(in srgb,var(--acc) 55%,var(--inf))"),
            Map.entry("marketing", "color-mix(in srgb,var(--acc) 55%,var(--wrn))"),
            Map.entry("ai", "var(--inf)"),
            Map.entry("frontend", "color-mix(in srgb,var(--suc) 70%,var(--bg0))"),
            Map.entry("db", "color-mix(in srgb,var(--inf) 70%,var(--bg0))"),
            Map.entry("algorithm", "color-mix(in srgb,var(--acc) 60%,var(--dng))"),
            Map.entry("data", "var(--suc)"),
            Map.entry("service", "color-mix(in srgb,var(--suc) 55%,var(--wrn))"),
            Map.entry("infra", "var(--t2)"),
            Map.entry("observability", "var(--wrn)"),
            Map.entry("engine", "color-mix(in srgb,var(--wrn) 60%,var(--dng))"),
            Map.entry("security", "var(--dng)"));
        for (Map.Entry<String, String> w : was.entrySet()) {
            StatusDictCoreSeed.Entry e = AreaDictSeed.AREA.stream()
                .filter(x -> x.code().equals(w.getKey())).findFirst().orElse(null);
            assertNotNull(e, "нет статьи area " + w.getKey());
            assertEquals(w.getValue(), e.color(), w.getKey());
            assertFalse(e.labelRu().isBlank() || e.labelEn().isBlank(), w.getKey() + ": подписи обязательны");
        }
    }

    @Test
    void существующиеНеТрогаются_research_business_иПравленныеЛюдьми() {
        List<StatusDictCoreSeed.Insert> plan = StatusDictCoreSeed.plan(AreaDictSeed.SEEDS,
            Map.of("area", Set.of("research", "business", "PLATFORM", "ai")));
        List<String> codes = plan.stream().map(StatusDictCoreSeed.Insert::code).toList();
        assertFalse(codes.contains("platform"), "правленная людьми строка не переписывается");
        assertFalse(codes.contains("ai"));
        assertEquals(AreaDictSeed.AREA.size() - 2, plan.size());
    }

    @Test
    void вставкаРасширяемаяКакУСтатейAreaV89() {
        assertTrue(AreaDictSeed.INSERT_SQL.startsWith("INSERT INTO KnowDictEntry"), "только INSERT, не UPSERT");
        assertTrue(AreaDictSeed.INSERT_SQL.contains("is_extensible = true"));
    }

    @Test
    void шагV100ЗарегистрированИРазобранНаАддитивность() {
        assertTrue(LoreSchemaMigrations.STEPS.stream()
            .anyMatch(s -> s.version() == 100 && s.name().equals(AreaDictSeed.STEP) && s.compatMajor() == 17));
        assertTrue(V1SchemaSafetyChecklist.JAVA_STEPS_REVIEWED.containsKey(AreaDictSeed.STEP));
    }
}
