package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Склейка одновременных фильтров слайса — чистый тест, без БД.
 *
 * Поймано владельцем 2026-07-21 на шлюзе: `sprints` с `status` работает,
 * с `project` работает, а вместе — 500. Каждый фрагмент нёс своё « WHERE »,
 * и compose() дописывал их встык: «… WHERE a WHERE b».
 *
 * Ограничение было ИЗВЕСТНО и записано комментарием в коде, но обходилось
 * соглашением «по одному активному фильтру на слайс». Соглашение продержалось
 * ровно до первого, кто передал пару. Поэтому проверка здесь — не на
 * конкретную пару, а на инвариант связки: сколько бы фильтров ни пришло,
 * `WHERE` в результате ровно один.
 */
class LoreSliceComposeFiltersTest {

    private static String sql(String slice, Map<String, String> params) {
        return LoreSlices.compose(slice, params).sql();
    }

    private static int countWhere(String sql) {
        int n = 0, i = 0;
        String upper = sql.toUpperCase(java.util.Locale.ROOT);
        while ((i = upper.indexOf(" WHERE ", i)) >= 0) { n++; i += 7; }
        return n;
    }

    @Test
    void singleFilterStillProducesOneWhere() {
        assertEquals(1, countWhere(sql("sprints", Map.of("status", "%DONE%"))));
        assertEquals(1, countWhere(sql("sprints", Map.of("project", "acme/one"))));
    }

    /** Тот самый случай: пара фильтров обязана дать ОДИН WHERE и AND между условиями. */
    @Test
    void twoFiltersJoinWithAndNotASecondWhere() {
        Map<String, String> both = new LinkedHashMap<>();
        both.put("status", "%DONE%");
        both.put("project", "acme/one");

        String s = sql("sprints", both);
        assertEquals(1, countWhere(s), "второй WHERE = невалидный SQL и 500: " + s);
        assertTrue(s.toUpperCase(java.util.Locale.ROOT).contains(" AND "),
            "условия обязаны соединяться через AND: " + s);
        // Оба условия на месте — склейка не должна терять фильтр.
        assertTrue(s.contains(":status"), "потерян фильтр status: " + s);
        assertTrue(s.contains(":project"), "потерян фильтр project: " + s);
    }

    /**
     * У слайса, чей базовый запрос УЖЕ содержит WHERE, первый фильтр обязан
     * присоединяться через AND. Иначе «починка» пары сломала бы одиночный
     * фильтр там, где раньше всё работало, — а это худший вид регресса.
     */
    @Test
    void baseQueryWithOwnWhereGetsAndNotWhere() {
        String s = sql("features", Map.of("component", "OMILORE"));
        assertEquals(1, countWhere(s), "база уже несёт WHERE — второй недопустим: " + s);
        assertTrue(s.contains(":component"));
    }

    /** Без фильтров запрос не должен обзаводиться пустым WHERE. */
    @Test
    void noFiltersLeaveTheQueryAlone() {
        String s = sql("sprints", Map.of());
        assertEquals(0, countWhere(s), "пустой WHERE на ровном месте: " + s);
        assertFalse(s.toUpperCase(java.util.Locale.ROOT).contains(" AND "), s);
    }

    /** Порядок фильтров не влияет на валидность — WHERE всё равно один. */
    @Test
    void filterOrderDoesNotMatter() {
        Map<String, String> reversed = new LinkedHashMap<>();
        reversed.put("project", "acme/one");
        reversed.put("status", "%DONE%");
        assertEquals(1, countWhere(sql("sprints", reversed)));
    }
}
