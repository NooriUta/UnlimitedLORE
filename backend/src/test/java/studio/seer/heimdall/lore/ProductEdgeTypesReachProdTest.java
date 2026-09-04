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
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сторож: новый тип ребра, объявленный только в bootstrap-DDL, до прода не
 * доезжает.
 *
 * <p>{@link LoreSchemaInitializer} гейтится флагом {@code lore.bootstrap}
 * (default false, и в compose тоже {@code ${LORE_BOOTSTRAP:-false}}) — на общей
 * боевой БД он пропускается целиком. Единственная дверь туда — миграции. В
 * ArcadeDB {@code CREATE EDGE} по необъявленному типу тип не заводит, а падает,
 * поэтому «объявил в инициализаторе» для нового ребра значит «работает только
 * на свежей БД».
 *
 * <p>Так уже произошло: PR #598 объявил {@code IN_PRODUCT} и
 * {@code PARENT_PRODUCT} только в инициализаторе, и вся продуктовая ось после
 * промоушна отвечала бы ошибкой на каждую запись — а искали бы причину в
 * деплое. Добор — шаг V43.
 *
 * <p>Тест чистый, без БД.
 */
class ProductEdgeTypesReachProdTest {

    private static final Pattern EDGE_TYPE =
        Pattern.compile("CREATE EDGE TYPE\\s+([A-Za-z_][A-Za-z0-9_]*)");

    /**
     * Рёбра, живущие только в bootstrap-DDL ЗАКОННО: они заведены на боевой
     * БД out-of-band до появления реестра миграций (см. «SV-06: DDL сессий
     * 2026-07 задним числом» над LoreSchemaMigrations.STEPS). Переносить их в
     * шаги задним числом смысла нет — они там уже есть.
     *
     * <p>Список ПРИБИТ намеренно, как срез слайсов в {@code SliceSqlDumpTest}:
     * добавление нового ребра мимо миграций меняет множество и валит тест. Тот,
     * кто добавляет, обязан либо завести шаг, либо осознанно дописать имя сюда.
     */
    private static final Set<String> LEGACY_BOOTSTRAP_ONLY = Set.of(
        "E",                        // базовый тип, от него наследуются остальные
        "BELONGS_TO_PROJECT", "CHANGED_IN", "ClRoutineHasOutput", "DECIDED_IN",
        "DEPENDS_ON", "DOCUMENTED_IN", "DOC_CHILD_OF", "FORMALIZED_AS",
        "FOR_VARIANT", "GATES", "HAS_ASSET", "HAS_STATE", "HAS_STATUS",
        "HAS_VARIANT", "IMPLEMENTED_IN", "IMPLEMENTED_IN_RELEASE", "INCLUDES",
        "IN_CHANNEL", "IN_PHASE", "IN_RUBRIC", "LED_TO", "MEASURED_BY",
        "OF_TYPE", "ON_MILESTONE", "PARENT_OF", "PART_OF", "PRODUCED",
        "PRODUCED_BY", "PROMOTED_TO", "REFERENCES_ADR", "RELEASED_IN",
        "SHIPPED_IN", "SUPERSEDES", "TAGGED_WITH", "TARGETS_KEY",
        "TARGETS_PAGE", "USES", "VALIDATES", "YIELDED");

    @Test
    void everyNewEdgeTypeAlsoHasAMigrationStep() {
        Set<String> inInitializer = edgeTypes(read("LoreSchemaInitializer.java"));
        Set<String> inMigrations = edgeTypes(read("LoreSchemaMigrations.java"));

        assertTrue(inInitializer.size() > 40,
            "типов рёбер в инициализаторе подозрительно мало (" + inInitializer.size()
            + ") — сломан разбор DDL?");

        Set<String> bootstrapOnly = new TreeSet<>(inInitializer);
        bootstrapOnly.removeAll(inMigrations);

        List<String> unexpected = new ArrayList<>(bootstrapOnly);
        unexpected.removeAll(LEGACY_BOOTSTRAP_ONLY);
        assertEquals(List.of(), unexpected,
            "тип ребра объявлен только в LoreSchemaInitializer: " + unexpected
            + ". На проде bootstrap-DDL выключен (lore.bootstrap=false), туда ведут только "
            + "миграции — заведите шаг «CREATE EDGE TYPE … IF NOT EXISTS» (образец: V22, V43). "
            + "Если ребро заведомо уже есть на боевой БД, впишите его в LEGACY_BOOTSTRAP_ONLY "
            + "осознанно.");

        List<String> goneFromInitializer = new ArrayList<>(LEGACY_BOOTSTRAP_ONLY);
        goneFromInitializer.removeAll(bootstrapOnly);
        assertEquals(List.of(), goneFromInitializer,
            "имя числится в LEGACY_BOOTSTRAP_ONLY, но ребра там больше нет: " + goneFromInitializer
            + ". Прибитый список протух — почистите.");
    }

    /**
     * Шаг миграции НЕ имеет права писать «EXTENDS E».
     *
     * <p>Стоило выката 04.09.2026: V43 упал с {@code Supertype 'E' not found},
     * приложение отказалось стартовать, docker перезапускал контейнер по кругу,
     * стенд лежал. Базовый тип {@code E} объявляет только
     * {@link LoreSchemaInitializer}, а он на боевой БД выключен
     * ({@code lore.bootstrap=false}) — то есть E там просто нет, и все рёбра,
     * заведённые миграциями, живут без супертипа (V22 {@code IN_AREA},
     * V39 {@code ROLE_HELD_BY}).
     *
     * <p>Инициализатору {@code EXTENDS E} писать МОЖНО и нужно: он сам же
     * создаёт E строкой выше, на свежей БД супертип осмыслен. Запрет ровно на
     * шаги миграций — там его создателя нет.
     */
    @Test
    void migrationStepsDoNotExtendTheBaseEdgeType() {
        List<String> offenders = new ArrayList<>();
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            for (String sql : s.sql()) {
                if (sql.matches("(?s).*\\bEXTENDS\\s+E\\b.*")) {
                    offenders.add("V" + s.version() + ": " + sql);
                }
            }
        }
        assertEquals(List.of(), offenders,
            "шаг миграции пишет EXTENDS E, а на боевой БД базового типа E нет — "
            + "старт приложения упадёт с «Supertype 'E' not found» и контейнер уйдёт в перезапуск. "
            + "Пишите просто «CREATE EDGE TYPE X IF NOT EXISTS» (образцы: V22, V39, V43): " + offenders);
    }

    /** Рёбра продуктовой оси — именно они и были потеряны, проверяем поимённо. */
    @Test
    void productAxisEdgesAreInMigrations() {
        Set<String> inMigrations = edgeTypes(read("LoreSchemaMigrations.java"));
        for (String edge : List.of("IN_PRODUCT", "PARENT_PRODUCT")) {
            assertTrue(inMigrations.contains(edge),
                edge + " не объявлен ни в одном шаге миграций — на прод не доедет");
        }
    }

    private static Set<String> edgeTypes(String src) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = EDGE_TYPE.matcher(src);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    private static String read(String file) {
        Path p = Path.of("src/main/java/studio/seer/heimdall/lore", file);
        try {
            return Files.readString(p, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("не прочитать " + p.toAbsolutePath()
                + " — тест обязан запускаться из backend/", e);
        }
    }
}
