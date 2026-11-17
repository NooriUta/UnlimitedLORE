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
record ChangeAuthor(String by, String kind, String session, String harness, String harnessNote, String machine) {

    /** Автор без сессии (человек, неизвестный, семя модели). */
    ChangeAuthor(String by, String kind) {
        this(by, kind, null, null, null, null);
    }

    /** Заголовок MCP с кодом сессии Claude Code (AO-SESSION-LOG). */
    static final String SESSION_HEADER = "X-Lore-Session-Id";

    /** Код сессии: то, что MCP шлёт после чистки ([A-Za-z0-9_.-], до 64). Иное — не пишем, не угадываем. */
    private static final java.util.regex.Pattern SESSION_CANON = java.util.regex.Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    /**
     * AO-SESSION-LOG: код сессии — только у агента (его шлёт MCP). У человека и неизвестного —
     * пусто: правка из веба сессии Claude Code не несёт (отрицательный контроль владелицы).
     */
    ChangeAuthor withSession(String rawHeader) {
        if (!KIND_AGENT.equals(kind) || rawHeader == null) return new ChangeAuthor(by, kind, null, harness, harnessNote, machine);
        String v = rawHeader.trim();
        return new ChangeAuthor(by, kind, SESSION_CANON.matcher(v).matches() ? v : null, harness, harnessNote, machine);
    }

    /**
     * AO-SESSION-LOG: harness агента — присланный X-Lore-Harness, сверенный со справочником и с
     * harness клиента KC ({@link HarnessCheck}). У человека и неизвестного — пусто.
     */
    ChangeAuthor withHarness(String rawHeader, HarnessCheck.Snapshot snap) {
        if (!KIND_AGENT.equals(kind)) return new ChangeAuthor(by, kind, session, null, null, machine);
        HarnessCheck.Result r = HarnessCheck.judge(rawHeader, by, snap);
        return new ChangeAuthor(by, kind, session, r.code(), r.note(), machine);
    }

    /**
     * AO-SESSION-LOG (владелица: «и машину что уж тоже»): машина агента — X-Lore-Machine (MCP шлёт
     * его давно, LORE_MACHINE_ID → COMPUTERNAME → …), канон {@link AgentMachine#canon}. Негодное
     * значение — null, не угадываем. У человека и неизвестного — пусто.
     */
    ChangeAuthor withMachine(String rawHeader) {
        String m = KIND_AGENT.equals(kind) ? AgentMachine.canon(rawHeader) : null;
        if (m != null && !SESSION_CANON.matcher(m).matches()) m = null;
        return new ChangeAuthor(by, kind, session, harness, harnessNote, m);
    }

    static final String KIND_AGENT   = "agent";
    static final String KIND_HUMAN   = "human";
    static final String KIND_UNKNOWN = "unknown";

    /** Автор не установлен: нет проверенного токена. */
    static final ChangeAuthor UNKNOWN = new ChangeAuthor(null, KIND_UNKNOWN);

    /**
     * Хвост {@code SET}-списка вставки версии: {@code INSERT INTO KnowXHist SET …}{@value}.
     * Параметры кладёт {@link #bind(Map)}.
     */
    static final String SET_SQL = ", changed_by = :changed_by, changed_by_kind = :changed_by_kind"
        + ", changed_by_session = :changed_by_session"
        + ", changed_by_harness = :changed_by_harness, changed_by_harness_note = :changed_by_harness_note"
        + ", changed_by_machine = :changed_by_machine";

    /** Положить параметры {@link #SET_SQL} в карту (изменяемую; null-значение допустимо). */
    Map<String, Object> bind(Map<String, Object> params) {
        params.put("changed_by", by);
        params.put("changed_by_kind", kind);
        params.put("changed_by_session", session);
        params.put("changed_by_harness", harness);
        params.put("changed_by_harness_note", harnessNote);
        params.put("changed_by_machine", machine);
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
