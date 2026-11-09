package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-05 · S7B-09 · S7B-13 — массовая смена ролей человека,
 * чистая часть: план «было → станет» по каждому проекту (дифф для одного
 * подтверждения на N) и обратный пакет (undo) для отката всей пачки.
 *
 * <p>Изменение: {@code {project, role}} — выдать/сменить, {@code {project, action:"remove"}} — снять.
 */
final class LoreRoleBatch {

    private LoreRoleBatch() {}

    /** Изменений за один вызов (у человека до 23 проектов на проде — с запасом). */
    static final int MAX = 200;

    static String error(List<Map<String, Object>> changes) {
        if (changes == null || changes.isEmpty()) return "changes required";
        if (changes.size() > MAX) return "more than " + MAX + " changes per call";
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < changes.size(); i++) {
            Map<String, Object> c = changes.get(i);
            Object p = c == null ? null : c.get("project");
            if (!(p instanceof String ps) || ps.isBlank()) return "changes[" + i + "]: project required";
            if (!LoreResourceBase.SAFE_ID.matcher(ps).matches()) return "changes[" + i + "]: project contains illegal characters";
            if (!seen.add(ps)) return "changes[" + i + "]: project " + ps + " appears twice";
            boolean remove = "remove".equals(c.get("action"));
            if (!remove && (!(c.get("role") instanceof String r) || r.isBlank()))
                return "changes[" + i + "]: role required unless action=remove";
        }
        return null;
    }

    /** План: kind = grant | update | remove | unchanged; before/after — роль до и после. */
    static List<Map<String, Object>> plan(Map<String, String> current, List<Map<String, Object>> changes) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> c : changes) {
            String project = String.valueOf(c.get("project"));
            String before = current.get(project);
            boolean remove = "remove".equals(c.get("action"));
            String after = remove ? null : String.valueOf(c.get("role"));
            String kind;
            if (remove) kind = before == null ? "unchanged" : "remove";
            else if (before == null) kind = "grant";
            else kind = before.equals(after) ? "unchanged" : "update";
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("project", project);
            m.put("before", before);
            m.put("after", remove ? null : after);
            m.put("kind", kind);
            // Kit 2 (K2-DIFF): знак строки и состояние проверки ПО СТРОКЕ. Текущие роли
            // прочитаны из графа одним запросом — значит каждая строка «проверено».
            m.put("sign", switch (kind) { case "grant" -> "+"; case "remove" -> "−"; case "update" -> "~"; default -> "="; });
            m.put("check", Map.of("state", "checked", "source", "graph"));
            out.add(m);
        }
        return out;
    }

    /** Kit 2 (K2-BATCH-UNDO): окно, в которое пачку можно отменить одним вызовом. */
    static final java.time.Duration UNDO_WINDOW = java.time.Duration.ofMinutes(15);

    private static final java.util.regex.Pattern BATCH_ID = java.util.regex.Pattern.compile("^rb-([0-9]{13})-[0-9a-f]{8}$");

    /** Идентификатор пачки: время применения зашито в id — окно отмены проверяется без хранилища. */
    static String batchId(java.time.Instant at) {
        return "rb-" + String.format("%013d", at.toEpochMilli()) + "-"
            + String.format("%08x", java.util.concurrent.ThreadLocalRandom.current().nextInt());
    }

    static java.time.Instant undoUntil(String batchId) {
        java.util.regex.Matcher m = batchId == null ? null : BATCH_ID.matcher(batchId);
        if (m == null || !m.matches()) return null;
        return java.time.Instant.ofEpochMilli(Long.parseLong(m.group(1))).plus(UNDO_WINDOW);
    }

    /** Причина отказа в отмене или null. */
    static String undoError(String batchId, java.time.Instant now) {
        java.time.Instant until = undoUntil(batchId);
        if (until == null) return "undo_of: не идентификатор пачки (" + batchId + ")";
        if (now.isAfter(until)) return "undo_of: окно отмены пачки " + batchId + " закрыто в " + until;
        return null;
    }

    /** Обратный пакет: вернуть «было» для всего, что пакет меняет. */
    static List<Map<String, Object>> undo(List<Map<String, Object>> plan) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> p : plan) {
            String kind = String.valueOf(p.get("kind"));
            if ("unchanged".equals(kind)) continue;
            Object before = p.get("before");
            out.add(before == null
                ? Map.of("project", p.get("project"), "action", "remove")
                : Map.of("project", p.get("project"), "role", before));
        }
        return out;
    }
}
