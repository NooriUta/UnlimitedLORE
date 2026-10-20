package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RM-P12: сторож против необъявленного {@code valid_from} у *Hist.
 *
 * <p>Проверять было что: в ArcadeDB незаявленное свойство схемонезависимо —
 * тип строки решает тот, кто её записал. У {@code KnowTaskHist} объявлен был
 * только {@code valid_to}, и в одной таблице накопилось ЧЕТЫРЕ вида хранения
 * одной даты (замер по проду 04.09.2026, 9400 строк): ISO-8601 UTC — 8523,
 * «через пробел» — 838, только дата — 29, эпоха числом — 10. Обнаружилось это
 * не тестом и не в CI, а потребителем: сессия шлюза miniLORE получила из среза
 * {@code task_done_dates} строку и число вперемешку.
 *
 * <p>Тест чистый, без БД — как {@link LoreSchemaMigrationsTest}. Он не может
 * проверить УЖЕ ЛЕЖАЩИЕ строки (это работа шага V41), он закрывает ровно то,
 * что привело к разнобою: тип, отданный на усмотрение пишущего.
 */
class LoreHistValidFromTypedTest {

    private static final Pattern VERTEX =
        Pattern.compile("CREATE VERTEX TYPE\\s+(\\w*Hist)\\b");
    private static final Pattern PROPERTY =
        Pattern.compile("CREATE PROPERTY\\s+(\\w*Hist)\\.valid_from\\s+IF NOT EXISTS\\s+(\\w+)");

    /**
     * Каждый объявленный в корпусе тип *Hist обязан попасть ровно в один из
     * двух реестров. Новый тип, заведённый мимо обоих, валит этот тест — и это
     * единственный момент, когда о нём ещё можно подумать: после первой записи
     * в него разнобой уже накоплен.
     */
    @Test
    void everyHistTypeIsInExactlyOneRegistry() {
        Set<String> declared = histVertexTypes();
        assertTrue(declared.size() >= 12,
            "типов *Hist найдено подозрительно мало (" + declared.size() + ") — сломан разбор DDL?");

        Set<String> text = new LinkedHashSet<>(LoreSchemaMigrations.HIST_VALID_FROM_TEXT);
        Set<String> temporal = new LinkedHashSet<>(LoreSchemaMigrations.HIST_VALID_FROM_TEMPORAL);

        List<String> missing = new ArrayList<>();
        List<String> both = new ArrayList<>();
        for (String t : declared) {
            boolean inText = text.contains(t);
            boolean inTemporal = temporal.contains(t);
            if (!inText && !inTemporal) missing.add(t);
            if (inText && inTemporal) both.add(t);
        }
        assertEquals(List.of(), missing,
            "тип *Hist без реестра valid_from: " + missing + ". Добавьте его в "
            + "LoreSchemaMigrations.HIST_VALID_FROM_TEXT (текст ISO-8601 UTC — по умолчанию) "
            + "или в HIST_VALID_FROM_TEMPORAL (если valid_from объявлен DATETIME).");
        assertEquals(List.of(), both, "тип *Hist сразу в двух реестрах: " + both);

        List<String> unknown = new ArrayList<>();
        for (String t : text) if (!declared.contains(t)) unknown.add(t);
        for (String t : temporal) if (!declared.contains(t)) unknown.add(t);
        assertEquals(List.of(), unknown,
            "в реестре valid_from числится тип, которого нет в DDL: " + unknown);
    }

    /**
     * Реестры обязаны совпадать с ФАКТИЧЕСКИМИ объявлениями типа: DATETIME
     * только у тех, кто в temporal. Иначе шаг V41 приведёт строки к тексту, а
     * база тут же приведёт их обратно к дате — и разнобой вернётся тихо.
     */
    @Test
    void temporalRegistryMatchesActualDatetimeDeclarations() {
        Set<String> datetime = new LinkedHashSet<>();
        Matcher m = PROPERTY.matcher(sources());
        while (m.find()) {
            if ("DATETIME".equals(m.group(2))) datetime.add(m.group(1));
        }
        assertEquals(new LinkedHashSet<>(LoreSchemaMigrations.HIST_VALID_FROM_TEMPORAL), datetime,
            "HIST_VALID_FROM_TEMPORAL разошёлся с реальными объявлениями DATETIME");
    }

    /** Шаг V42 объявляет свойство ровно по текстовому реестру, без ручного списка. */
    @Test
    void migrationStepDeclaresEveryTextType() {
        LoreSchemaMigrations.Step v42 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 42).findFirst().orElseThrow();
        assertEquals(LoreSchemaMigrations.HIST_VALID_FROM_TEXT.size(), v42.sql().size());
        for (String t : LoreSchemaMigrations.HIST_VALID_FROM_TEXT) {
            assertTrue(v42.sql().contains("CREATE PROPERTY " + t + ".valid_from IF NOT EXISTS STRING"),
                "V42 не объявляет " + t + ".valid_from");
        }
    }

    /** Свежая БД и мигрированная приходят к одной схеме — списки те же. */
    @Test
    void bootstrapDdlMatchesMigrationStep() {
        LoreSchemaMigrations.Step v42 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 42).findFirst().orElseThrow();
        assertEquals(v42.sql(), LoreSchemaInitializer.histValidFromText());
    }

    /**
     * Приведение формы: каждый замеренный на проде вид даёт канонический ISO-Z,
     * канон не переписывается, непонятное не трогается.
     *
     * <p>Значение 1781569369738 здесь не выдуманное — это те самые десять строк
     * SPRINT_SOURCE_IDENTITY/SI-23…SI-32. Ожидаемый ответ 2026-06-16, а не
     * 12.06: отчёт, с которого началась задача, прочитал миллисекунды как
     * секунды. Разрядность проверяется именно поэтому.
     */
    @Test
    void toIsoUtcCoversEveryMeasuredShape() {
        // эпоха миллисекундами — как в десяти строках SI-23…SI-32
        assertEquals("2026-06-16T00:22:49.738Z",
            LoreSchemaMigrationRunner.toIsoUtc(1781569369738L));
        // те же секунды не должны улететь в 58-й тысячелетие
        assertEquals("2026-06-16T00:22:49Z",
            LoreSchemaMigrationRunner.toIsoUtc(1781569369L));
        // «через пробел», секундная и наносекундная точность
        assertEquals("2026-06-11T22:26:41Z",
            LoreSchemaMigrationRunner.toIsoUtc("2026-06-11 22:26:41"));
        assertEquals("2026-06-30T06:24:46.590910794Z",
            LoreSchemaMigrationRunner.toIsoUtc("2026-06-30 06:24:46.590910794"));
        // только дата → полночь UTC
        assertEquals("2026-06-14T00:00:00Z",
            LoreSchemaMigrationRunner.toIsoUtc("2026-06-14"));
        // ISO без зоны → дописываем Z
        assertEquals("2026-06-23T18:19:56.359765139Z",
            LoreSchemaMigrationRunner.toIsoUtc("2026-06-23T18:19:56.359765139"));

        // канон не переписывается — иначе шаг не был бы идемпотентным
        assertNull(LoreSchemaMigrationRunner.toIsoUtc("2026-08-31T12:34:56.789Z"));
        // непонятное не трогаем: пусть останется кривым и видимым, чем будет
        // молча испорчено догадкой
        assertNull(LoreSchemaMigrationRunner.toIsoUtc(""));
        assertNull(LoreSchemaMigrationRunner.toIsoUtc("вчера"));
        assertNull(LoreSchemaMigrationRunner.toIsoUtc("11.06.2026 22:26:41"));
        assertNull(LoreSchemaMigrationRunner.toIsoUtc(null));
    }

    /** Приведение меняет ФОРМУ, а не момент: порядок строк обязан сохраниться. */
    @Test
    void normalizationPreservesOrdering() {
        List<Object> raw = List.of(
            "2026-06-11 15:23:49",
            "2026-06-14",
            1781569369738L,                       // 2026-06-16T00:22:49.738Z
            "2026-06-23T18:19:56.359765139",
            "2026-08-31T12:34:56.789Z");
        List<String> normalized = raw.stream()
            .map(v -> {
                String iso = LoreSchemaMigrationRunner.toIsoUtc(v);
                return iso != null ? iso : String.valueOf(v);
            })
            .toList();
        List<String> sorted = normalized.stream().sorted().toList();
        assertEquals(normalized, sorted,
            "после приведения лексикографический порядок разошёлся с хронологическим");
    }

    /**
     * RM-P17: у каждой цепочки SCD2 обязана быть пара в
     * {@code LoreSlices.HIST_PARENT} — иначе срез {@code history_hygiene}
     * пропустит весь этот тип МОЛЧА, а молчащая гигиена хуже отсутствующей:
     * пустая выдача читается как «дефектов нет».
     *
     * <p>Проверяются оба направления. Лишняя пара без цепочки — тоже дефект:
     * она означает ветку SQL по классу, которого в реестре нет, то есть
     * расхождение двух таблиц об одном (RM-P8).
     */
    @Test
    void everyHistChainHasParentForHygieneSlice() {
        Set<String> chains = new LinkedHashSet<>(LoreSlices.histChains());
        Set<String> parents = new LinkedHashSet<>(LoreSlices.HIST_PARENT.keySet());

        List<String> withoutParent = new ArrayList<>();
        for (String c : chains) if (!parents.contains(c)) withoutParent.add(c);
        assertEquals(List.of(), withoutParent,
            "цепочка *Hist без пары в LoreSlices.HIST_PARENT: " + withoutParent
            + " — срез history_hygiene не увидел бы ни одной её строки");

        List<String> withoutChain = new ArrayList<>();
        for (String p : parents) if (!chains.contains(p)) withoutChain.add(p);
        assertEquals(List.of(), withoutChain,
            "в LoreSlices.HIST_PARENT числится тип, которого нет в реестрах valid_from: "
            + withoutChain);
    }

    private static Set<String> histVertexTypes() {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = VERTEX.matcher(sources());
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /**
     * DDL корпуса как текст. Читаем исходники, а не рефлексию по константам:
     * типы объявляются и в инициализаторе, и в шагах миграций, и вопрос теста
     * ровно в том, не появился ли где-то тип мимо реестра. Путь — тот же, что
     * у {@code NoDeleteEdgeSyntaxTest} и {@code AgentScopeMatrixCoverageTest}.
     */
    private static String sources() {
        Path dir = Path.of("src/main/java/studio/seer/heimdall/lore");
        StringBuilder sb = new StringBuilder();
        for (String f : List.of("LoreSchemaInitializer.java", "LoreSchemaMigrations.java")) {
            try {
                sb.append(Files.readString(dir.resolve(f), StandardCharsets.UTF_8)).append('\n');
            } catch (IOException e) {
                throw new IllegalStateException("не прочитать " + dir.resolve(f).toAbsolutePath()
                    + " — тест обязан запускаться из backend/", e);
            }
        }
        return sb.toString();
    }
}
