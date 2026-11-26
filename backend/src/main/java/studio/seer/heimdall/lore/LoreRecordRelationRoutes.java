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
        // MDL-13: одна связь «зависит от» задачи, фазы, спринта и вехи — путь dep (LoreDependency).
        DEPENDS_ON, SPRINT_PROJECT, SPRINT_COMPONENT, SPRINT_MILESTONE, ADR_SPRINT,
        // MDL-13 «треки б»: трек спринта — ребро ON_TRACK через sprint/plan.
        SPRINT_TRACK,
        TASK_COMPONENT, TASK_ADR, TASK_PHASE, TASK_PR,
        QUESTION_RAISED_IN, QUESTION_GATES,
        ADR_DEPENDS_ON, ADR_SUPERSEDES, ADR_COMPONENT, ADR_PROJECT, ADR_TAG,
        SPEC_COMPONENT, SPEC_PROJECT,
        // S5-DOC-PASSPORT: компонент и проекты документа — штатные doc/component, doc/project.
        DOC_COMPONENT, DOC_PROJECT,
        // AP-PROJECT-LINK-UI: проекты решения, вопроса и ранбука — штатные decision/project, question/project, runbook/project.
        DECISION_PROJECT, QUESTION_PROJECT, RUNBOOK_PROJECT,
        // Решение владелицы 19.11.2026: связи организации — один путь organization/link (super-admin).
        ORG_LINK,
        // AP-PASSPORT-EDIT (1б): ценность фичи — feature/link (ADDRESSES · PROMISES · HELPS_WITH);
        // профиль клиента — vp/link (FELT_BY · DESIRED_BY · PERFORMED_BY · BLOCKS · SUCCESS_OF).
        FEATURE_VALUE, VP_LINK
    }

    record Route(String type, String rel, String dir, Handler handler, boolean reversed) {}

    private static Route r(String type, String rel, String dir, Handler h, boolean reversed) {
        return new Route(type, rel, dir, h, reversed);
    }

    static final List<Route> ROUTES = List.of(
        // спринт
        r("sprint", "DEPENDS_ON", "out", Handler.DEPENDS_ON, false),
        r("sprint", "DEPENDS_ON", "in", Handler.DEPENDS_ON, true),
        r("sprint", "BELONGS_TO_PROJECT", "out", Handler.SPRINT_PROJECT, false),
        r("sprint", "BELONGS_TO", "out", Handler.SPRINT_COMPONENT, false),
        r("sprint", "TARGETS_MILESTONE", "out", Handler.SPRINT_MILESTONE, false),
        r("sprint", "ON_TRACK", "out", Handler.SPRINT_TRACK, false),
        r("sprint", "IMPLEMENTED_IN", "in", Handler.ADR_SPRINT, true),
        r("sprint", "RAISED_IN", "in", Handler.QUESTION_RAISED_IN, true),
        // задача
        r("task", "TAGGED_WITH", "out", Handler.TASK_COMPONENT, false),
        r("task", "JUSTIFIED_BY", "out", Handler.TASK_ADR, false),
        r("task", "IN_PHASE", "out", Handler.TASK_PHASE, false),
        r("task", "CLOSED_BY", "out", Handler.TASK_PR, false),
        r("task", "RAISED_IN", "in", Handler.QUESTION_RAISED_IN, true),
        r("task", "GATES", "in", Handler.QUESTION_GATES, true),
        r("task", "DEPENDS_ON", "out", Handler.DEPENDS_ON, false),
        r("task", "DEPENDS_ON", "in", Handler.DEPENDS_ON, true),
        // веха (MDL-13, смоук 21.11.2026: «Готово, когда» — ставить и снимать зависимость и у вехи): статус и создание
        // только чтение, а «зависит от» — тот же путь dep (LoreDependency принимает веху концом), что у задачи и спринта
        r("milestone", "DEPENDS_ON", "out", Handler.DEPENDS_ON, false),
        r("milestone", "DEPENDS_ON", "in", Handler.DEPENDS_ON, true),
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
        r("spec", "BELONGS_TO_PROJECT", "out", Handler.SPEC_PROJECT, false),
        // документ (S5-DOC-PASSPORT)
        r("doc", "BELONGS_TO", "out", Handler.DOC_COMPONENT, false),
        r("doc", "BELONGS_TO_PROJECT", "out", Handler.DOC_PROJECT, false),
        // решение, вопрос, ранбук (AP-PROJECT-LINK-UI) — добавить и снять по одному проекту, набор не заменяется
        r("decision", "BELONGS_TO_PROJECT", "out", Handler.DECISION_PROJECT, false),
        r("question", "BELONGS_TO_PROJECT", "out", Handler.QUESTION_PROJECT, false),
        r("runbook", "BELONGS_TO_PROJECT", "out", Handler.RUNBOOK_PROJECT, false),
        // организация (D-2026-MIG-REPOSITORY-ORGANIZATION) — проекты, продукты, люди, репозитории (21.11)
        r("organization", "ORG_HAS_PROJECT", "out", Handler.ORG_LINK, false),
        r("organization", "ORG_HAS_PRODUCT", "out", Handler.ORG_LINK, false),
        r("organization", "ORG_MEMBER", "out", Handler.ORG_LINK, false),
        r("organization", "ORG_HAS_REPOSITORY", "out", Handler.ORG_LINK, false),
        // AP-PASSPORT-EDIT (1б): «+ боль / + выгода / + работа» во вкладках фичи и роли — и привязка с обоих концов.
        r("feature", "ADDRESSES", "out", Handler.FEATURE_VALUE, false),
        r("feature", "PROMISES", "out", Handler.FEATURE_VALUE, false),
        r("feature", "HELPS_WITH", "out", Handler.FEATURE_VALUE, false),
        r("pain", "ADDRESSES", "in", Handler.FEATURE_VALUE, true),
        r("gain", "PROMISES", "in", Handler.FEATURE_VALUE, true),
        r("job", "HELPS_WITH", "in", Handler.FEATURE_VALUE, true),
        r("pain", "FELT_BY", "out", Handler.VP_LINK, false),
        r("gain", "DESIRED_BY", "out", Handler.VP_LINK, false),
        r("job", "PERFORMED_BY", "out", Handler.VP_LINK, false),
        r("actor", "FELT_BY", "in", Handler.VP_LINK, true),
        r("actor", "DESIRED_BY", "in", Handler.VP_LINK, true),
        r("actor", "PERFORMED_BY", "in", Handler.VP_LINK, true),
        r("pain", "BLOCKS", "out", Handler.VP_LINK, false),
        r("job", "BLOCKS", "in", Handler.VP_LINK, true),
        r("gain", "SUCCESS_OF", "out", Handler.VP_LINK, false),
        r("job", "SUCCESS_OF", "in", Handler.VP_LINK, true)
    );

    /** Ребро ценности фичи → rel пути feature/link; null — не ребро ценности. */
    static String featureRel(String edge) {
        return switch (edge) {
            case "ADDRESSES" -> "pain";
            case "PROMISES" -> "gain";
            case "HELPS_WITH" -> "job";
            default -> null;
        };
    }

    /** Ребро профиля клиента → rel пути vp/link (его словарь — строчными). */
    static String vpRel(String edge) {
        return switch (edge) {
            case "FELT_BY", "DESIRED_BY", "PERFORMED_BY", "BLOCKS", "SUCCESS_OF" -> edge.toLowerCase(java.util.Locale.ROOT);
            default -> null;
        };
    }

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
