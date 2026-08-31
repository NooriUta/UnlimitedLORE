package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Чистая часть контракта записи прогона — без Quarkus и без базы.
 *
 * Зачем отдельно от {@link LoreQgRunContractTest}. Тот проверяет контракт через
 * HTTP, то есть путь эндпоинта. Но писать прогоны теперь могут ДВОЕ: эндпоинт и
 * опрос Forgejo ({@link LoreQgActionsPoller}). Проверка, привязанная к одному
 * входу, доказывала бы контракт только для него — а разошлись бы они молча.
 * Здесь проверяется сама общая функция, независимо от того, кто её позвал.
 */
class LoreQgRunWriterTest {

    private static LoreQgResource.QGRunRequest req(
            String runDate, String channel, List<LoreQgResource.QGMetricEntry> metrics) {
        return new LoreQgResource.QGRunRequest(
            null, "qg-test", runDate, "OK", null, null, null,
            channel, null, null, null, null, metrics);
    }

    private static LoreQgResource.QGMetricEntry metric(String status, String reason) {
        return new LoreQgResource.QGMetricEntry(
            "coverage_pct", 1.0, "pct", 100.0, status, null, reason, null);
    }

    @Test
    void routineNameIsRequired() {
        var r = new LoreQgResource.QGRunRequest(null, null, "2026-08-29", "OK",
            null, null, null, null, null, null, null, null, null);
        assertTrue(LoreQgRunWriter.validate(r).contains("routine_name"));
    }

    /** QG-03: 56 строк из 191 без даты — метрика без даты не встаёт в ряд и не стареет. */
    @Test
    void runDateIsRequired() {
        assertTrue(LoreQgRunWriter.validate(req(null, null, null)).contains("run_date"));
        assertTrue(LoreQgRunWriter.validate(req("  ", null, null)).contains("run_date"));
    }

    /** §4.8: канал — величина из двух значений, иначе «нет коммитов» = «гейт умер». */
    @Test
    void channelMustBeKnown() {
        assertTrue(LoreQgRunWriter.validate(req("2026-08-29", "cron", null)).contains("channel"));
    }

    /** §5: молчаливый SKIP — это и есть разбираемый дефект (35 таких метрик). */
    @Test
    void unmeasuredStatusRequiresTypedReason() {
        assertTrue(LoreQgRunWriter.validate(
            req("2026-08-29", null, List.of(metric("SKIP", null)))).contains("not_measured_reason"));
        assertTrue(LoreQgRunWriter.validate(
            req("2026-08-29", null, List.of(metric("NOT_MEASURED", null)))).contains("not_measured_reason"));
        assertTrue(LoreQgRunWriter.validate(
            req("2026-08-29", null, List.of(metric("NOT_MEASURED", "стенд лежит")))).contains("not_measured_reason"));
    }

    /**
     * ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ (инвариант И-6). Пять проверок выше прошли бы и на
     * функции, которая возвращает отказ на что угодно. Здесь корректные запросы
     * обязаны пройти — иначе проверки доказывают только умение отказывать.
     */
    @Test
    void validRequestsPass() {
        assertNull(LoreQgRunWriter.validate(req("2026-08-29", "actions", null)));
        assertNull(LoreQgRunWriter.validate(req("2026-08-29", "app_job", null)));
        assertNull(LoreQgRunWriter.validate(
            req("2026-08-29", "actions", List.of(metric("PASS", null)))));
        assertNull(LoreQgRunWriter.validate(
            req("2026-08-29", "actions", List.of(metric("NOT_MEASURED", "stand_absent")))));
    }

    /** Заготовка канала 1 обязана сама проходить контракт — иначе опрос писал бы в пустоту. */
    @Test
    void actionsRunHelperSatisfiesTheContract() {
        var ok = LoreQgRunWriter.actionsRun("qg-ci-backend", "2026-08-29", "OK", "PASS",
            1.0, null, "forgejo_run_1", null, null, "https://x/runs/1", "abc", 556);
        assertNull(LoreQgRunWriter.validate(ok));
        assertEquals("actions", ok.channel());
        // модель у канала 1 пуста ОСМЫСЛЕННО: суждения там нет, только факт сборки
        assertNull(ok.model());

        var cancelled = LoreQgRunWriter.actionsRun("qg-ci-backend", "2026-08-29", "PARTIAL",
            "NOT_MEASURED", -1.0, "no_evidence", "forgejo_run_2", null, null, null, null, null);
        assertNull(LoreQgRunWriter.validate(cancelled));
    }

    /** Отмену нельзя записать как «не измерено» без причины — заготовка это не обходит. */
    @Test
    void actionsRunWithoutReasonIsStillRejectedWhenUnmeasured() {
        var bad = LoreQgRunWriter.actionsRun("qg-ci-backend", "2026-08-29", "PARTIAL",
            "NOT_MEASURED", -1.0, null, "forgejo_run_3", null, null, null, null, null);
        assertTrue(LoreQgRunWriter.validate(bad).contains("not_measured_reason"));
    }

    /**
     * Номер PR Forgejo кладёт в head_branch («#556»), отдельного поля нет.
     * Не распознали — null, а не ноль: пустое честно значит «неизвестно».
     */
    @Test
    void prNumberIsParsedFromHeadBranchOrLeftUnknown() {
        assertEquals(556, LoreQgActionsPoller.prNumber(new JsonObject().put("head_branch", "#556")));
        assertNull(LoreQgActionsPoller.prNumber(new JsonObject().put("head_branch", "develop")));
        assertNull(LoreQgActionsPoller.prNumber(new JsonObject().put("head_branch", "#не-число")));
        assertNull(LoreQgActionsPoller.prNumber(new JsonObject()));
    }
}
