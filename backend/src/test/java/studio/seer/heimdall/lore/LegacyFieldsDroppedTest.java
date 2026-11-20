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

    /**
     * Объявления в шагах v1, уже применённых на проде: SQL шага входит в checksum ledger, правка уронила бы старт
     * по дрейф-гарду. На базе 1.18 шаги v1 не исполняются (схема собирается из модели, lore.migrate=false).
     */
    private static final java.util.Set<String> V1_APPLIED = java.util.Set.of(
        "KnowDoc.content_md ← LoreSchemaMigrations.java"); // шаг 3 fulltext_md_sweep_rest

    private static List<String> legacy() {
        try {
            JsonObject list = new JsonObject(Files.readString(
                Path.of("..", "scripts", "model-migration", "rules", "legacy-fields.json"), StandardCharsets.UTF_8));
            java.util.List<String> out = new java.util.ArrayList<>(list.getJsonObject("fields").fieldNames());
            // MDL-08 ч.2: дальнейшие пачки — раздел more, у каждой своё слово владелицы
            if (list.containsKey("more"))
                for (Object b : list.getJsonArray("more")) out.addAll(((JsonObject) b).getJsonObject("fields").fieldNames());
            return List.copyOf(out);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Test
    void listIsNotEmpty() {
        assertEquals(19, legacy().size(), "список MDL-08 — 17 полей первой пачки + KnowRelease.version и KnowDoc.content_md второй");
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
                    if (decl.matcher(src).find() && !V1_APPLIED.contains(k + " ← " + p.getFileName())) found.add(k + " ← " + p.getFileName());
                }
            }
        }
        assertEquals(new TreeSet<String>(), found, "снятое легаси-поле MDL-08 объявляется в коде сервера");
    }

    /** MDL-08 ч.2: KnowRelease.version — дубль git_tag; срезы релизов отдают ключ version из git_tag, поле не читают. */
    @Test
    void releaseSlicesReadVersionFromGitTag() {
        for (String id : new String[] {"releases", "release_by_id", "project_releases"}) {
            String sql = LoreSlices.get(id).baseSql();
            assertTrue(sql.contains("git_tag AS version"), id + ": version = git_tag");
            assertFalse(sql.replace("git_tag AS version", "").matches("(?s).*(?<![.\\w])version(?!\\w).*"), id + " читает KnowRelease.version: " + sql);
        }
    }

    /** MDL-08 ч.2: KnowDoc.content_md (0 из 460, писателя нет) — ни поиск, ни полнотекстовый индекс его не читают. */
    @Test
    void docContentMdIsNotReadBySearchOrIndex() {
        LoreSchemaMigrations.FtIndex ix = LoreSchemaMigrations.FT_INDEXES.stream()
            .filter(i -> i.name().equals("ftKnowDoc")).findFirst().orElseThrow();
        assertFalse(ix.fields().contains("content_md"), ix.fields().toString());
        assertTrue(ix.fields().containsAll(List.of("title", "content_md_en", "content_md_ru")));
        assertNull(LoreDocResource.versionBodyOf(null, null), "запасного легаси-тела больше нет");
        assertEquals("ru", LoreDocResource.versionBodyOf("ru", "en"));
        assertEquals("en", LoreDocResource.versionBodyOf(" ", "en"));
    }
}
