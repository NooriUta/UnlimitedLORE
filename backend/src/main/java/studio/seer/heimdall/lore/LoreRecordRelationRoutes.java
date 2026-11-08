package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.List;

/**
 * Один путь привязки/отвязки по (тип, ребро, направление) —
 * {@code POST /lore/record/{type}/{id}/relation} (ADR-LORE-047, допущение A2).
 *
 * <p><b>Новой семантики рёбер нет.</b> Каждый маршрут ведёт в СУЩЕСТВУЮЩИЙ
 * обработчик привязки ({@code sprint/dep}, {@code task/adr}, {@code adr/depends_on},
 * {@code spec/link}, {@code question/raised_in}, …) — те же проверки концов, тот же
 * отказ на цикл, тот же исход ADR-LORE-043. Здесь только таблица «кто обслуживает
 * ребро». {@code reversed} — запись стоит на ДРУГОМ конце ребра: «блокирует» у
 * спринта — это DEPENDS_ON от цели к записи.
 *
 * <p>Таблица чистая (без CDI) — её сверяет юнит-тест с реестром
 * {@link LoreRecordRegistry}: каждое ребро с {@code manageable = true} обязано
 * иметь маршрут, и каждый маршрут — ребро реестра.
 */
final class LoreRecordRelationRoutes {

    private LoreRecordRelationRoutes() {}

    /** Существующий обработчик привязки, в который уходит запрос. */
    enum Handler {
        SPRINT_DEP, SPRINT_PROJECT, SPRINT_COMPONENT, SPRINT_MILESTONE, ADR_SPRINT,
        TASK_COMPONENT, TASK_ADR, TASK_PHASE, TASK_PR,
        QUESTION_RAISED_IN, QUESTION_GATES,
        ADR_DEPENDS_ON, ADR_SUPERSEDES, ADR_COMPONENT, ADR_PROJECT, ADR_TAG,
        SPEC_COMPONENT, SPEC_PROJECT
    }

    record Route(String type, String rel, String dir, Handler handler, boolean reversed) {}

    private static Route r(String type, String rel, String dir, Handler h, boolean reversed) {
        return new Route(type, rel, dir, h, reversed);
    }

    static final List<Route> ROUTES = List.of(
        // спринт
        r("sprint", "DEPENDS_ON", "out", Handler.SPRINT_DEP, false),
        r("sprint", "DEPENDS_ON", "in", Handler.SPRINT_DEP, true),
        r("sprint", "BELONGS_TO_PROJECT", "out", Handler.SPRINT_PROJECT, false),
        r("sprint", "BELONGS_TO", "out", Handler.SPRINT_COMPONENT, false),
        r("sprint", "TARGETS_MILESTONE", "out", Handler.SPRINT_MILESTONE, false),
        r("sprint", "IMPLEMENTED_IN", "in", Handler.ADR_SPRINT, true),
        r("sprint", "RAISED_IN", "in", Handler.QUESTION_RAISED_IN, true),
        // задача
        r("task", "TAGGED_WITH", "out", Handler.TASK_COMPONENT, false),
        r("task", "JUSTIFIED_BY", "out", Handler.TASK_ADR, false),
        r("task", "IN_PHASE", "out", Handler.TASK_PHASE, false),
        r("task", "CLOSED_BY", "out", Handler.TASK_PR, false),
        r("task", "RAISED_IN", "in", Handler.QUESTION_RAISED_IN, true),
        r("task", "GATES", "in", Handler.QUESTION_GATES, true),
        // ADR
        r("adr", "DEPENDS_ON", "out", Handler.ADR_DEPENDS_ON, false),
        r("adr", "DEPENDS_ON", "in", Handler.ADR_DEPENDS_ON, true),
        r("adr", "SUPERSEDES", "out", Handler.ADR_SUPERSEDES, false),
        r("adr", "SUPERSEDES", "in", Handler.ADR_SUPERSEDES, true),
        r("adr", "BELONGS_TO", "out", Handler.ADR_COMPONENT, false),
        r("adr", "BELONGS_TO_PROJECT", "out", Handler.ADR_PROJECT, false),
        r("adr", "TAGGED_WITH", "out", Handler.ADR_TAG, false),
        r("adr", "IMPLEMENTED_IN", "out", Handler.ADR_SPRINT, false),
        r("adr", "JUSTIFIED_BY", "in", Handler.TASK_ADR, true),
        r("adr", "RAISED_IN", "in", Handler.QUESTION_RAISED_IN, true),
        // спека
        r("spec", "BELONGS_TO", "out", Handler.SPEC_COMPONENT, false),
        r("spec", "BELONGS_TO_PROJECT", "out", Handler.SPEC_PROJECT, false)
    );

    /** Маршрут или {@code null}: ребра у типа нет либо путь привязки для него не заведён. */
    static Route find(String type, String rel, String dir) {
        for (Route x : ROUTES)
            if (x.type().equals(type) && x.rel().equals(rel) && x.dir().equals(dir)) return x;
        return null;
    }

    /** Допустимые «REL:dir» типа — для 400 на неизвестное ребро. */
    static List<String> allowed(String type) {
        List<String> out = new ArrayList<>();
        for (Route x : ROUTES) if (x.type().equals(type)) out.add(x.rel() + ":" + x.dir());
        return out;
    }
}
