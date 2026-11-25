package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT, решение владельца 6в: починить запись {@code KnowMachine.last_seen_at}.
 *
 * <p>Находка 1 прототипа: AgentMachineFilter запоминал пару «учётка + машина» после первой привязки ({@code linked}) и
 * дальше НЕ трогал машину вовсе — отметка {@code last_seen_at} становилась «первой записью после рестарта сервера»,
 * а не последней (прод 23.11: lorcetus 22.11 15:46 при действиях до 22:04). Теперь после записи агента отметка
 * обновляется и у уже привязанной пары, не чаще раза в {@link AgentMachine#TOUCH_EVERY} на машину — чтобы не писать
 * на каждый вызов.
 */
class AgentMachineSeenTest {

    private static final Instant T0 = Instant.parse("2026-11-22T15:46:00Z");

    @Test
    void новая_пара_заводит_машину_ставит_ребро_и_отметку() {
        List<String> sql = AgentMachine.afterWrite(false, null, T0);
        assertEquals(List.of(AgentMachine.ENSURE_MACHINE_SQL, AgentMachine.FIRST_SEEN_SQL, AgentMachine.LINK_SQL), sql);
        assertTrue(AgentMachine.ENSURE_MACHINE_SQL.contains("last_seen_at"), "заведение ставит и отметку");
    }

    @Test
    void привязанная_пара_всё_равно_обновляет_отметку() {
        // Корень: раньше привязанная пара не писала НИЧЕГО — отметка застывала до рестарта.
        assertEquals(List.of(AgentMachine.TOUCH_SQL), AgentMachine.afterWrite(true, null, T0),
            "пара привязана, отметки в этом процессе ещё не было — отметка пишется");
        assertEquals(List.of(AgentMachine.TOUCH_SQL),
            AgentMachine.afterWrite(true, T0, T0.plus(AgentMachine.TOUCH_EVERY)),
            "прошло окно — отметка пишется снова");
        assertTrue(AgentMachine.TOUCH_SQL.contains("last_seen_at = :now"), AgentMachine.TOUCH_SQL);
        assertTrue(AgentMachine.TOUCH_SQL.contains("last_seen_at < :now"), "отметка не едет назад: " + AgentMachine.TOUCH_SQL);
        assertFalse(AgentMachine.TOUCH_SQL.contains("UPSERT"), "отметка не заводит машин — только трогает существующую");
    }

    @Test
    void чаще_окна_отметка_не_пишется() {
        assertEquals(List.of(), AgentMachine.afterWrite(true, T0, T0.plusSeconds(5)),
            "внутри окна — без записи: отметка не стоит отдельного запроса на каждый вызов");
    }
}
