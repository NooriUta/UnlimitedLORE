package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 05.11.2026 (сессия Völva): task_new не принимал effort_days, хотя task/edit
 * то же поле пишет. Задача рождалась без оценки, и чекер качества тут же ставил
 * ей «missing: effort_days». Контракт создания обязан нести поле, а запись —
 * класть его и в вершину, и в первую открытую строку истории (слайсы читают
 * effort_days из HAS_STATE, см. feedback_lore_edit_task_effort_hist).
 */
class TaskCreateEffortDaysTest {

    @Test
    void createRequestCarriesEffortDays() {
        var comp = Arrays.stream(LoreSprintTaskResource.TaskCreateRequest.class.getRecordComponents())
            .filter(c -> c.getName().equals("effort_days"))
            .findFirst();
        assertTrue(comp.isPresent(), "TaskCreateRequest обязан нести effort_days");
        assertEquals(Double.class, comp.get().getType());
    }

    @Test
    void createScriptWritesEffortToVertexAndOpenHist() throws Exception {
        String src = Files.readString(Path.of(
            "src/main/java/studio/seer/heimdall/lore/LoreSprintTaskResource.java"));
        int at = src.indexOf("public Uni<Response> createTask(");
        assertTrue(at > 0, "createTask найден");
        String body = src.substring(at, src.indexOf("@Path(\"task/move\")", at));
        assertTrue(body.contains("INSERT INTO KnowTask SET") && body.contains("effort_days = :eff, order_index"),
            "вершина KnowTask получает effort_days при создании");
        // S2-12: за effort_days в том же SET идёт автор версии (ChangeAuthor.SET_SQL).
        assertTrue(body.contains("valid_from = :now, note_md = :note, effort_days = :eff\").append(ChangeAuthor.SET_SQL)"),
            "открытая KnowTaskHist получает effort_days при создании");
        assertTrue(body.contains("\"eff\", req.effort_days()"), "параметр :eff передан в скрипт");
    }
}
