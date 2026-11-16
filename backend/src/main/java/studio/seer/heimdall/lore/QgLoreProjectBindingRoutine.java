package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Гейт QG-LORE-PROJECT-BINDING рутиной канала 2 (SPRINT_QG_REBUILD/QG-01; повод —
 * SPRINT_LORE_PROJECT_SCOPE/AL-113): сущности с проектной осью без проекта.
 *
 * <p>Метрики — итог и разбивка по типам ({@code entities_without_project_<тип>}),
 * чтобы хвост разбирался по типам, как велит гейт. Гейт информационный: цель 0,
 * превышение — WARN. Правило «красный, если итог вырос» требует сравнения с прошлым
 * прогоном по отпечатку состава (ADR-LORE-053-D8) — это QG-07, здесь не делается.
 */
@ApplicationScoped
public class QgLoreProjectBindingRoutine implements QgRoutine {

    static final String NAME = "qg-lore-project-binding";
    static final String SLICE = "entities_without_project";

    @Inject
    LoreIngestService ingest;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        return facts(QgSliceCounts.rows(ingest, NAME, SLICE));
    }

    /** Строки среза → итог и по типам; срез не ответил → один факт итога без значения. */
    static List<RawFact> facts(List<Map<String, Object>> rows) {
        List<RawFact> out = new ArrayList<>();
        if (rows == null) {
            out.add(new RawFact("entities_without_project_total", null, "slice:" + SLICE));
            return out;
        }
        Map<String, Integer> byType = new TreeMap<>();
        for (Map<String, Object> r : rows) {
            Object t = r.get("entity_type");
            byType.merge(t == null ? "unknown" : t.toString(), 1, Integer::sum);
        }
        out.add(new RawFact("entities_without_project_total", rows.size(), "slice:" + SLICE));
        for (Map.Entry<String, Integer> e : byType.entrySet())
            out.add(new RawFact("entities_without_project_" + e.getKey(), e.getValue(), "slice:" + SLICE));
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
