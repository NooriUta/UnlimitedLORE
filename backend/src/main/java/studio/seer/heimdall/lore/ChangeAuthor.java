package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.Map;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-12 — автор версии истории (SCD2).
 *
 * <p>Баг: строки {@code *Hist} не несли «кто». Лента и история не отличали
 * человека от агента; атрибуцию угадывали по журналу действий AO-01, который
 * живёт около четырёх часов (за неделю 01–07.11: 2019 событий из 2194 — «неизвестно»).
 *
 * <p><b>Правило:</b> каждая вставка версии в любую {@code Know*Hist} несёт
 * {@code changed_by} и {@code changed_by_kind}. Значения берутся ТОЛЬКО из
 * проверенного токена ({@link SecurityIdentity}, тот же разбор клейма, что у
 * {@link AgentScopeFilter}), никогда из тела запроса — подделать автора нельзя.
 * Сторож — {@code HistInsertCarriesAuthorTest}: вставка Hist без автора валит сборку.
 *
 * <ul>
 *   <li>{@code agent} — у токена есть клейм {@code agent_scope}; {@code changed_by} —
 *       {@code client_id} клиента KC (личность агента), иначе {@code agent-<профиль>}.</li>
 *   <li>{@code human} — верифицированный JWT без {@code agent_scope};
 *       {@code changed_by} — {@code sub} (он же {@code KnowUser.kc_sub}, стабильная личность;
 *       контракт S2 {@code HistoryAuthor.kc_sub}), иначе {@code preferred_username}.
 *       Отображаемое имя — по kc_sub при чтении, не в истории: имя меняется, личность нет.</li>
 *   <li>{@code unknown} — токена нет (dev-режим, выключенный OIDC) или он не JWT;
 *       {@code changed_by = null}. Не «человек»: приписать правку человеку, которого
 *       не опознали, — та же неправда, что приписать агенту.</li>
 * </ul>
 *
 * <p>Старые версии без поля остаются без автора; читатели отдают их как «неизвестно»
 * и ничего не выдумывают.
 */
record ChangeAuthor(String by, String kind) {

    static final String KIND_AGENT   = "agent";
    static final String KIND_HUMAN   = "human";
    static final String KIND_UNKNOWN = "unknown";

    /** Автор не установлен: нет проверенного токена. */
    static final ChangeAuthor UNKNOWN = new ChangeAuthor(null, KIND_UNKNOWN);

    /**
     * Хвост {@code SET}-списка вставки версии: {@code INSERT INTO KnowXHist SET …}{@value}.
     * Параметры кладёт {@link #bind(Map)}.
     */
    static final String SET_SQL = ", changed_by = :changed_by, changed_by_kind = :changed_by_kind";

    /** Положить параметры {@link #SET_SQL} в карту (изменяемую; null-значение допустимо). */
    Map<String, Object> bind(Map<String, Object> params) {
        params.put("changed_by", by);
        params.put("changed_by_kind", kind);
        return params;
    }

    /**
     * Личность из проверенного токена. Любой сбой чтения (нет контекста запроса,
     * чужой принципал) — {@link #UNKNOWN}, а не исключение: автор вторичен по
     * отношению к самой записи, но и не подменяется догадкой.
     */
    static ChangeAuthor of(SecurityIdentity identity) {
        try {
            if (identity == null || identity.isAnonymous()) return UNKNOWN;
            if (!(identity.getPrincipal() instanceof JsonWebToken jwt)) return UNKNOWN;
            String scope = AgentScopeFilter.agentScopeOf(identity);
            if (scope != null) {
                String client = claim(jwt, "client_id");
                return new ChangeAuthor(client != null ? client : "agent-" + scope, KIND_AGENT);
            }
            String who = blankToNull(jwt.getSubject());
            if (who == null) who = claim(jwt, "preferred_username");
            if (who == null) who = blankToNull(jwt.getName());
            return who == null ? UNKNOWN : new ChangeAuthor(who, KIND_HUMAN);
        } catch (RuntimeException e) {
            return UNKNOWN;
        }
    }

    private static String claim(JsonWebToken jwt, String name) {
        Object v = jwt.getClaim(name);
        return v == null ? null : blankToNull(AgentScopeFilter.unquote(String.valueOf(v)));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
