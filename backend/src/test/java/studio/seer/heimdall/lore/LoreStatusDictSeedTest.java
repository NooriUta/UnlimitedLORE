package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-24: релиз v1.17.18 добавил статус {@code uat} в жизненный цикл
 * задач И спринтов (код), а строки словарей статусов — это данные, и ни одна миграция их не
 * заводила. На проде {@code task_status/uat} кто-то завёл руками, {@code sprint_status/uat} — нет:
 * модель отдала статью без цвета и значка, kit показал «оговорки модели» над списком «Спринты».
 *
 * <p>Правило (обобщение частного случая): у КАЖДОГО статуса из жизненного цикла задачи и спринта
 * в словаре своего типа есть строка с цветом и значком. Проверяется на снимке словарей прода
 * ({@code model-golden/dict.json}) и на сиде миграции — новый статус в коде без строки словаря
 * роняет сборку, а не всплывает предупреждением у пользователя.
 */
class LoreStatusDictSeedTest {

    static final Map<String, String> DICT_OF = Map.of("task", "task_status", "sprint", "sprint_status");

    @Test
    void уКаждогоСтатусаЖизненногоЦикла_естьСтрокаСловаряСЦветомИЗначком() {
        List<Map<String, Object>> rows = LoreModelGoldenTest.dictRows();
        List<String> missing = new ArrayList<>();
        DICT_OF.forEach((type, dict) -> {
            for (String code : LoreRecordPerms.lifecycle(type, null)) {
                Map<String, Object> row = rows.stream()
                    .filter(r -> dict.equals(r.get("dict_type")) && code.equals(r.get("code")))
                    .findFirst().orElse(null);
                if (row == null) { missing.add(dict + "/" + code + " — строки нет"); continue; }
                if (blank(row.get("color"))) missing.add(dict + "/" + code + " — нет цвета");
                if (blank(row.get("icon"))) missing.add(dict + "/" + code + " — нет значка");
            }
        });
        assertTrue(missing.isEmpty(), "словарь статусов не покрывает жизненный цикл: " + missing);
    }

    @Test
    void миграцияЗасеваетUat_вОбаСловаря_темЖеЦветомИЗначком_чтоKit() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("status_dict_uat_seed"))
            .findFirst().orElse(null);
        assertNotNull(step, "нет шага миграции status_dict_uat_seed");
        for (String dict : DICT_OF.values()) {
            String sql = step.sql().stream()
                .filter(s -> s.contains("dict_type='" + dict + "'") && s.contains("code='uat'"))
                .findFirst().orElse(null);
            assertNotNull(sql, "шаг не засевает " + dict + "/uat");
            assertTrue(sql.contains("UPSERT"), "сид обязан быть идемпотентным (UPSERT): " + sql);
            // Тот же цвет и значок, что в kit (statusMeta.ts: uat → stamper, --st-uat).
            assertTrue(sql.contains("color='var(--st-uat)'"), sql);
            assertTrue(sql.contains("icon='stamper'"), sql);
            assertTrue(sql.contains("sort_order=55"), "uat стоит между RFD (50) и done (60): " + sql);
            assertTrue(sql.contains("is_active=true"), sql);
        }
    }

    @Test
    void шагАддитивный_старыйБинарьЖивёт() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("status_dict_uat_seed")).findFirst().orElseThrow();
        assertTrue(step.compatMajor() <= 17, "сид словаря не повод поднимать ось несовместимости");
        assertFalse(step.sql().stream().anyMatch(s -> s.toUpperCase().startsWith("DELETE")),
            "сид ничего не удаляет");
    }

    private static boolean blank(Object o) {
        return o == null || String.valueOf(o).isBlank();
    }
}
