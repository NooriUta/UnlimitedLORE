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
 *
 * <p>Исключение — поле из эталона v1 ({@code v1-schema-baseline.txt}): v1 обязан работать на схеме после новых шагов
 * (V1WorksOnNewSchemaLiveDbTest, заморозка v1), поэтому объявление старой схемы остаётся; схема 1.18 из модели
 * его не несёт. Найдено CI #1646: снятие {@code CREATE PROPERTY KnowPR.pr_id} уронило сторож заморозки v1.
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

    /** «Тип.поле» эталона v1 — схема, на которой обязан работать v1. */
    private static java.util.Set<String> v1Baseline() throws IOException {
        java.util.Set<String> out = new java.util.HashSet<>();
        for (String line : Files.readAllLines(Path.of("src", "test", "resources", "v1-schema-baseline.txt"), StandardCharsets.UTF_8)) {
            int c = line.indexOf(':');
            if (c > 0) out.add(line.substring(0, c).trim());
        }
        return out;
    }

    @Test
    void v1BaselineExemptionIsReal() throws IOException {
        assertTrue(v1Baseline().contains("KnowPR.pr_id"), "эталон v1 читается: в нём есть KnowPR.pr_id");
    }

    @Test
    void serverCodeDoesNotDeclareDroppedField() throws IOException {
        TreeSet<String> found = new TreeSet<>();
        java.util.Set<String> v1 = v1Baseline();
        List<String> fields = legacy().stream().filter(k -> !v1.contains(k)).toList();
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
