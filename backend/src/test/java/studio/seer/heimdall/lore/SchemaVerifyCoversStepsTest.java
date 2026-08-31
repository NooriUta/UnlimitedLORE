package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Материальная сверка схемы обязана покрывать то, что шаги СОЗДАЮТ
 * (DBU-02 / SELF-PROVISION-VERIFY-GAP).
 *
 * <p>Ledger пишется отдельной командой ПОСЛЕ шага, не атомарно с ним. Шаг, чья
 * часть сделала no-op или прервалась, оставляет «версия записана, объектов
 * нет» — и приложение стартует на битой схеме, считая её актуальной. Ровно это
 * вылезло на чужой установке: восемь слайсов отдавали 500, словарь был пуст.
 *
 * <p>Сверка есть, но список проверяемых типов ведётся РУКОЙ и содержит шесть
 * имён, тогда как шаги создают на два порядка больше. Рукой ведомый список
 * отстаёт молча: тип, добавленный новым шагом, в него не попадает, и его
 * пропажа снова становится незаметной. Это тот же класс, что «две правды об
 * одном факте», только одна из правд — забывчивость.
 *
 * <p>Тест сверяет список с САМИМИ ШАГАМИ и потому не может отстать.
 */
class SchemaVerifyCoversStepsTest {

    /** {@code CREATE VERTEX TYPE X} / {@code CREATE EDGE TYPE X} — с IF NOT EXISTS и без. */
    private static final Pattern CREATE_TYPE = Pattern.compile(
        "(?i)CREATE\\s+(?:VERTEX|EDGE|DOCUMENT)\\s+TYPE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?`?(\\w+)`?");

    /**
     * Типы, которых на здоровой АКТУАЛЬНОЙ базе быть не должно, хотя шаг их
     * когда-то создавал: позже другой шаг их растворил и удалил. Включение
     * такого имени в сверку роняло бы старт ложно.
     *
     * <p>Список именной и с причиной у каждой строки — исключение обязано быть
     * решением, а не тихой строкой.
     */
    private static final Set<String> DROPPED_LATER = Set.of(
        // V6 создаёт, V13 растворяет в KnowUseCase и дропает (mergeFeaturesIntoUseCases).
        "KnowFeature",
        // Служебная вершина реестра версий: создаётся раннером до шагов, к
        // продуктовой схеме отношения не имеет.
        "LoreSchemaVersion");

    private static Set<String> typesCreatedBySteps() {
        Set<String> types = new LinkedHashSet<>();
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            for (String sql : s.sql()) {
                Matcher m = CREATE_TYPE.matcher(sql);
                while (m.find()) types.add(m.group(1));
            }
        }
        types.removeAll(DROPPED_LATER);
        return types;
    }

    /**
     * Контроль самого разбора: если регулярка перестанет находить объявления,
     * следующая проверка станет зелёной на пустом множестве — и «покрыто всё»
     * будет означать «не посмотрели ни на что».
     */
    @Test
    void theParserActuallyFindsTypes() {
        Set<String> found = typesCreatedBySteps();
        assertTrue(found.size() >= 43,
            "разбор шагов нашёл всего " + found.size() + " типов при замеренных 43 — регулярка перестала совпадать, "
            + "и проверка ниже потеряла смысл");
        assertTrue(found.contains("KnowUseCase") && found.contains("ROLE_HELD_BY"),
            "разбор не видит заведомо существующие типы: " + found.size() + " найдено");
    }

    /**
     * Каждый тип, создаваемый шагами, обязан быть под сверкой.
     *
     * <p>Иначе пропажа объекта ловится только у шести имён из списка, а у
     * остальных выглядит как исправная работа до первого запроса.
     */
    @Test
    void everyTypeCreatedByStepsIsVerifiedAtStartup() {
        List<String> unverified = new ArrayList<>();
        for (String t : typesCreatedBySteps()) {
            if (!LoreSchemaMigrations.requiredLiveTypes().contains(t)) unverified.add(t);
        }
        assertEquals(List.of(), unverified,
            "шаги создают " + unverified.size() + " типов, которых нет в материальной сверке: "
            + "их пропажа не уронит старт и обнаружится только запросом в рантайме — "
            + unverified);
    }

    /** Список сверки не должен упоминать то, чего шаги не создают. */
    @Test
    void verificationListHasNoPhantoms() {
        Set<String> created = typesCreatedBySteps();
        List<String> phantoms = LoreSchemaMigrations.requiredLiveTypes().stream()
            .filter(t -> !created.contains(t))
            .toList();
        assertEquals(List.of(), phantoms,
            "сверка требует типы, которых ни один шаг не создаёт — старт упадёт на здоровой базе: "
            + phantoms);
    }
}
