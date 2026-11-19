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

    /** SPRINT_QG_REBUILD/QG-04: тип гейта — только код словаря qg_type; не прислан — поле не трогаем. */
    @Test
    void typeMustBeActiveDictionaryCode() {
        java.util.List<String> codes = java.util.List.of("code", "cicd", "sec", "know", "doc", "test", "perf", "data", "ops", "ux");
        assertNull(QgGateLifecycle.checkType(null, codes));
        assertNull(QgGateLifecycle.checkType("perf", codes));
        String bad = QgGateLifecycle.checkType("PERF", codes);
        assertNotNull(bad, "регистр не угадываем: код строчный");
        assertTrue(bad.contains("qg_type") && bad.contains("perf"), bad);
        assertNotNull(QgGateLifecycle.checkType("lineage", codes));
    }

    /**
     * SPRINT_QG_REBUILD/QG-01, решение владелицы 19.11.2026 «2а» (D-2026-MIG-118-OWNER-ANSWERS-1119):
     * у гейта явный признак scope. global — общий, без проекта (виден всем и проверяет все проекты);
     * project — привязан ровно к одному проекту. Повод: четыре гейта гигиены LORE были привязаны к
     * NooriUta/UnlimitedLORE, и участник другого проекта их не видел.
     */
    @Test
    void scope_словарьИзДвухЗначений() {
        assertNull(QgGateLifecycle.checkScope(null, false, 0), "scope не прислан — поле не трогаем");
        assertNull(QgGateLifecycle.checkScope("global", false, 0));
        assertNull(QgGateLifecycle.checkScope("project", false, 1));
        String bad = QgGateLifecycle.checkScope("GLOBAL", false, 0);
        assertNotNull(bad, "регистр не угадываем");
        assertTrue(bad.contains("global") && bad.contains("project"), bad);
        assertNotNull(QgGateLifecycle.checkScope("shared", false, 0), "вне словаря — отказ");
    }

    @Test
    void scopeGlobal_сПроектом_отказ() {
        String e = QgGateLifecycle.checkScope("global", true, 1);
        assertNotNull(e, "общий гейт с проектом — противоречие, а не тихое игнорирование project");
        assertTrue(e.contains("project"), e);
    }

    @Test
    void scopeProject_ровноОдинПроект() {
        assertNotNull(QgGateLifecycle.checkScope("project", false, 0), "проектный без проекта — отказ");
        String many = QgGateLifecycle.checkScope("project", false, 2);
        assertNotNull(many, "проектный гейт двух проектов — неоднозначный владелец");
        assertTrue(many.contains("2"), many);
    }

    /** Общий гейт — законный владелец сам по себе: active без проекта разрешён, если scope = global. */
    @Test
    void activeОбщегоГейта_безПроекта_законно() {
        assertNull(QgGateLifecycle.check("active", QgGateLifecycle.hasOwner("global", 0), null));
        assertNotNull(QgGateLifecycle.check("active", QgGateLifecycle.hasOwner("project", 0), null));
        assertNotNull(QgGateLifecycle.check("active", QgGateLifecycle.hasOwner(null, 0), null));
        assertNull(QgGateLifecycle.check("active", QgGateLifecycle.hasOwner(null, 1), null));
        String e = QgGateLifecycle.check("active", false, null);
        assertTrue(e.contains("scope=global"), "текст отказа называет второй законный путь: " + e);
    }
}
