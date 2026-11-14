package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сверка 14.11.2026 (HD-1 в списке «частично», хотя открытая версия ✅ DONE): статус записи —
 * из ОТКРЫТОЙ версии истории. Выражение {@code out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]}
 * берёт версию, вставленную последней, и у задач с дописанной позже старой версией врёт.
 * Сторож: в SQL срезов оно встречается только запасным вариантом внутри
 * {@code COALESCE(<открытая версия>, …)}. Поведение на движке — {@link TaskStatusOpenVersionLiveDbTest}.
 */
class StatusFromOpenVersionGuardTest {

    private static final String BARE = "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]";
    private static final String OPEN = "out('HAS_STATE')[valid_to IS NULL].status_raw[0]";

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
}
