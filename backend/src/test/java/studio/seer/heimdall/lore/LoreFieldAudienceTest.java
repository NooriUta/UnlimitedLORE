package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE — видимость на уровне ПОЛЯ модели. Тот же механизм audience, что у
 * раздела (LoreModelNav.LEVELS), обобщён на поле: поле уровня admin сервер не отдаёт не-админу ни в фасаде
 * записи, ни в срезах своего типа. Прятать в интерфейсе нельзя — спрятанное в UI поле видно в ответе.
 * Владелица 21.11.2026: карточка агента вне админки — «без client_id, секретов, ролей и доступов».
 */
class LoreFieldAudienceTest {

    private static Map<String, Object> agentRow() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("actor_id", "AGENT-FULL-x");
        r.put("name", "Claude Code (full)");
        r.put("client_id", "lore-mcp-full");
        r.put("agent_role", "full");
        r.put("harness", "claude");
        r.put("owner", "sub-1");
        r.put("owner_name", "Ann So");
        return r;
    }

    @Test
    void agentAccountIsAnAdminField() {
        LoreRecordRegistry.TypeDef agent = LoreRecordRegistry.get("agent");
        assertEquals("admin", agent.field("client_id").audience(), "учётка агента — только админке");
        for (String open : List.of("title", "agent_role", "harness", "owner", "projects"))
            assertNull(agent.field(open).audience(), open + ": видно всем — карточка агента вне админки");
        // Граница «логин или имя — только его»: служебное поле сверки учётки KC — админке.
        assertEquals("admin", LoreRecordRegistry.get("user").field("name_source").audience());
        assertNull(LoreRecordRegistry.get("user").field("login").audience(), "логин — виден");
    }

    @Test
    void agentCardIsDetailOutsideAdmin() {
        assertEquals("detail", LoreModelFile.content().audience().get("agent"), "карточка агента открывается всем по ссылке");
        List<String> nav = LoreModelNavTest.navSections(LoreModelGoldenTest.modelDoc());
        assertFalse(nav.contains("agent"), "detail — не в общем меню: " + nav);
    }

    @Test
    void fieldLevelOutsideTheSectionLevelsIsAProblem() {
        LoreRecordRegistry.Field bad = new LoreRecordRegistry.Field("x", "X", null, "text", "props", null,
            false, null, false, false, null, null, null, null, null, null, null, null, null, false,
            null, null, null, null, null, null, null, null, false, null, "public");
        LoreRecordRegistry.TypeDef d = new LoreRecordRegistry.TypeDef("t", "T", null, null, List.of(bad),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), null, null);
        List<String> p = LoreFieldAudience.problems(Map.of("t", d));
        assertEquals(1, p.size(), p.toString());
        assertTrue(p.get(0).contains("t.x"), p.toString());
        assertTrue(LoreFieldAudience.problems(LoreModelFile.content().typeDefs()).isEmpty(), "модель чистая");
    }

    @Test
    void viewerGetsNoAdminColumnsAdminGetsAll() {
        for (String slice : List.of("agents", "agent_by_id", "project_agents", "project_bound_agents")) {
            assertEquals("agent", LoreFieldAudience.typeOfSlice(slice), slice);
            for (String role : java.util.Arrays.asList("viewer", "editor", null)) {
                List<Map<String, Object>> out = LoreFieldAudience.stripRows(slice, new ArrayList<>(List.of(agentRow())), role);
                assertFalse(out.get(0).containsKey("client_id"), slice + " · " + role + ": учётка ушла не-админу");
                assertEquals("full", out.get(0).get("agent_role"), "профиль виден");
                assertEquals("Ann So", out.get(0).get("owner_name"), "владелец виден");
            }
            for (String role : List.of("admin", "superadmin"))
                assertEquals("lore-mcp-full", LoreFieldAudience.stripRows(slice, List.of(agentRow()), role).get(0).get("client_id"),
                    slice + " · " + role + ": админке — всё");
        }
        // Чужой срез не трогается.
        assertEquals("lore-mcp-full", LoreFieldAudience.stripRows("sprints", List.of(agentRow()), "viewer").get(0).get("client_id"));
        Map<String, Object> u = new LinkedHashMap<>(Map.of("kc_sub", "s", "display_name", "Ann", "login", "ann", "name_source", "kc"));
        Map<String, Object> got = LoreFieldAudience.stripRows("user_by_id", List.of(u), "viewer").get(0);
        assertFalse(got.containsKey("name_source"));
        assertEquals("ann", got.get("login"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void recordFacadeDropsAdminFieldsForViewer() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("values", new LinkedHashMap<>(Map.of("title", "Claude Code (full)", "client_id", "lore-mcp-full", "agent_role", "full")));
        out.put("unmodeled", new LinkedHashMap<>(Map.of("client_id", "lore-mcp-full", "machine_id", "LEGION")));
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("fields", new ArrayList<>(List.of(Map.of("key", "client_id"), Map.of("key", "agent_role"))));
        Map<String, Object> layout = new LinkedHashMap<>();
        layout.put("props", new ArrayList<>(List.of(new LinkedHashMap<>(Map.of("fields", List.of("client_id", "agent_role"))))));
        schema.put("layout", layout);
        out.put("schema", schema);
        LoreFieldAudience.stripRecord("agent", out, "viewer");
        assertEquals(Map.of("title", "Claude Code (full)", "agent_role", "full"), out.get("values"));
        assertEquals(Map.of("machine_id", "LEGION"), out.get("unmodeled"));
        List<Map<String, Object>> fields = (List<Map<String, Object>>) ((Map<String, Object>) out.get("schema")).get("fields");
        assertEquals(List.of("agent_role"), fields.stream().map(f -> f.get("key")).toList());
        Map<String, Object> sec = ((List<Map<String, Object>>) layout.get("props")).get(0);
        assertEquals(List.of("agent_role"), sec.get("fields"));

        Map<String, Object> adm = new LinkedHashMap<>();
        adm.put("values", new LinkedHashMap<>(Map.of("client_id", "lore-mcp-full")));
        LoreFieldAudience.stripRecord("agent", adm, "admin");
        assertEquals("lore-mcp-full", ((Map<String, Object>) adm.get("values")).get("client_id"));
    }

    @Test
    void facetOrFilterOnAnAdminColumnIsRefused() {
        assertEquals("client_id", LoreFieldAudience.closedParam("agents", List.of("harness", "client_id"), "viewer"));
        assertNull(LoreFieldAudience.closedParam("agents", List.of("harness", "client_id"), "admin"));
        assertNull(LoreFieldAudience.closedParam("agents", List.of("harness"), "viewer"));
    }

    /**
     * Решение владельца 25.11.2026 (развилка 1б, «1 вопрос агента согласовано рекомендация»): учётку агента в срезе
     * agent_owners видят только admin/superadmin и служебный читатель miniLORE. Связка miniLORE MachineOwners /
     * WriterGate читает из строки client_id (машина ли это: префикс minilore-link-), machine_id и owner_kc_sub —
     * служебному читателю они должны дойти как есть, иначе машинам закроется запись.
     */
    @Test
    void agentOwnersClientIdOnlyForAdminAndMiniloreServiceReader() {
        assertFalse(LoreFieldAudience.EXEMPT_SLICES.containsKey("agent_owners"), "больше не открытая дыра");
        assertEquals("agent", LoreFieldAudience.typeOfSlice("agent_owners"));
        assertTrue(LoreFieldAudience.SERVICE_READER_SLICES.contains("agent_owners"));
        java.util.function.Supplier<Map<String, Object>> machine = () -> new LinkedHashMap<>(Map.of(
            "actor_id", "minilore-link-LEGION", "client_id", "minilore-link-LEGION", "machine_id", "LEGION",
            "owner_kc_sub", List.of("sub-ann"), "name", "LEGION"));
        Map<String, Object> viewer = LoreFieldAudience.stripRows("agent_owners", List.of(machine.get()), "viewer", false).get(0);
        assertFalse(viewer.containsKey("client_id"), "обычному вошедшему учётка не уходит");
        assertEquals("LEGION", viewer.get("machine_id"));
        // Служебный читатель miniLORE (роль viewer, но клиент из lore.scope.read-all-clients): контракт MachineOwners цел.
        Map<String, Object> svc = LoreFieldAudience.stripRows("agent_owners", List.of(machine.get()), "viewer", true).get(0);
        assertEquals("minilore-link-LEGION", svc.get("client_id"), "MachineOwners отличает машину по префиксу client_id");
        assertEquals("LEGION", svc.get("machine_id"));
        assertEquals(List.of("sub-ann"), svc.get("owner_kc_sub"));
        assertEquals("minilore-link-LEGION",
            LoreFieldAudience.stripRows("agent_owners", List.of(machine.get()), "admin", false).get(0).get("client_id"));
        // Служебный читатель не открывает учётку на поверхностях записи — только в своих служебных срезах.
        assertFalse(LoreFieldAudience.stripRows("agents", List.of(agentRow()), "viewer", true).get(0).containsKey("client_id"));
        // Опознание — тем же списком, что у AL-91 (служебный читатель всего корпуса), точным совпадением.
        assertTrue(LoreFieldAudience.serviceReader("lore-reader-minilore", "lore-reader-minilore"));
        assertFalse(LoreFieldAudience.serviceReader("lore-reader-minilore-x", "lore-reader-minilore"));
        assertFalse(LoreFieldAudience.serviceReader(null, "lore-reader-minilore"));
    }

    /**
     * Сторож CI: каждый срез, который ОТДАЁТ колонкой поле уровня admin, либо отнесён к типу этого поля (и тогда
     * колонку срезает {@link LoreFieldAudience#stripRows}), либо сам админский (ADMIN_ONLY), либо в явном списке
     * исключений с причиной. Новый срез с client_id мимо фильтра здесь не пройдёт.
     */
    @Test
    void everyAdminFieldColumnIsClosedOrExplicitlyExempt() {
        int found = 0;
        List<String> holes = new ArrayList<>();
        for (Map.Entry<String, LoreRecordRegistry.TypeDef> e : LoreModelFile.content().typeDefs().entrySet())
            for (LoreRecordRegistry.Field f : e.getValue().fields()) {
                if (!"admin".equals(f.audience()) && !"hidden".equals(f.audience())) continue;
                for (String col : LoreFieldAudience.columnsOf(e.getKey(), f.key())) {
                    Pattern sel = Pattern.compile("(?i)(\\bAS\\s+" + col + "\\b)|((SELECT|,)\\s*" + col + "\\s*(,|\\s+FROM\\b))");
                    for (String id : LoreSlices.ids()) {
                        if (!sel.matcher(LoreSlices.get(id).baseSql()).find()) continue;
                        found++;
                        if (LoreSlices.ADMIN_ONLY.contains(id)) continue;
                        if (e.getKey().equals(LoreFieldAudience.typeOfSlice(id))) continue;
                        if (LoreFieldAudience.EXEMPT_SLICES.containsKey(id)) continue;
                        holes.add(id + " отдаёт " + e.getKey() + "." + f.key() + " (колонка " + col + ")");
                    }
                }
            }
        assertTrue(found >= 4, "положительный контроль: client_id отдают agents, agent_by_id, … — нашлось " + found);
        assertTrue(holes.isEmpty(), "поле уровня admin уходит не-админу:\n" + String.join("\n", holes));
        for (Map.Entry<String, String> x : LoreFieldAudience.EXEMPT_SLICES.entrySet())
            assertFalse(x.getValue().isBlank(), x.getKey() + ": исключение без причины");
    }
}
