package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-29 (приёмка препрода 14.11.2026): в меню статуса задачи нет «Ждём ответа»,
 * «На приёмке», «Неуспех», хотя сервер их принимает (PLAN_STATUSES, WK-05) и словарь task_status их знает
 * (V87). Корень: жизненный цикл задачи/спринта (LoreRecordPerms.lifecycle) их не содержал, и модель
 * отдавала их «вне цикла — перейти нельзя», а status_next паспорта — без них.
 *
 * Правило: цикл задачи и спринта покрывает ВСЁ, что принимает POST /lore/status, и модель предлагает
 * переход в каждый такой статус.
 */
class LoreLifecycleCoversStatusesTest {

    @Test
    void lifecycleCoversEveryAcceptedPlanStatus() {
        for (String type : List.of("task", "sprint")) {
            TreeSet<String> missing = new TreeSet<>(LoreResourceBase.PLAN_STATUSES);
            missing.removeAll(LoreRecordPerms.lifecycle(type, null));
            assertEquals(new TreeSet<>(), missing, type + ": статусы, которые сервер принимает, но цикл не знает");
        }
    }

    @Test
    void wk05StatusesAreOfferedAsTransitions() {
        @SuppressWarnings("unchecked")
        List<String> next = (List<String>) LoreRecordPerms.of("task", "admin", true, "active", 0).get("status_next");
        assertTrue(next.containsAll(List.of("waiting", "review", "failed")), "status_next из «в работе»: " + next);
    }
}
