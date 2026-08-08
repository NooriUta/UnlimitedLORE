package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

    /** Реестр полнотекстовых индексов — для лечения БД в CD (DBU-14). */
    private static final String FT_OUT = "build/ft-indexes.tsv";

    /**
     * Копия реестра в репозитории: её читает лечение в CD, где {@code build/}
     * нет — образ собирается внутри docker, gradle на раннере не запускается.
     * Путь от рабочего каталога модуля {@code backend/}.
     */
    private static final String PINNED = "../.github/data/ft-indexes.tsv";

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

    /**
     * Выгружает реестр FULL_TEXT-индексов вместе с готовым SQL создания.
     *
     * <p><b>Зачем.</b> Лечение базы в CD ({@code .github/scripts/db-heal.sh})
     * пересоздаёт непригодные FT-индексы. Пересоздавать надо ИМЕННО так, как
     * объявлено в реестре — с анализатором и мерой близости: индекс, собранный
     * с другими метаданными, будет искать иначе, и расхождение обнаружится не
     * сразу.
     *
     * <p>Вписать те же строки в shell-скрипт значило бы завести второй источник
     * правды: реестр правится в Java, скрипт остаётся со старым анализатором, и
     * узнаётся это в момент, когда поиск уже отвечает не то. Поэтому SQL
     * выгружается из самого реестра.
     *
     * <p><b>Почему не REBUILD.</b> {@code REBUILD INDEX} теряет заданное имя
     * (DBR-12, воспроизведено на 26.7.2 и 26.8.1), а имя обязательно: ранжирование
     * доступно только через {@code SEARCH_INDEX('<имя>', …)}. Поэтому лечение
     * идёт через DROP + CREATE, и CREATE берётся отсюда.
     */
    @Test
    void dumpsFullTextRegistryForHealing() throws IOException {
        List<String> lines = new ArrayList<>();
        for (LoreSchemaMigrations.FtIndex ix : LoreSchemaMigrations.FT_INDEXES) {
            lines.add(ix.name() + "\t" + ix.type() + "\t"
                + String.join(",", ix.fields()) + "\t"
                + ix.createSql().replaceAll("\\s+", " ").trim());
        }

        assertFalse(lines.isEmpty(), "реестр FT-индексов пуст");
        // Тот же щит, что у слайсов: молчаливо опустевший реестр превратил бы
        // лечение в no-op, который отчитается успехом.
        assertTrue(lines.size() > 10,
            "FT-индексов всего " + lines.size() + " — реестр прочитан не целиком");

        String content = String.join("\n", lines) + "\n";

        Path out = Path.of(FT_OUT);
        Files.createDirectories(out.getParent());
        Files.writeString(out, content, StandardCharsets.UTF_8);

        // Копия в репозитории — потому что лечение идёт в CD, а туда build/ не
        // доезжает: образ собирается внутри docker, gradle на раннере не
        // запускается. Гонять сборку ради одного файла дороже, чем держать его
        // в репозитории.
        //
        // Чтобы копия не разошлась с реестром, тест её СВЕРЯЕТ и падает при
        // расхождении. Это ровно тот случай, из-за которого весь спринт: без
        // сверки вторая копия живёт своей жизнью, лечение пересоздаёт индексы
        // со старым анализатором, и узнаётся это тогда, когда поиск уже
        // отвечает не то.
        Path pinned = Path.of(PINNED);
        assertTrue(Files.exists(pinned),
            "нет " + PINNED + " — скопируй " + FT_OUT + " и закоммить");
        String committed = Files.readString(pinned, StandardCharsets.UTF_8).replace("\r\n", "\n");
        assertEquals(content, committed,
            "реестр FT-индексов разошёлся с копией в репозитории. "
            + "Обнови: cp " + FT_OUT + " " + PINNED);

        System.out.printf("FT-индексов выгружено: %d → %s (сверено с %s)%n",
            lines.size(), out.toAbsolutePath(), PINNED);
    }
}
