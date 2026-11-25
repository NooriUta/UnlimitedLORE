package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Сторож «цвет статьи справочника — токен (var(--…) / color-mix), не hex» ([[task:SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS]],
 * решение владельца 25.11.2026, пункт 6а). Проверяет всё, что СЕЕТ статьи на свежую базу из кода: посевы доводки и
 * Java-шагов, правила установщика (init-empty). Запись в живую базу сторожит {@link DictColorToken#refusal} в
 * {@code POST /lore/dict/entry}. Чистый JUnit.
 */
class DictColorTokenGuardTest {

    private static final Path RULES = Path.of("../scripts/model-migration/rules/status-unification.json");

    @Test
    void положительный_и_отрицательный_контроль() {
        for (String ok : List.of("var(--acc)", "var(--swatch-amber-forest)", "color-mix(in srgb,var(--acc) 55%,var(--inf))",
                "color-mix(in srgb, var(--wrn) 60%, var(--t2))", "color-mix(in oklab,var(--dng),transparent 40%)"))
            assertTrue(DictColorToken.isToken(ok), ok);
        for (String bad : List.of("#C85848", "#fff", "rgb(1,2,3)", "red", "color-mix(in srgb,#fff 50%,var(--acc))",
                "var(--acc); background:url(x)", "var(--acc) !important"))
            assertFalse(DictColorToken.isToken(bad), bad);
        assertNull(DictColorToken.refusal("area", "x", null));
        assertNull(DictColorToken.refusal("area", "x", ""));
        assertTrue(DictColorToken.refusal("task_type", "dev", "#4caf72").contains("task_type/dev"));
    }

    @Test
    void посевы_кода_красят_только_токенами() {
        Map<String, Map<String, List<StatusDictCoreSeed.Entry>>> seeds = new TreeMap<>(Map.of(
            "StatusDictCoreSeed", StatusDictCoreSeed.SEEDS,
            "QgStatusDictSeed", QgStatusDictSeed.SEEDS,
            "SkillSeed", SkillSeed.DICT_SEEDS,
            "AreaDictSeed", AreaDictSeed.SEEDS,
            "UiDictSeed", UiDictSeed.SEEDS,
            "PaletteDictSeed", PaletteDictSeed.SEEDS));
        List<String> bad = new ArrayList<>();
        seeds.forEach((src, m) -> m.forEach((dict, entries) -> entries.forEach(e -> {
            if (e.color() != null && !e.color().isBlank() && !DictColorToken.isToken(e.color()))
                bad.add(src + ": " + dict + "/" + e.code() + " = " + e.color());
        })));
        assertEquals(List.of(), bad, "сырой цвет в посеве — переведите на токен темы (var(--…) / color-mix)");
    }

    @Test
    void правила_установщика_красят_только_токенами() throws Exception {
        JsonNode root = new ObjectMapper().readTree(Files.readString(RULES));
        List<String> bad = new ArrayList<>();
        int seen = collect(root, "", bad);
        assertTrue(seen >= 20, "сторож видит цвета правил установщика: " + seen);
        assertEquals(List.of(), bad, "сырой цвет в правилах установщика (init-empty сеет их на свежую базу)");
    }

    private static int collect(JsonNode n, String path, List<String> bad) {
        int seen = 0;
        if (n.isObject()) {
            var it = n.fields();
            while (it.hasNext()) {
                var f = it.next();
                if ("color".equals(f.getKey()) && f.getValue().isTextual()) {
                    seen++;
                    if (!DictColorToken.isToken(f.getValue().asText())) bad.add(path + " = " + f.getValue().asText());
                } else seen += collect(f.getValue(), path + "/" + f.getKey(), bad);
            }
        } else if (n.isArray()) {
            for (int i = 0; i < n.size(); i++) {
                JsonNode c = n.get(i);
                seen += collect(c, path + "/" + (c.has("code") ? c.get("code").asText() : String.valueOf(i)), bad);
            }
        }
        return seen;
    }
}
