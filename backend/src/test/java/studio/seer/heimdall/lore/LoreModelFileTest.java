package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-02 — модель лежит файлом (D-2026-LORE-MODEL-AS-CONFIG, шаг 1).
 * Эталон «после = до» держит LoreModelGoldenTest; здесь — сам файл: канон и его копия в образе
 * совпадают, битый файл не превращается в пустую модель, в Java описаний типов больше нет.
 */
class LoreModelFileTest {

    static final Path CANON = Path.of("..", "shared", "model", "lore-model.json");
    static final Path COPY = Path.of("src", "main", "resources", "lore-model", "lore-model.json");

    static String read(Path p) throws Exception {
        return Files.readString(p, StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    /** Канон shared/model и копия в ресурсах бэкенда (контекст образа — только backend/) — один текст. */
    @Test
    void canonAndBackendCopyAreIdentical() throws Exception {
        assertEquals(read(CANON), read(COPY),
            "shared/model/lore-model.json и backend/src/main/resources/lore-model/lore-model.json разошлись — правьте канон и копируйте");
    }

    /** Файл в каноническом виде: правка руками не оставляет «второго форматирования» для дифф-ревью. */
    @Test
    void canonIsInCanonicalForm() throws Exception {
        String text = read(CANON);
        assertEquals(text, LoreModelFile.render(LoreModelFile.parse(text)));
    }

    @Test
    void serverModelIsReadFromTheFile() throws Exception {
        LoreModelFile.Content c = LoreModelFile.parse(read(CANON));
        assertEquals(c.types(), LoreRecordRegistry.TYPES);
        assertEquals(c.typeDefs().get("task"), LoreRecordRegistry.get("task"));
        assertEquals(c.graph(), LoreModelTypes.GRAPH);
    }

    // ── Битый файл — явный отказ, а не пустая модель ─────────────────────

    @Test
    void brokenFileFailsLoudly() throws Exception {
        String good = read(CANON);
        assertThrows(IllegalStateException.class, () -> LoreModelFile.parse("не json"), "не JSON");
        assertThrows(IllegalStateException.class, () -> LoreModelFile.parse("{}"), "нет format");
        assertThrows(IllegalStateException.class,
            () -> LoreModelFile.parse(good.replace("\"format\" : \"lore-model/1\"", "\"format\" : \"lore-model/9\"")), "чужой формат");
        IllegalStateException typo = assertThrows(IllegalStateException.class,
            () -> LoreModelFile.parse(good.replaceFirst("\"labelKey\" : \"pp.kind.sprint\"", "\"lablKey\" : \"pp.kind.sprint\"")));
        assertTrue(typo.getMessage().contains("lablKey"), "опечатка в ключе названа: " + typo.getMessage());
        IllegalStateException dangling = assertThrows(IllegalStateException.class,
            () -> LoreModelFile.parse(good.replaceFirst("\"fields\" : \\[ \"priority\", \"projects\", \"releases\" \\]",
                "\"fields\" : [ \"priority\", \"projects\", \"releases\", \"нет_такого\" ]")));
        assertTrue(dangling.getMessage().contains("нет_такого"), dangling.getMessage());
    }

    // ── Grep-сторож: описания типов не возвращаются в Java ───────────────

    static final List<String> MODEL_CLASSES = List.of("LoreRecordRegistry", "LoreModelTypes", "LorePassportSurface");

    /** Признаки таблицы описаний в коде: конструкторы описаний и литеральные таблицы по типам. */
    static final List<Pattern> TABLE_MARKERS = List.of(
        Pattern.compile("new (Field|Relation|Part|LinkTab|TabRel|TreeNode|Body|PropSection|TypeDef|Options|Graph|Slot)\\("),
        Pattern.compile("Map\\.entry\\(\""),
        Pattern.compile("(TYPE_DEFS|CHILD_ONLY)\\.put\\("));

    @Test
    void noTypeDescriptionsInJava() throws Exception {
        for (String cls : MODEL_CLASSES) {
            String src = Files.readString(Path.of("src", "main", "java", "studio", "seer", "heimdall", "lore", cls + ".java"),
                StandardCharsets.UTF_8);
            for (Pattern p : TABLE_MARKERS)
                assertFalse(p.matcher(src).find(), cls + ": описание модели в коде (" + p + ") — место ему в shared/model/lore-model.json");
        }
    }
}
