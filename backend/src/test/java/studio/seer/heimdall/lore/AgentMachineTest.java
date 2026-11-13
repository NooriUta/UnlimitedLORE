package studio.seer.heimdall.lore;

import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-MACHINE-OBJ — машина в действиях агента.
 *
 * <p>Чистый тест, без БД и без Quarkus: локальный {@code ./gradlew test} с
 * QuarkusTest увёл бы новый шаг миграции в боевую схему.
 */
class AgentMachineTest {

    private static final ChangeAuthor AGENT = new ChangeAuthor("lore-mcp-full_kimi", ChangeAuthor.KIND_AGENT);
    private static final ChangeAuthor HUMAN = new ChangeAuthor("52f6fad5-sub", ChangeAuthor.KIND_HUMAN);

    @Test
    void agentWithMachineHeader_carriesMachine_noWarning() {
        AgentMachine.Verdict v = AgentMachine.judge(AGENT, "  LORCETUS ", false);
        assertEquals("lorcetus", v.machineId());   // PU-18: имя машины канонизируется (регистр)
        assertNull(v.warning());
        assertFalse(v.refuse());
    }

    @Test
    void agentWithoutMachine_softMode_warnsButDoesNotRefuse() {
        AgentMachine.Verdict v = AgentMachine.judge(AGENT, null, false);
        assertNull(v.machineId());
        assertNotNull(v.warning(), "машина не указана — сказать об этом в ответе, не молчать");
        assertTrue(v.warning().contains(AgentMachine.HEADER));
        assertFalse(v.refuse(), "мягкий режим по умолчанию: живые агенты без заголовка не ломаются");
    }

    @Test
    void agentWithoutMachine_hardMode_refuses() {
        AgentMachine.Verdict v = AgentMachine.judge(AGENT, "", true);
        assertTrue(v.refuse());
        assertNotNull(v.warning());
    }

    @Test
    void illegalMachineHeader_isTreatedAsMissing_andSaysWhy() {
        AgentMachine.Verdict v = AgentMachine.judge(AGENT, "pc'; DROP", false);
        assertNull(v.machineId());
        assertTrue(v.warning().contains("недопустим"), v.warning());
    }

    @Test
    void humanAndUnknown_areNotJudged() {
        for (ChangeAuthor a : new ChangeAuthor[]{HUMAN, ChangeAuthor.UNKNOWN}) {
            AgentMachine.Verdict v = AgentMachine.judge(a, null, true);
            assertNull(v.machineId());
            assertNull(v.warning());
            assertFalse(v.refuse(), "человека машиной не гейтим");
        }
    }

    @Test
    void answerFields_agentWithoutMachine_saysMachineNotSpecified() {
        Map<String, Object> f = AgentMachine.answerFields(AgentMachine.judge(AGENT, null, false));
        assertTrue(f.containsKey("machine_id"));
        assertNull(f.get("machine_id"));
        assertNotNull(f.get("machine_warning"));
        assertEquals(Map.of(), AgentMachine.answerFields(AgentMachine.judge(HUMAN, null, false)));
        assertEquals(Map.of("machine_id", "lorcetus"),
            AgentMachine.answerFields(AgentMachine.judge(AGENT, "LORCETUS", false)));
    }

    /** Машина — вершина, агент — рёбрами к ней (ADR-MINILORE-007, поправка 09.11 / ADR-LORE-041). */
    @Test
    void schemaStep_isAdditive_vertexEdgeAndUniqueIndex() {
        var step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.sql() == AgentMachine.SCHEMA_SQL).findFirst()
            .orElseThrow(() -> new AssertionError("шага миграции с AgentMachine.SCHEMA_SQL нет"));
        assertEquals(17, step.compatMajor(), "аддитивно, major 17");
        assertTrue(AgentMachine.SCHEMA_SQL.contains("CREATE VERTEX TYPE KnowMachine IF NOT EXISTS"));
        assertTrue(AgentMachine.SCHEMA_SQL.contains("CREATE EDGE TYPE USES_MACHINE IF NOT EXISTS"));
        assertTrue(AgentMachine.SCHEMA_SQL.contains("CREATE INDEX IF NOT EXISTS ON KnowMachine (machine_id) UNIQUE"));
        for (String ddl : AgentMachine.SCHEMA_SQL)
            assertFalse(ddl.toUpperCase().startsWith("DROP") || ddl.toUpperCase().startsWith("DELETE"), ddl);
    }

    /** Несколько машин у агента: привязка копится, новая машина прежнюю не сносит. */
    @Test
    void linking_isIdempotent_andNeverOverwritesPreviousMachine() {
        String all = String.join("\n", AgentMachine.ENSURE_MACHINE_SQL, AgentMachine.LINK_SQL);
        assertTrue(all.contains("UPSERT WHERE machine_id = :m"), "машина заводится при отсутствии");
        assertTrue(AgentMachine.LINK_SQL.contains("CREATE EDGE USES_MACHINE"));
        assertTrue(AgentMachine.LINK_SQL.contains("IF NOT EXISTS"), "повтор не плодит рёбра");
        assertFalse(all.toUpperCase().contains("DELETE"), "прежняя машина агента не удаляется");
        assertFalse(all.contains("SET machine_id = :m WHERE client_id"), "не поле актора (last-write-wins)");
    }

    @Test
    void agentOwnersSlice_showsAllMachinesOfAgent() {
        String sql = LoreSlices.compose("agent_owners", Map.of()).sql();
        assertTrue(sql.contains("out('USES_MACHINE').machine_id AS machines"), sql);
    }

    @Test
    void hardModeFlag_isListed_offByDefault() {
        var flag = LoreAdminFlags.FLAGS.stream()
            .filter(f -> f.key().equals(AgentMachine.FLAG_REQUIRED)).findFirst()
            .orElseThrow(() -> new AssertionError("флага " + AgentMachine.FLAG_REQUIRED + " нет в админке"));
        assertFalse(flag.def(), "жёсткий отказ — только по явному включению");
    }

    @Test
    void filter_isRegisteredOnBothSides() {
        assertNotNull(AgentMachineFilter.class.getAnnotation(Provider.class));
        assertTrue(ContainerRequestFilter.class.isAssignableFrom(AgentMachineFilter.class), "сторож до записи");
        assertTrue(ContainerResponseFilter.class.isAssignableFrom(AgentMachineFilter.class), "привязка после записи");
    }
}
