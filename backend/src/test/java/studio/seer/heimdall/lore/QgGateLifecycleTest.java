package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ADR-LORE-053-D7 (SPRINT_QG_REBUILD/QG-09): жизненный цикл гейта на пути записи.
 * Повод: 25 гейтов на проде — 24 `active` (у большинства ни одного прогона) и один со `status = null`;
 * проекта-владельца нет ни у одного. «active» выдавало «заведён» за «работает».
 */
class QgGateLifecycleTest {

    @Test
    void словарьСостояний_строчнойЛатиницей() {
        for (String s : new String[] {"draft", "active", "stale", "retired"})
            assertNull(QgGateLifecycle.check(s, true, "причина"), s);
        assertNotNull(QgGateLifecycle.check("ACTIVE", true, null), "регистр — канон словаря, не «как пришло»");
        assertNotNull(QgGateLifecycle.check("deprecated", true, null), "вне словаря — отказ");
        assertNotNull(QgGateLifecycle.check("", true, null), "пустой код — не состояние");
    }

    @Test
    void activeБезВладельца_отказ() {
        String e = QgGateLifecycle.check("active", false, null);
        assertNotNull(e);
        assertTrue(e.contains("проект"), e);
        assertNull(QgGateLifecycle.check("draft", false, null), "draft без владельца — законно: гейт задуман");
    }

    @Test
    void retiredБезПричины_отказ() {
        assertNotNull(QgGateLifecycle.check("retired", true, null));
        assertNotNull(QgGateLifecycle.check("retired", true, "   "));
        assertNull(QgGateLifecycle.check("retired", false, "отменён: проект закрыт"), "у отменённого владелец не обязателен");
    }

    @Test
    void статусНеПередан_правилаНеПрименяются_аНовыйГейт_draft() {
        assertNull(QgGateLifecycle.check(null, false, null), "правка без статуса не трогает состояние");
        assertEquals("draft", QgGateLifecycle.initialStatus(null));
        assertEquals("active", QgGateLifecycle.initialStatus("active"));
    }
}
