package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-21 (UC-3) — «почему агент получил 403 на инструменте».
 *
 * <p>Чистая функция без контейнера. Решение берётся из {@link AgentScopeFilter#decide}
 * — ТОГО ЖЕ метода, что отказывает на проде, — а не из копии матрицы: объяснение не
 * может разойтись с правилом. Вход — то, что журнал отказа (AO-01,
 * {@code LoreRequestStatsFilter}) уже пишет: caller агента = его профиль
 * (agent_scope), family = семейство пути, entity_id = путь запроса (у отказа фильтра
 * сущности нет, поэтому пишется путь).
 *
 * <p>Ответ: verdict ({@code allowed | denied | unlisted | no_profile | bad_input}),
 * что закрыто (семейство или подпуть), почему — словами фильтра, каким профилям этот
 * путь открыт ({@code allowed_profiles}, по тому же decide) и что предложить:
 * {@code change_profile} (есть профиль, которому можно), {@code human} (человеческое
 * семейство — правит человек), {@code project_role} (матрица профиля пропускает, значит
 * 403 — проектная ось D4: роль владельца в проекте не делегирует профиль).
 */
final class AgentToolExplain {

    private AgentToolExplain() {}

    static Map<String, Object> explain(String profile, String family, String entityOrPath) {
        Map<String, Object> out = new LinkedHashMap<>();
        String scope = profile == null ? null : profile.strip();
        if (scope != null && scope.startsWith("agent-")) scope = scope.substring("agent-".length());
        String path = pathOf(family, entityOrPath);
        out.put("profile", scope == null || scope.isEmpty() ? null : scope);
        out.put("path", path);
        out.put("family", path == null ? null : AgentScopeFilter.familyOf(path));
        if (path == null) {
            out.put("verdict", "bad_input");
            out.put("why", "нужно семейство или путь запроса");
            return out;
        }
        if (scope == null || scope.isEmpty()) {
            out.put("verdict", "no_profile");
            out.put("why", "у вызывающего нет профиля agent_scope — это человек; матрица агентов к нему не применяется");
            return out;
        }
        String fam = AgentScopeFilter.familyOf(path);
        AgentScopeFilter.Denial d = AgentScopeFilter.decide(scope, path);
        List<String> allowed = new ArrayList<>();
        for (String p : AgentScopeFilter.knownProfiles())
            if (AgentScopeFilter.decide(p, path) == null) allowed.add(p);
        boolean listed = AgentScopeFilter.FAMILY_AGENTS.containsKey(fam) || AgentScopeFilter.humanOnlyFamilies().contains(fam);
        boolean humanOnly = d != null && allowed.isEmpty();
        out.put("human_only", humanOnly);
        out.put("allowed_profiles", allowed);
        if (d != null) {
            out.put("verdict", "denied");
            out.put("what", d.what());
            out.put("why", d.why());
            out.put("fix", humanOnly ? "human" : "change_profile");
        } else if (!listed) {
            out.put("verdict", "unlisted");
            out.put("why", "семейство вне матрицы прав — фильтр профиля его пропускает");
            out.put("fix", "project_role");
        } else {
            out.put("verdict", "allowed");
            out.put("why", null);
            out.put("fix", "project_role");
        }
        return out;
    }

    /** Путь из журнала, если это путь; иначе — путь семейства. */
    static String pathOf(String family, String entityOrPath) {
        if (entityOrPath != null) {
            String p = entityOrPath.strip();
            if (p.startsWith("lore/")) return "/" + p;
            if (p.startsWith("/lore/")) return p;
        }
        if (family == null || family.isBlank() || !family.strip().matches("[a-z][a-z0-9-]*")) return null;
        return "/lore/" + family.strip();
    }
}
