package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/**
 * Ядро статусов SPRINT_LORE_WORK_ANY_KIND/WK-05 (D-2026-LORE-UNIFIED-WORKFLOW-CORE): восемь статусов
 * для задач и спринтов любого вида работы. Прежние значения — синонимы: данные не мигрируются, токен
 * сводится к ядру при чтении. ready_for_deploy и uat — стадии review (развилка А прототипа, 14.11.2026).
 *
 * <p>Зеркало {@code shared/lore-statuses.json} (core, coreSynonyms) — сверяет LoreWorkflowCoreTest.
 */
final class LoreWorkflowCore {

    private LoreWorkflowCore() {}

    record Synonym(String core, String stage) {}

    static final List<String> CORE =
        List.of("planned", "active", "waiting", "review", "done", "failed", "blocked", "cancelled");

    static final Map<String, Synonym> SYNONYMS = Map.of(
        "todo", new Synonym("planned", null),
        "backlog", new Synonym("planned", null),
        "design", new Synonym("planned", null),
        "deferred", new Synonym("planned", null),
        "partial", new Synonym("active", null),
        "ready_for_deploy", new Synonym("review", "stand_check"),
        "uat", new Synonym("review", "uat"));

    /** Статус ядра для токена; null — токена нет или он не опознан (не выдаём неизвестное за статус). */
    static String core(String token) {
        if (token == null) return null;
        if (CORE.contains(token)) return token;
        Synonym s = SYNONYMS.get(token);
        return s == null ? null : s.core();
    }

    /** Стадия, которую несёт сам старый токен (ready_for_deploy → stand_check), иначе null. */
    static String stage(String token) {
        Synonym s = token == null ? null : SYNONYMS.get(token);
        return s == null ? null : s.stage();
    }
}
