package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Паритет полей проекта: что ПОКАЗЫВАЕТ паспорт — то и можно ЗАПИСАТЬ (слово владелицы 22.11.2026:
 * «добавляй, и проверь паритет полей и MCP»).
 *
 * <p><b>Повод.</b> Она попросила переименовать короткий код проекта MIGGEN → UDWE. Оказалось, что записать его
 * нечем: {@code entity_upsert type=project} поле {@code short_code} не принимает (ответ честно сказал «поля нет,
 * не записано»), а паспорт проекта в вебе — только для чтения: {@code project} нет в {@code PASSPORT_TYPES}.
 * То есть поле видно во всех выдачах, объявлено в фасаде записи — и недоступно ни человеку, ни агенту.
 *
 * <p><b>Правило, которое держит этот тест.</b> Каждое поле проекта, которое фасад записи отдаёт в паспорт
 * ({@link LoreRecordFrom}), обязано либо приниматься дверью записи ({@code POST /lore/project}), либо стоять
 * в списке вычисляемых ниже — с причиной. Третьего не дано: поле, которое показывают и не дают изменить,
 * выглядит как недоработка интерфейса, а на деле это дыра в двери.
 */
class ProjectFieldParityTest {

    /**
     * Поля паспорта проекта, которые дверь НЕ принимает намеренно.
     * <ul>
     *   <li>{@code title} — вычисляется из name/slug (Transform.FIRST_OF), своего места в базе нет;</li>
     *   <li>{@code code} — это сам slug, ключ записи: меняется не правкой поля, а заведением другого проекта;</li>
     *   <li>{@code short_title} — вычисляется из short_title/name/slug;</li>
     *   <li>{@code aliases} — собираются из адресов репозиториев, а не задаются руками.</li>
     * </ul>
     */
    static final Set<String> COMPUTED = Set.of("title", "code", "short_title", "aliases");

    /** Поля, которые фасад отдаёт в паспорте проекта. */
    static Set<String> passportFields() {
        return LoreRecordFrom.VALUES.get("project").stream()
            .map(LoreRecordFrom.Val::key)
            .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    /** Поля, которые принимает дверь записи. */
    static Set<String> doorFields() {
        return Arrays.stream(LoreProjectResource.ProjectCreateRequest.class.getRecordComponents())
            .map(RecordComponent::getName)
            .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    @Test
    void каждое_поле_паспорта_либо_записывается_либо_объявлено_вычисляемым() {
        Set<String> door = doorFields();
        List<String> orphans = passportFields().stream()
            .filter(f -> !door.contains(f) && !COMPUTED.contains(f))
            .toList();
        org.junit.jupiter.api.Assertions.assertEquals(List.of(), orphans,
            "поля проекта показываются, но записать их нечем — ни человеку (паспорт проекта только для чтения), "
                + "ни агенту (дверь их не принимает): " + orphans);
    }

    @Test
    void короткий_код_принимается_дверью_иначе_переименовать_проект_нечем() {
        org.junit.jupiter.api.Assertions.assertTrue(doorFields().contains("short_code"),
            "short_code — то самое поле, из-за которого 22.11.2026 пришлось просить владелицу");
    }

    @Test
    void список_вычисляемых_не_прячет_настоящие_поля() {
        // Положительный контроль: каждое имя из COMPUTED действительно есть в паспорте. Иначе список
        // превратится в свалку, которой можно заглушить любое расхождение.
        Set<String> p = passportFields();
        for (String c : COMPUTED)
            org.junit.jupiter.api.Assertions.assertTrue(p.contains(c), "в паспорте проекта нет поля " + c);
    }
}
