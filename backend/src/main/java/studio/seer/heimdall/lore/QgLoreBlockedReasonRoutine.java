package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Гейт QG-LORE-BLOCKED-REASON рутиной канала 2 (SPRINT_QG_REBUILD/QG-01; проверки —
 * QG-16, QG-17). До этого гейт был текстом «прогони query_slice и запиши qg_run_log»
 * и не имел ни одного прогона.
 *
 * <p>Пять информационных проверок, цель у каждой 0, превышение — WARN (релиз не
 * блокирует):
 * <ol>
 *   <li>{@code blocked_unexplained} — спринт заблокирован, а нет ни причины, ни
 *       зависимости, ни открытого вопроса;</li>
 *   <li>{@code blocked_stale_deps} — зависимости есть, но все уже закрыты;</li>
 *   <li>{@code blocked_empty_shell} — заблокирован и в нём ноль задач;</li>
 *   <li>{@code backlog_status_mismatch} — в названии «backlog», а статус blocked или в работе;</li>
 *   <li>{@code questions_gating_closed_tasks} — открытый вопрос держит закрытую задачу.</li>
 * </ol>
 */
@ApplicationScoped
public class QgLoreBlockedReasonRoutine implements QgRoutine {

    static final String NAME = "qg-lore-blocked-reason";

    @Inject
    LoreIngestService ingest;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        List<Map<String, Object>> blocked = QgSliceCounts.rows(ingest, NAME, "blocked_sprints_reason");
        List<Map<String, Object>> sprints = QgSliceCounts.rows(ingest, NAME, "sprints");
        List<Map<String, Object>> gating = QgSliceCounts.rows(ingest, NAME, "questions_gating_closed_tasks");
        return facts(blocked, sprints, gating == null ? null : gating.size());
    }

    /** Чистая функция: строки срезов → пять фактов. {@code null} у источника → факт без значения. */
    static List<RawFact> facts(List<Map<String, Object>> blocked, List<Map<String, Object>> sprints,
                               Integer gatingClosed) {
        Integer unexplained = null, stale = null, empty = null, mismatch = null;
        if (blocked != null) {
            unexplained = 0; stale = 0; empty = 0;
            for (Map<String, Object> r : blocked) {
                List<Object> deps = QgSliceCounts.list(r.get("deps"));
                List<Object> openDeps = QgSliceCounts.list(r.get("open_deps"));
                List<Object> openQ = QgSliceCounts.list(r.get("open_questions"));
                // Объяснение — любое из трёх: текст причины, зависимость, открытый вопрос.
                if (QgSliceCounts.blank(r.get("block_reason")) && deps.isEmpty() && openQ.isEmpty()) unexplained++;
                if (!deps.isEmpty() && openDeps.isEmpty()) stale++;
                if (QgSliceCounts.intOf(r.get("task_count")) == 0) empty++;
            }
        }
        if (sprints != null) {
            mismatch = 0;
            for (Map<String, Object> r : sprints) {
                Object name = r.get("name");
                if (name == null || !name.toString().toLowerCase(Locale.ROOT).contains("backlog")) continue;
                String canon = LoreStatusVocabulary.classify(r.get("status_raw") == null ? null : r.get("status_raw").toString());
                if ("blocked".equals(canon) || "in_progress".equals(canon)) mismatch++;
            }
        }
        List<RawFact> out = new ArrayList<>();
        out.add(new RawFact("blocked_unexplained", unexplained, "slice:blocked_sprints_reason"));
        out.add(new RawFact("blocked_stale_deps", stale, "slice:blocked_sprints_reason"));
        out.add(new RawFact("blocked_empty_shell", empty, "slice:blocked_sprints_reason"));
        out.add(new RawFact("backlog_status_mismatch", mismatch, "slice:sprints"));
        out.add(new RawFact("questions_gating_closed_tasks", gatingClosed, "slice:questions_gating_closed_tasks"));
        return out;
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        return normalizeFacts(raw);
    }

    static List<LoreQgResource.QGMetricEntry> normalizeFacts(List<RawFact> raw) {
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (RawFact f : raw) out.add(QgSliceCounts.count(f.key(), f.value(), f.source(), "WARN"));
        return out;
    }
}
