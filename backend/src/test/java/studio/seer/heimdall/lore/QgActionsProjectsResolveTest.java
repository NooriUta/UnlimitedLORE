package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-DICT-UPSERT-DUP: что опрашивать в Actions, задаёт гейт канала Actions и его
 * проект (ребро BELONGS_TO_PROJECT, QG-01), а не строка-список в справочнике. Решение владелицы 21.11.2026
 * «перевязать не к репозиторию, а к проекту, они схлопнутся», выбор владельца 23.11.2026 — вариант «а»:
 * гейт QG-LORE-CI-ACTIONS с ребром на проект; настройка {@code qg.actions_projects} удаляется.
 *
 * <p>Гейт канала Actions узнаётся по рутине {@code qg-actions-poll}: поле {@code routine_name} или строка
 * «**Routine:** `qg-actions-poll`» в тексте гейта (как {@link QgMetricState#routineOf}).
 *
 * <p>Чистая функция резолва, без Quarkus и без базы.
 */
class QgActionsProjectsResolveTest {

    private static Map<String, Object> gate(String id, String status, String contentMd, String routine, List<String> projects) {
        Map<String, Object> m = new HashMap<>();
        m.put("qg_id", id);
        m.put("status", status);
        m.put("content_md", contentMd);
        m.put("routine_name", routine);
        m.put("projects", projects);
        return m;
    }

    private static final String MARK = "**Routine:** `" + LoreQgActionsPoller.ACTIONS_ROUTINE + "`";

    private static LoreQgActionsPoller.Projects resolve(List<Map<String, Object>> gates, String config) {
        return LoreQgActionsPoller.resolveProjects(gates, config);
    }

    @Test
    void проект_берётся_из_гейта_канала_actions() {
        var r = resolve(List.of(gate("QG-LORE-CI-ACTIONS", "active", MARK, null, List.of("NooriUta/UnlimitedLORE"))), null);
        assertEquals(List.of("NooriUta/UnlimitedLORE"), r.projects());
        assertTrue(r.source().contains("QG-LORE-CI-ACTIONS"), r.source());
        assertTrue(r.rejected().isEmpty());
    }

    @Test
    void рутина_полем_routine_name_тоже_признак() {
        var r = resolve(List.of(gate("QG-AIDA-CI-ACTIONS", "active", null, "qg-actions-poll", List.of("NooriUta/AIDA"))), null);
        assertEquals(List.of("NooriUta/AIDA"), r.projects());
    }

    @Test
    void чужие_и_снятые_гейты_не_в_счёт() {
        var r = resolve(List.of(
            gate("QG-AIDA-ARCH", "active", "**Routine:** `qg-aida-arch`", null, List.of("NooriUta/AIDA")),
            gate("QG-OLD-CI-ACTIONS", "retired", MARK, null, List.of("NooriUta/volva"))), null);
        assertTrue(r.projects().isEmpty(), r.toString());
        assertEquals(LoreQgActionsPoller.SOURCE_NONE, r.source());
    }

    @Test
    void несколько_гейтов_проекты_без_повторов() {
        var r = resolve(List.of(
            gate("QG-A", "active", MARK, null, List.of("NooriUta/UnlimitedLORE")),
            gate("QG-B", "active", MARK, null, List.of("NooriUta/AIDA", "NooriUta/UnlimitedLORE"))), null);
        assertEquals(List.of("NooriUta/UnlimitedLORE", "NooriUta/AIDA"), r.projects());
    }

    @Test
    void гейт_без_проекта_назван_честно() {
        var r = resolve(List.of(gate("QG-LORE-CI-ACTIONS", "active", MARK, null, List.of())), null);
        assertTrue(r.projects().isEmpty());
        assertEquals(1, r.rejected().size());
        assertTrue(r.rejected().get(0).contains("QG-LORE-CI-ACTIONS") && r.rejected().get(0).contains("не привязан проект"),
            r.rejected().toString());
    }

    @Test
    void без_гейта_конфиг_как_прежде_иначе_не_привязан_проект() {
        var c = resolve(List.of(), "NooriUta/UnlimitedLORE");
        assertEquals(List.of("NooriUta/UnlimitedLORE"), c.projects());
        assertEquals(LoreQgActionsPoller.SOURCE_CONFIG, c.source());

        var none = resolve(List.of(), " ");
        assertTrue(none.projects().isEmpty());
        assertEquals(LoreQgActionsPoller.SOURCE_NONE, none.source());
        assertTrue(none.source().contains("не привязан проект"), none.source());
    }

    @Test
    void настройки_справочника_больше_нет() throws Exception {
        // строка-список в справочнике держала две строки на один ключ — источник дефекта; опросчик её не читает
        String src = new String(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(
            "src/main/java/studio/seer/heimdall/lore/LoreQgActionsPoller.java")), java.nio.charset.StandardCharsets.UTF_8);
        assertFalse(src.contains("app_setting"), "опросчик не должен читать app_setting");
        assertFalse(src.contains("qg.actions_projects"), "ключа настройки в опросчике быть не должно");
    }

    @Test
    void зеркало_названо_но_не_опрашивается() {
        assertEquals(List.of("github.com/NooriUta/UnlimitedLORE — зеркало, Actions не опрашиваются"),
            LoreQgActionsPoller.mirrorNotes(List.of("https://github.com/NooriUta/UnlimitedLORE")));
        assertTrue(LoreQgActionsPoller.mirrorNotes(java.util.Arrays.asList(null, " ")).isEmpty());
    }

    /**
     * 15.11.2026: на проде за два захода в журнале не появилось ни строчки — молчат и успешный проход, и
     * проход, не увидевший источник. Строка захода называет источник списка и итог по каждому проекту и зеркалу.
     */
    @Test
    void строка_захода_называет_источник_и_итог() {
        var p = resolve(List.of(gate("QG-LORE-CI-ACTIONS", "active", MARK, null, List.of("NooriUta/UnlimitedLORE"))), null);
        String line = LoreQgActionsPoller.passLine(p, List.of(
            "NooriUta/UnlimitedLORE: записано прогонов 7 из 30",
            "github.com/NooriUta/UnlimitedLORE — зеркало, Actions не опрашиваются"));
        assertTrue(line.contains("QG-LORE-CI-ACTIONS"), line);
        assertTrue(line.contains("проектов 1"), line);
        assertTrue(line.contains("записано прогонов 7 из 30"), line);
        assertTrue(line.contains("зеркало, Actions не опрашиваются"), line);

        String empty = LoreQgActionsPoller.passLine(resolve(List.of(), ""), List.of());
        assertTrue(empty.contains(LoreQgActionsPoller.SOURCE_NONE), empty);
        assertTrue(empty.contains("записей канала 1 не будет"), empty);
    }
}
