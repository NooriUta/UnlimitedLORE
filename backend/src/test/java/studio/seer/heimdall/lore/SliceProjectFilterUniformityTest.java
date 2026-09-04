package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RM-P8: инварианты проектного параметра у слайсов.
 *
 * <p>Три разные вещи в корпусе назывались похоже и потому расходились молча:
 * <ol>
 *   <li>{@link LoreSlices#PROJECT_SCOPED} — RBAC-скоуп ЧТЕНИЯ (кому что видно);</li>
 *   <li>набор слайсов, принимающих параметр {@code project} — это «по чему можно
 *       отфильтровать»;</li>
 *   <li>копия второго списка в MCP ({@code loreRead.ts}), которая подставляет
 *       {@code LORE_ACTIVE_PROJECT}.</li>
 * </ol>
 * Третий список вёлся руками и к моменту разбора отстал: в бэкенде шесть таких
 * слайсов, в MCP числился один. Копия убрана — MCP теперь читает реестр через
 * {@code GET /lore/slices}. Здесь охраняется то, что реестр остаётся пригодным
 * для такого чтения.
 */
class SliceProjectFilterUniformityTest {

    /**
     * Слайсы, у которых {@code project} сверяется НЕ обходом ребра, а плоским
     * строковым полем. Список прибит: у такого слайса нет графа вовсе, и
     * переименование проекта за ним не пройдёт.
     *
     * <p>{@code project_role_events} — журнал выдачи ролей, append-only: событие
     * записано про имя проекта, каким оно было в момент выдачи, и это осмысленно
     * (журнал не переписывают задним числом). Остальным слайсам такое не
     * положено, и новый в этом списке должен появляться осознанно.
     */
    private static final Set<String> FLAT_FIELD_BY_DESIGN = Set.of("project_role_events");

    @Test
    void projectFilterGoesThroughAnEdgeExceptWherePinned() {
        List<String> flat = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            String expr = def.optionalFilters().get("project");
            if (expr == null) continue;
            // Обход ребра — единственный способ, переживающий переименование:
            // slug лежит на вершине KnowGitProject, а не копией в каждой записи.
            if (!expr.contains("BELONGS_TO_PROJECT")) flat.add(id);
        }
        assertEquals(new ArrayList<>(FLAT_FIELD_BY_DESIGN).stream().sorted().toList(),
            flat.stream().sorted().toList(),
            "слайс сверяет project плоским полем вместо обхода ребра: " + flat
            + ". Такой фильтр не переживёт переименования проекта. Либо переведите его на "
            + "out('BELONGS_TO_PROJECT').slug, либо впишите в FLAT_FIELD_BY_DESIGN осознанно.");
    }

    /**
     * MCP выводит набор «умеющих project» из ответа {@code GET /lore/slices},
     * а тот собирается из required + optional. Значит параметр обязан быть
     * ОБЪЯВЛЕН, а не только упомянут в SQL: слайс, который читает {@code :project}
     * втихую, в реестр не попадёт, и подстановки активного проекта не получит —
     * то есть отдаст ЧУЖИЕ данные, выглядящие как свои.
     */
    @Test
    void everySliceMentioningProjectParamDeclaresIt() {
        List<String> undeclared = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            boolean declared = def.required().contains("project")
                || def.optionalFilters().containsKey("project");
            if (def.baseSql().contains(":project") && !declared) undeclared.add(id);
        }
        assertEquals(List.of(), undeclared,
            "слайс читает :project, но не объявляет его ни в required, ни в optional: " + undeclared);
    }

    /**
     * До RM-P8 {@code git_projects} был объявлен ДВАЖДЫ, и побеждало определение
     * без поля {@code is_private}: реестр — {@code LinkedHashMap}, второй
     * {@code put} молча затирал первый. Ошибки не было нигде — слайс есть,
     * отвечает, просто не тем, чего ждёт форма выбора проекта.
     *
     * <p>Структурный сторож теперь в самом {@code slice()}: повторное объявление
     * бросает исключение из статического блока, то есть ловится первым же
     * обращением к классу. Проверить это тестом нельзя — реестр к моменту
     * прогона уже собран, — поэтому здесь проверяется СЛЕДСТВИЕ: победившее
     * определение то, что нужно.
     */
    @Test
    void gitProjectsKeepsTheRicherShape() {
        LoreSlices.SliceDef def = LoreSlices.get("git_projects");
        assertTrue(def != null, "слайс git_projects пропал");
        assertTrue(def.baseSql().contains("is_private"),
            "git_projects обязан отдавать is_private — форма выбора проекта на него смотрит");
    }

    /** Реестр RBAC-скоупа не должен ссылаться на несуществующий слайс. */
    @Test
    void projectScopedTablePointsAtRealSlices() {
        List<String> ghosts = new ArrayList<>();
        for (String id : LoreSlices.PROJECT_SCOPED.keySet()) {
            if (!LoreSlices.ids().contains(id)) ghosts.add(id);
        }
        assertEquals(List.of(), ghosts, "PROJECT_SCOPED ссылается на несуществующие слайсы: " + ghosts);
        assertFalse(LoreSlices.PROJECT_SCOPED.isEmpty(), "таблица скоупа опустела — скоуп перестал что-либо ограничивать");
    }
}
