package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Выгружает SQL всех слайсов в {@code build/slice-sql.tsv} для регресса СУБД
 * (DBU-03/DBU-05).
 *
 * <p><b>Зачем это тест, а не скрипт.</b> Регресс на синтетических запросах
 * проверяет грамматику, но не то, чем система реально пользуется. Заметки
 * 26.8.1 меняли поведение BM25, курсора индекса и выбора бакета при поиске по
 * вторичному индексу — всё это ломается не в выдуманном запросе, а в нашем.
 * Значит прогонять надо НАШИ запросы, а взять их можно только из реестра.
 *
 * <p>Вторая причина — вторая копия SQL разошлась бы с первой при первой же
 * правке слайса, и регресс проверял бы то, чего в продукте уже нет.
 *
 * <p>Чистый unit-тест: живая БД не нужна, реестр статический. Полный
 * {@code ./gradlew test} запускать нельзя (уводит схему прода) — гонять
 * точечно: {@code --tests "*SliceSqlDumpTest"}.
 */
class SliceSqlDumpTest {

    /** Плейсхолдеры, которыми набивается запрос: реальные значения из корпуса. */
    private static final String OUT = "build/slice-sql.tsv";

    @Test
    void dumpsEverySliceSqlForRegressionRun() throws IOException {
        List<String> lines = new ArrayList<>();
        int withParams = 0;

        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            if (!def.required().isEmpty()) withParams++;
            // TSV: id, required-params (через запятую или пусто), SQL в одну строку.
            // Перевод строк схлопывается — иначе TSV перестаёт быть построчным.
            String sql = def.baseSql().replaceAll("\\s+", " ").trim();
            lines.add(id + "\t" + String.join(",", def.required()) + "\t" + sql);
        }

        assertFalse(lines.isEmpty(), "реестр слайсов пуст — выгружать нечего");
        // Защита от молчаливо опустевшего реестра: если слайсов вдруг стало
        // мало, регресс отчитается зелёным, проверив почти ничего.
        assertTrue(lines.size() > 50,
            "слайсов всего " + lines.size() + " — похоже, реестр прочитан не целиком");

        Path out = Path.of(OUT);
        Files.createDirectories(out.getParent());
        Files.writeString(out, String.join("\n", lines) + "\n", StandardCharsets.UTF_8);

        System.out.printf("слайсов выгружено: %d (из них с обязательными параметрами: %d) → %s%n",
            lines.size(), withParams, out.toAbsolutePath());
    }
}
