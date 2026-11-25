package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-05 (часть A) — паспорта человека и агента по шаблону «шапка + таблица
 * детей». Паспорт проекта уже вёл на них связями (people → user по kc_sub, agents → agent по
 * actor_id), но паспорта не было: ссылка вела в никуда. Типы — те же имена и ключи.
 */
class PersonAgentPassportTest {

    @Test
    void bothTypesArePassportsAndReadOnly() {
        assertTrue(LoreRecordRegistry.TYPES.contains("user"));
        assertTrue(LoreRecordRegistry.TYPES.contains("agent"));
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("user"), "человека правят в админке, не паспортом");
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("agent"), "агента правят в админке, не паспортом");
    }

    @Test
    void sourcesUseTheKeysProjectLinksAlreadyUse() {
        assertEquals("user_by_id", LoreRecordResource.sourceOf("user").slice());
        assertEquals("kc_sub", LoreRecordResource.sourceOf("user").param());
        assertEquals("agent_by_id", LoreRecordResource.sourceOf("agent").slice());
        assertEquals("id", LoreRecordResource.sourceOf("agent").param());
    }

    @Test
    void childTasksAreOpenRolesOnlyAndProjectScoped() {
        for (String s : List.of("user_tasks", "agent_tasks")) {
            LoreSlices.SliceDef d = LoreSlices.get(s);
            assertNotNull(d, s);
            assertTrue(d.baseSql().contains("ROLE_HELD_BY')[valid_to IS NULL]"), s + ": только открытые роли — " + d.baseSql());
            assertTrue(LoreSlices.PROJECT_SCOPED.containsKey(s), s + ": задачи — под проектным скоупом");
        }
        assertEquals(List.of("kc_sub"), LoreSlices.get("user_tasks").required());
        assertEquals(List.of("id"), LoreSlices.get("agent_tasks").required());
        // AP-PEOPLE-PAGE: «где работает» на вкладке «Аналитика» — проект спринта задачи колонкой среза.
        assertTrue(LoreSlices.get("user_tasks").baseSql().contains("AS project"), LoreSlices.get("user_tasks").baseSql());
        // Решение владельца 25.11.2026 (2а): у агента та же «Аналитика» — и тот же разрез по проектам.
        assertTrue(LoreSlices.get("agent_tasks").baseSql().contains("AS project"), LoreSlices.get("agent_tasks").baseSql());
    }

    /**
     * Решение владельца 25.11.2026 (3а): серверный срез истории статусов по человеку (и по агенту) — для цифр шапки
     * и графика времени цикла. Форма строки та же, что у task_status_versions (её читает flowModel), роль — только
     * открытая, задачи — под проектным скоупом, как у user_tasks.
     */
    @Test
    void statusHistoryByPersonAndAgent() {
        Map<String, String> param = Map.of("user_task_status_versions", "kc_sub", "agent_task_status_versions", "id");
        for (Map.Entry<String, String> e : param.entrySet()) {
            LoreSlices.SliceDef d = LoreSlices.get(e.getKey());
            assertNotNull(d, e.getKey());
            assertEquals(List.of(e.getValue()), d.required(), e.getKey());
            String sql = d.baseSql();
            for (String col : List.of("AS task_uid", "status_raw", "valid_from", "valid_to", "version_kind"))
                assertTrue(sql.contains(col), e.getKey() + ": колонка " + col + " — форма task_status_versions: " + sql);
            assertTrue(sql.contains("FROM KnowTaskHist"), sql);
            assertTrue(sql.contains("ROLE_HELD_BY')[valid_to IS NULL]"), e.getKey() + ": только открытые роли — " + sql);
            assertEquals(LoreSlices.PROJECT_SCOPED.get("task_status_versions"), LoreSlices.PROJECT_SCOPED.get(e.getKey()),
                e.getKey() + ": тот же проектный скоуп, что у task_status_versions");
        }
    }

    @Test
    void tasksTabIsTheChildTable() {
        Map<String, String> user = LoreRecordValues.READ_BY_SLICE.get("user");
        Map<String, String> agent = LoreRecordValues.READ_BY_SLICE.get("agent");
        assertEquals("user_tasks", user.get("tasks"));
        assertEquals("agent_tasks", agent.get("tasks"));
    }

    @Test
    void agentRowIsAnAgentOnly() {
        assertTrue(LoreSlices.get("agent_by_id").baseSql().contains("kind = 'agent'"), "роль продукта (KnowActor kind≠agent) — не агент");
    }

    /**
     * MC-07: человек — в общем меню. Агент — detail (AP-PEOPLE-PAGE, владелица 21.11.2026: «агенты вне админки тоже
     * сделай личная карта — минимум просто чьи они»): не в меню, карточка открывается всем по ссылке; учётка агента —
     * поле уровня admin, сервер её не-админу не отдаёт (LoreFieldAudienceTest).
     */
    @Test
    void peopleInOrganizationMenuAgentsAdminOnly() {
        // Владелица 21.11.2026: «Организация — организации, продукты, проекты, люди» — люди в общем меню (срез users —
        // имя и проекты, без прав и ролей); агент — по-прежнему админка (MC-07, решение 13.11).
        java.util.Map<String, String> audience = LoreModelFile.content().audience();
        assertEquals("everywhere", audience.get("user"), "человек — в общем меню (группа «Организация»)");
        assertEquals("detail", audience.get("agent"), "агент — карточка вне админки по ссылке (AP-PEOPLE-PAGE)");
        List<String> nav = LoreModelNavTest.navSections(LoreModelGoldenTest.modelDoc());
        assertTrue(nav.contains("sprint"), "положительный контроль: меню не пустое");
        assertTrue(nav.contains("user"), "люди в общем меню: " + nav);
        assertFalse(nav.contains("agent"), "агентов нет в общем меню: " + nav);
    }
}
