package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сверка 14.11.2026 (HD-1 в списке «частично», хотя открытая версия ✅ DONE): статус записи —
 * из ОТКРЫТОЙ версии истории. Выражение {@code out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]}
 * берёт версию, вставленную последней, и у задач с дописанной позже старой версией врёт.
 * Сторож: в SQL срезов оно встречается только запасным вариантом внутри
 * {@code COALESCE(<открытая версия>, …)}. Поведение на движке — {@link TaskStatusOpenVersionLiveDbTest}.
 *
 * <p>SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б3 (19.11.2026): то же правило для ВСЕХ полей версии, не только
 * статуса — сверка нашла {@code sprints.priority} и {@code pr_refs} по шаблону {@code [x IS NOT NULL].x[0]}.
 * Перечень полей — из модели: снимок схемы переноса ({@code model-v2-schema/schema-types.json}, типы
 * {@code *Hist}, с прежними именами через {@link ModelSchemaAdapter#RENAMES}) плюс поля, которые установщик
 * держит в старой схеме ({@code held} в {@code scripts/model-migration/schema/sprint-phase-task.json}).
 */
class StatusFromOpenVersionGuardTest {

    private static final String BARE = "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]";
    private static final String OPEN = "out('HAS_STATE')[valid_to IS NULL].status_raw[0]";

    /** Ключи SCD2, а не поля состояния: «первая версия» по ним — дата заведения, а не текущее значение. */
    static final Set<String> SCD2_KEYS = Set.of("valid_from", "valid_to", "state_uid");

    @Test
    void everySliceReadsStatusFromOpenVersionFirst() {
        List<String> bad = new ArrayList<>();
        int checked = 0;
        for (String id : LoreSlices.ids()) {
            String sql = LoreSlices.get(id).baseSql();
            if (!sql.contains(BARE)) continue;
            checked++;
            String rest = sql
                .replace("COALESCE(out('PART_OF')." + OPEN + ", out('PART_OF')." + BARE + ")", "")
                .replace("COALESCE(" + OPEN + ", " + BARE + ")", "");
            if (rest.contains(BARE)) bad.add(id);
        }
        assertTrue(checked > 10, "положительный контроль: срезы со статусом найдены (" + checked + ")");
        assertEquals(List.of(), bad, "срезы берут статус не из открытой версии");
    }

    /** Поля версии по модели (прежние имена, как их читают срезы). */
    static Set<String> versionFields() throws Exception {
        ObjectMapper m = new ObjectMapper();
        Set<String> out = new TreeSet<>();
        Map<String, String> back = new TreeMap<>();
        ModelSchemaAdapter.RENAMES.forEach((old, now) -> back.put(now, old));
        try (InputStream in = StatusFromOpenVersionGuardTest.class.getResourceAsStream("/model-v2-schema/schema-types.json")) {
            assertNotNull(in, "снимок схемы на месте");
            for (var t = m.readTree(in).get("types").fields(); t.hasNext(); ) {
                var e = t.next();
                if (!e.getKey().endsWith("Hist")) continue;
                e.getValue().fieldNames().forEachRemaining(f -> { out.add(f); if (back.containsKey(f)) out.add(back.get(f)); });
            }
        }
        JsonNode types = m.readTree(Path.of("..", "scripts", "model-migration", "schema", "sprint-phase-task.json").toFile()).get("types");
        for (var t = types.fields(); t.hasNext(); ) {
            var e = t.next();
            if (!e.getKey().endsWith("Hist") || e.getValue().get("held") == null) continue;
            e.getValue().get("held").fieldNames().forEachRemaining(out::add);
        }
        out.removeAll(SCD2_KEYS);
        return out;
    }

    @Test
    void everySliceReadsEveryVersionFieldFromOpenVersionFirst() throws Exception {
        Set<String> fields = versionFields();
        assertTrue(fields.contains("priority") && fields.contains("pr_refs") && fields.contains("status_raw"),
            "положительный контроль: перечень полей модели содержит priority, pr_refs, status_raw — " + fields);
        List<String> bad = new ArrayList<>();
        int checked = 0;
        for (String id : LoreSlices.ids()) {
            String sql = LoreSlices.get(id).baseSql();
            for (String f : fields) {
                String bare = "out('HAS_STATE')[" + f + " IS NOT NULL]." + f + "[0]";
                if (!sql.contains(bare)) continue;
                checked++;
                String open = "out('HAS_STATE')[valid_to IS NULL]." + f + "[0]";
                String rest = sql
                    .replace("COALESCE(out('PART_OF')." + open + ", out('PART_OF')." + bare + ")", "")
                    .replace("COALESCE(" + open + ", " + bare + ")", "");
                if (rest.contains(bare)) bad.add(id + "." + f);
            }
        }
        assertTrue(checked > 10, "положительный контроль: чтения полей версии найдены (" + checked + ")");
        assertEquals(List.of(), bad, "срезы берут поле версии не из открытой версии (шаблон [x IS NOT NULL].x[0])");
    }
}
