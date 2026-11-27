package studio.seer.heimdall.lore;

import java.util.Locale;

/**
 * SPRINT_QG_REBUILD/QG-10: единый путь записи связей вехи — {@code POST /lore/milestone/link}.
 *
 * <p>Проект задачи (принят 26.11.2026 вместе с SPEC-QG-ARCHITECTURE / ADR-LORE-065): веха знает, какой компонент
 * она двигает, — ребром {@code TAGGED_WITH} веха → компонент (та же ось, что у гейта §6.1; «общее приложение» —
 * тоже компонент). Новых типов рёбер нет. Проект у вехи своей оси не получает — он приходит через спринты
 * ({@code BELONGS_TO_PROJECT}). Спринт → веха — как было, {@code TARGETS_MILESTONE}; прежний
 * {@code milestone/sprint} — синоним {@code rel=sprint}, не второй путь записи.
 */
final class MilestoneLink {

    private MilestoneLink() {}

    enum Rel { SPRINT, COMPONENT }

    /** rel из запроса; неизвестное — null (дверь отвечает 400 со списком). */
    static Rel rel(String raw) {
        if (raw == null) return null;
        return switch (raw.trim().toLowerCase(Locale.ROOT)) {
            case "sprint" -> Rel.SPRINT;
            case "component" -> Rel.COMPONENT;
            default -> null;
        };
    }

    static final String ALLOWED = "sprint | component";

    static String findComponentEdgeSql() {
        return "SELECT @rid FROM TAGGED_WITH WHERE @out.milestone_id=:mid AND @in.component_id=:cid";
    }

    static String createComponentEdgeSql() {
        return "CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowMilestone WHERE milestone_id=:mid) "
            + "TO (SELECT FROM LoreComponent WHERE component_id=:cid)";
    }
}
