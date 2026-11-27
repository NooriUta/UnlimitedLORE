package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AP-08 (SPRINT_LORE_ADMIN_POLISH/AP-08, найдено автотестом RBAC на препроде 15.11.2026, кейс AD-01):
 * админские журналы — сбои и подключения MCP, действия агентов и админки, входы и сессии,
 * телеметрия обращений, матрица ролей — отдавались ЛЮБОМУ вошедшему: viewer открывал админку и
 * видел «0 отказов» вместо «нет прав». Гейт роли — на сервере, а не только в UI.
 */
class AdminOnlySlicesGateTest {

    private static final List<String> JOURNALS = List.of(
        "mcp_failures", "mcp_failure_rows", "mcp_connections", "agent_actions", "admin_actions",
        "logins_recent", "logins_by_user", "sessions_recent", "requests_by_caller", "requests_total", "role_matrix",
        "agent_action_points", "session_coverage", "query_errors");

    /** Паспорт машины (AP-MACHINE-PASSPORT): только админка; отдаёт client_id агентов — поле уровня admin (AP-PEOPLE-PAGE). */
    private static final List<String> ADMIN_PASSPORTS = List.of("machine_by_id", "machines_graph",
        // KREG-13: паспорта служебных типов — только админка (сессия агента — слово владельца 26.11).
        "agent_session_by_id", "kind_by_id", "know_kinds");

    @Test
    void журналыЗакрытыДляНеАдминов() {
        for (String id : JOURNALS) {
            assertTrue(LoreSlices.get(id) != null, "срез существует: " + id);
            for (String role : new String[] {null, "", "viewer", "reader", "editor", "developer"}) {
                assertTrue(LoreSlices.adminOnlyDenied(id, role), id + " для роли " + role);
            }
        }
    }

    @Test
    void паспортМашиныЗакрытДляНеАдминов() {
        for (String id : ADMIN_PASSPORTS) {
            assertTrue(LoreSlices.get(id) != null, "срез существует: " + id);
            for (String role : new String[] {null, "", "viewer", "reader", "editor", "developer"})
                assertTrue(LoreSlices.adminOnlyDenied(id, role), id + " для роли " + role);
            assertFalse(LoreSlices.adminOnlyDenied(id, "admin"), id);
        }
    }

    @Test
    void админуИСуперадминуОткрыты() {
        for (String id : JOURNALS) {
            assertFalse(LoreSlices.adminOnlyDenied(id, "admin"), id);
            assertFalse(LoreSlices.adminOnlyDenied(id, "superadmin"), id);
        }
    }

    @Test
    void обычныеСрезыГейтНеТрогает() {
        // Положительный контроль: проектные срезы для viewer не закрываются этим гейтом (их режет скоуп).
        for (String id : List.of("sprints", "tasks_of_sprint", "adrs", "dictionary", "project_users")) {
            assertFalse(LoreSlices.adminOnlyDenied(id, "viewer"), id);
        }
    }

    @Test
    void сторож_любойСрезСПометкойАдминскийИлиЖурналЗакрыт() {
        // Обобщение (правило: частный фикс → правило): новый срез, помеченный в списке исключений
        // скоупа как админский журнал или телеметрия, без гейта роли не проходит.
        LoreSlices.SCOPE_PENDING.forEach((id, why) -> {
            String w = why.toLowerCase();
            if (w.contains("админск") || w.contains("журнал") || w.contains("телеметри")) {
                assertTrue(LoreSlices.ADMIN_ONLY.contains(id), "срез " + id + " помечен «" + why + "», а гейта роли нет");
            }
        });
        assertEquals(JOURNALS.size() + ADMIN_PASSPORTS.size(), LoreSlices.ADMIN_ONLY.size(), "состав ADMIN_ONLY: " + LoreSlices.ADMIN_ONLY);
    }
}
