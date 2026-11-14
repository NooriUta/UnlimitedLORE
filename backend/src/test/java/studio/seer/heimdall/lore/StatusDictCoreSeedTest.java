package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V90 — базовые статусы в справочниках task_status, sprint_status и adr_status на
 * базе, поднятой с нуля (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE).
 *
 * <p>Находка 14.11.2026 (CT-KIT-FIXTURES): свежая база после всех миграций получала
 * в task_status/sprint_status только waiting/review/uat/failed (V85, V87), а adr_status
 * не получала вовсе. Остальные коды на проде когда-то внесли руками.
 *
 * <p>Главное, что сторожится: сид ДОБАВЛЯЕТ недостающее и НИКОГДА не переписывает
 * существующую строку. На проде все коды уже есть, и шаг обязан быть no-op, а не
 * перекраской прод-значений, как сделал бы UPSERT.
 */
class StatusDictCoreSeedTest {

    private static Set<String> lower(Iterable<String> codes) {
        Set<String> out = new HashSet<>();
        for (String c : codes) out.add(c.toLowerCase(Locale.ROOT));
        return out;
    }

    @Test
    void seedTogetherWithEarlierStepsCoversEveryPlanStatus() {
        Set<String> seeded = StatusDictCoreSeed.CORE.stream().map(StatusDictCoreSeed.Entry::code)
            .collect(Collectors.toCollection(HashSet::new));
        // V85 — uat, V87 — waiting/review/failed.
        seeded.addAll(List.of("uat", "waiting", "review", "failed"));
        assertEquals(LoreResourceBase.PLAN_STATUSES, seeded,
            "каждый статус задачи и спринта обязан иметь строку справочника на базе с нуля");
    }

    @Test
    void adrSeedCoversEveryAdrStatusIgnoringCase() {
        Set<String> seeded = lower(StatusDictCoreSeed.ADR.stream().map(StatusDictCoreSeed.Entry::code).toList());
        assertTrue(seeded.containsAll(LoreResourceBase.ADR_STATUSES),
            "у каждого статуса ADR должна быть строка adr_status: " + LoreResourceBase.ADR_STATUSES + " vs " + seeded);
    }

    @Test
    void seedDoesNotRepeatCodesOwnedByEarlierSteps() {
        for (StatusDictCoreSeed.Entry e : StatusDictCoreSeed.CORE)
            assertFalse(Set.of("uat", "waiting", "review", "failed").contains(e.code()),
                e.code() + " уже заводит V85/V87 — второй источник истины разойдётся");
    }

    @Test
    void planInsertsOnlyMissingAndNeverTouchesExisting() {
        int all = StatusDictCoreSeed.SEEDS.values().stream().mapToInt(List::size).sum();
        assertEquals(all, StatusDictCoreSeed.plan(Map.of()).size(), "на пустой базе — всё, что объявлено");

        Map<String, Set<String>> prod = Map.of(
            "task_status", LoreResourceBase.PLAN_STATUSES,
            "sprint_status", LoreResourceBase.PLAN_STATUSES,
            "adr_status", Set.of("DRAFT", "PROPOSED", "ACCEPTED", "DEFERRED", "DEPRECATED", "SUPERSEDED"));
        assertTrue(StatusDictCoreSeed.plan(prod).isEmpty(), "на проде все коды есть — шаг обязан быть no-op");

        List<StatusDictCoreSeed.Insert> partial = StatusDictCoreSeed.plan(Map.of("task_status", Set.of("todo", "done")));
        assertTrue(partial.stream().noneMatch(i -> i.dictType().equals("task_status")
            && Set.of("todo", "done").contains(i.code())), "существующая строка не вставляется повторно");
        assertEquals(all - 2, partial.size());
    }

    @Test
    void existingLowercaseCodeClosesUppercaseSeedLikeTheModelDoes() {
        List<StatusDictCoreSeed.Insert> p = StatusDictCoreSeed.plan(Map.of("adr_status", Set.of("proposed")));
        assertTrue(p.stream().noneMatch(i -> i.dictType().equals("adr_status") && i.code().equals("PROPOSED")),
            "модель сопоставляет без учёта регистра — дубль PROPOSED рядом с proposed не нужен");
    }

    @Test
    void insertIsPlainInsertWithParamsNotUpsert() {
        String sql = StatusDictCoreSeed.INSERT_SQL.toUpperCase(Locale.ROOT);
        assertTrue(sql.startsWith("INSERT INTO KNOWDICTENTRY"), sql);
        assertFalse(sql.contains("UPSERT"), "UPSERT перезаписал бы прод-значения");
        assertTrue(StatusDictCoreSeed.INSERT_SQL.contains(":code") && StatusDictCoreSeed.INSERT_SQL.contains(":dict_type"),
            "значения — параметрами, не склейкой строки");
    }

    @Test
    void stepNinetyIsRegisteredAsJavaStepWithoutSql() {
        LoreSchemaMigrations.Step s = LoreSchemaMigrations.STEPS.stream()
            .filter(x -> x.version() == 90).findFirst().orElseThrow(() -> new AssertionError("шага V90 нет в реестре"));
        assertEquals("java__status_dict_core_seed", s.name());
        assertTrue(s.sql().isEmpty(), "логика в Java: SQL не умеет «вставить, только если нет» без перезаписи");
    }
}
