package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Поручение владелицы 11.11.2026 (сессиям kit и контракта): «все упоминания в
 * объектах чужих объектов должны иметь иконки и расцветку соответствующего
 * канонического объекта и ссылку на него».
 *
 * <p>Иконку типа модель отдавала, ЦВЕТ — нет: канон цвета жил только в v1
 * токенами {@code --section-*}. Теперь {@code /lore/model} → {@code types.<тип>.color}
 * — ИМЯ токена канона (не hex): значение решает тема, светлая и тёмная совпадают.
 * Тип без канона — {@code null} честно, а не выдуманный цвет.
 */
class LoreModelTypeColorTest {

    @Test
    void canonicalTypesNameTheirV1Token() {
        Map<String, String> c = LoreModelTypes.TYPE_COLOR;
        assertEquals("section-sprints", c.get("sprint"));
        assertEquals("section-adrs", c.get("adr"));
        assertEquals("section-decisions", c.get("decision"));
        assertEquals("section-milestones", c.get("milestone"));
        assertEquals("section-releases", c.get("release"));
        assertEquals("section-components", c.get("component"));
        assertEquals("section-tech", c.get("tech"));
        assertEquals("section-features", c.get("feature"));
    }

    @Test
    void everyTypeIsEitherColouredOrNamedAsWithoutCanon() {
        List<String> lost = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) {
            boolean coloured = LoreModelTypes.TYPE_COLOR.containsKey(t);
            boolean none = LoreModelTypes.NO_TYPE_COLOR.contains(t);
            if (coloured == none) lost.add(t);
        }
        assertEquals(List.of(), lost, "у типа должен быть ровно один ответ: токен канона или явное «канона нет»");
        assertFalse(LoreModelTypes.NO_TYPE_COLOR.isEmpty(), "task/spec/question канона v1 не имеют — названы явно");
    }

    /** Имя токена без объявления в CSS v1 даст молча серый цвет — ловим здесь. */
    @Test
    void everyNamedTokenExistsInV1Styles() throws Exception {
        Path styles = Path.of("..", "src", "styles");
        assertTrue(Files.isDirectory(styles), "нет каталога стилей v1: " + styles.toAbsolutePath());
        StringBuilder css = new StringBuilder();
        try (Stream<Path> files = Files.walk(styles)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".css")).toList()) css.append(Files.readString(p));
        }
        List<String> missing = new ArrayList<>();
        for (String token : LoreModelTypes.TYPE_COLOR.values())
            if (!css.toString().contains("--" + token + ":")) missing.add(token);
        assertEquals(List.of(), missing, "токен не объявлен в src/styles/*.css");
    }
}
