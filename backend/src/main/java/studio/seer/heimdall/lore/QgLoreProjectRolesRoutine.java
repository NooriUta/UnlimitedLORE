package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Гейт QG-LORE-PROJECT-ROLES рутиной канала 2 (SPRINT_QG_REBUILD/QG-01): зарегистрированные
 * проекты без единой роли {@code HAS_PROJECT_ROLE}. Такой проект молча запрещает
 * агентам заводить акторов — любому профилю, включая full.
 *
 * <p>Цель 0; одна и больше — FAIL, как записано в гейте. Список проектов уходит в
 * источник метрики, чтобы по прогону было видно, кому выдать роль.
 */
@ApplicationScoped
public class QgLoreProjectRolesRoutine implements QgRoutine {

    static final String NAME = "qg-lore-project-roles";
    static final String SLICE = "projects_without_role";

    @Inject
    LoreIngestService ingest;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        return facts(QgSliceCounts.rows(ingest, NAME, SLICE));
    }

    static List<RawFact> facts(List<Map<String, Object>> rows) {
        if (rows == null) return List.of(new RawFact("projects_without_role", null, "slice:" + SLICE));
        List<String> slugs = new ArrayList<>();
        for (Map<String, Object> r : rows) if (r.get("slug") != null) slugs.add(r.get("slug").toString());
        String source = "slice:" + SLICE + (slugs.isEmpty() ? "" : " · " + String.join(", ", slugs));
        return List.of(new RawFact("projects_without_role", rows.size(), source));
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        return normalizeFacts(raw);
    }

    static List<LoreQgResource.QGMetricEntry> normalizeFacts(List<RawFact> raw) {
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (RawFact f : raw) out.add(QgSliceCounts.count(f.key(), f.value(), f.source(), "FAIL"));
        return out;
    }
}
