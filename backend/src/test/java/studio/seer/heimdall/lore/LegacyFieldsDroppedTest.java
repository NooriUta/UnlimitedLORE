package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 · легаси-поля, снятые переносом 1.18 (владелица 20.11.2026: «mdl08 мы же
 * утвердили уже, все поля»). Список — {@code scripts/model-migration/rules/legacy-fields.json}; перенос их не несёт,
 * значение уходит в остаток MigLeftover. Здесь — сторона сервера: код не объявляет снятое поле заново
 * ({@code CREATE PROPERTY Тип.поле}) — иначе поднятая с нуля база снова завела бы поле, которого нет в модели.
 */
class LegacyFieldsDroppedTest {

    private static List<String> legacy() {
        try {
            JsonObject list = new JsonObject(Files.readString(
                Path.of("..", "scripts", "model-migration", "rules", "legacy-fields.json"), StandardCharsets.UTF_8));
            return List.copyOf(list.getJsonObject("fields").fieldNames());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Test
    void listIsNotEmpty() {
        assertEquals(17, legacy().size(), "список MDL-08 — 17 полей");
    }

    @Test
    void serverCodeDoesNotDeclareDroppedField() throws IOException {
        TreeSet<String> found = new TreeSet<>();
        List<String> fields = legacy();
        try (Stream<Path> files = Files.walk(Path.of("src", "main", "java"))) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String src = Files.readString(p, StandardCharsets.UTF_8);
                for (String k : fields) {
                    Pattern decl = Pattern.compile("CREATE\\s+PROPERTY\\s+" + Pattern.quote(k) + "\\s");
                    if (decl.matcher(src).find()) found.add(k + " ← " + p.getFileName());
                }
            }
        }
        assertEquals(new TreeSet<String>(), found, "снятое легаси-поле MDL-08 объявляется в коде сервера");
    }
}
