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

    /** MC-07: человек и агент — уровень admin; в общее меню не попадают, паспорт открывается по чипу. */
    @Test
    void peopleAndAgentsAreAdminAudienceNotInTheSharedMenu() {
        java.util.Map<String, String> audience = LoreModelFile.content().audience();
        assertEquals("admin", audience.get("user"), "человек — админка (MC-07, решение 13.11)");
        assertEquals("admin", audience.get("agent"), "агент — админка (MC-07, решение 13.11)");
        List<String> nav = LoreModelNavTest.navSections(LoreModelGoldenTest.modelDoc());
        assertTrue(nav.contains("sprint"), "положительный контроль: меню не пустое");
        assertFalse(nav.contains("user") || nav.contains("agent"), "людей и агентов нет в общем меню: " + nav);
    }
}
