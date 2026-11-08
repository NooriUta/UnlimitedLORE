package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 08.11.2026, классификаторы задач в v2: список спринтов v2 берёт задачи ПАКЕТОМ
 * (tasks_of_sprints_batch), а паспорт спринта — по одному (tasks_of_sprint). Пакет
 * отставал: в нём не было work_class (ЗАЧЕМ-ось, ADR-LORE-022) и realizes_uc, и в
 * строке задачи списка/доски нечем было показать плашку UC/JTD/ENB, как в паспорте v1.
 * Правило: пакетный срез отдаёт КАЖДОЕ поле одиночного (плюс свой sprint_id).
 *
 * Чистый юнит: LoreSlices — статический реестр, Quarkus и БД не нужны.
 */
class TasksBatchSliceParityTest {

    /** Имена колонок SELECT: алиас после AS или голое имя поля; ROLE_HOLDERS разворачивается. */
    private static Set<String> columns(String sql) {
        String select = sql.substring(sql.indexOf("SELECT") + 6, sql.indexOf(" FROM "));
        Set<String> out = new LinkedHashSet<>();
        for (String part : select.split(",(?![^()]*\\))")) {
            String p = part.trim();
            Matcher as = Pattern.compile("(?i)\\bAS\\s+(\\w+)\\s*$").matcher(p);
            if (as.find()) out.add(as.group(1));
            else if (p.matches("\\w+")) out.add(p);
        }
        return out;
    }

    @Test
    void batchReturnsEveryColumnOfSingleSprintSlice() {
        Set<String> single = columns(LoreSlices.get("tasks_of_sprint").baseSql());
        Set<String> batch = columns(LoreSlices.get("tasks_of_sprints_batch").baseSql());
        assertTrue(single.contains("work_class") && single.contains("realizes_uc"),
            "контроль разбора: в tasks_of_sprint есть work_class и realizes_uc, нашли " + single);
        for (String c : single) {
            assertTrue(batch.contains(c),
                "tasks_of_sprints_batch обязан отдавать поле «" + c + "», как tasks_of_sprint; есть " + batch);
        }
    }
}
