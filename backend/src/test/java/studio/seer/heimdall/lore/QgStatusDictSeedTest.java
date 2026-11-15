package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V93 (SPRINT_QG_REBUILD/QG-09, ADR-LORE-053-D7): словарь состояний гейта qg_status заводится шагом —
 * справочник правит только человек, а база с нуля должна знать состояния сама.
 */
class QgStatusDictSeedTest {

    @Test
    void словарь_этоРовноСостоянияЖизненногоЦикла() {
        List<String> codes = QgStatusDictSeed.QG.stream().map(StatusDictCoreSeed.Entry::code).toList();
        assertEquals(QgGateLifecycle.STATUSES, codes, "один источник: путь записи и справочник не расходятся");
    }

    @Test
    void пустойСправочник_вставляютсяВсеЧетыре() {
        List<StatusDictCoreSeed.Insert> plan = StatusDictCoreSeed.plan(QgStatusDictSeed.SEEDS, Map.of());
        assertEquals(4, plan.size());
        assertTrue(plan.stream().allMatch(i -> i.dictType().equals("qg_status")));
    }

    @Test
    void существующиеНеТрогаются_безУчётаРегистра() {
        List<StatusDictCoreSeed.Insert> plan = StatusDictCoreSeed.plan(QgStatusDictSeed.SEEDS,
            Map.of("qg_status", Set.of("DRAFT", "active")));
        assertEquals(List.of("stale", "retired"), plan.stream().map(StatusDictCoreSeed.Insert::code).toList());
    }

    @Test
    void шагЗарегистрированИРазобранНаАддитивность() {
        assertTrue(LoreSchemaMigrations.STEPS.stream().anyMatch(s -> s.version() == 93 && s.name().equals(QgStatusDictSeed.STEP)));
        assertTrue(V1SchemaSafetyChecklist.JAVA_STEPS_REVIEWED.containsKey(QgStatusDictSeed.STEP));
    }
}
