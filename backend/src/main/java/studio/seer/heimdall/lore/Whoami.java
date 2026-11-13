package studio.seer.heimdall.lore;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI — «кем LORE видит вызывающего».
 *
 * <p>Всё — из проверенного токена и графа, от клиента на веру ничего не принимается.
 * Чистая часть (без БД и без Quarkus), её проверяет {@code WhoamiTest}; ресурс
 * {@link LoreWhoamiResource} только снимает токен и читает граф.
 *
 * <p>Главное различение — «не опознан» против «нет прав»: клиент, которого нет в
 * графе ролей, получает {@code identity.state = unknown} с причиной, а не пустой
 * список, неотличимый от «прав нет» (память lore_scope_caller_side_blind).
 */
final class Whoami {

    private Whoami() {}

    /**
     * Снятое с проверенного токена.
     *
     * @param agentScope профиль из {@code agent_scope}, уже нормализованный
     *                   ({@link AgentScopeFilter#agentScopeOf}); null — человек
     * @param exp        срок действия, epoch seconds; null — не известен
     * @param headerRole роль из заголовка — только при выключенном auth, иначе null
     */
    record Token(boolean authEnabled, String sub, String clientId, String agentScope,
                 Set<String> realmRoles, Long exp, String headerRole) {

        Token(boolean authEnabled, String sub, String clientId, String agentScope, Set<String> realmRoles, Long exp) {
            this(authEnabled, sub, clientId, agentScope, realmRoles, exp, null);
        }

        /** auth выключен (dev/local): токена нет, роль — из заголовка как есть. */
        static Token authOff(String headerRole) {
            return new Token(false, null, null, null, Set.of(), null, headerRole);
        }
    }

    /**
     * Что нашлось в графе. {@code self} — вершина вызывающего (KnowUser у человека,
     * KnowActor у агента) или null; {@code owners} — владельцы агента (OWNED_BY);
     * {@code projectRoles} — проектные роли (человека — свои, агента — владельца).
     */
    record Graph(Map<String, Object> self, List<Map<String, Object>> owners, List<Map<String, Object>> projectRoles) {
        static final Graph EMPTY = new Graph(null, List.of(), List.of());
    }

    /** D-2026-LORE-AGENT-MACHINE-EVERYWHERE: машина ЭТОГО вызова (агент — X-Lore-Machine, человек — «(n/a)»). */
    static String machineOf(Token t, String rawHeader) {
        return AgentMachine.mark(t.agentScope() != null, rawHeader);
    }

    /** Роль первой оси — то же правило, что {@code SeerRoleFromTokenFilter}. */
    static String seerRole(Set<String> realmRoles) {
        if (realmRoles.contains("super-admin")) return "superadmin";
        if (realmRoles.contains("admin")) return "admin";
        return "viewer";
    }

    /** Семейства записи, открытые профилю по матрице {@link AgentScopeFilter#FAMILY_AGENTS}. */
    static List<String> writeFamilies(String profile) {
        List<String> out = new ArrayList<>();
        if (profile == null || AgentScopeFilter.AMBIGUOUS_SCOPE.equals(profile)) return out;
        AgentScopeFilter.FAMILY_AGENTS.forEach((fam, profiles) -> { if (profiles.contains(profile)) out.add(fam); });
        out.sort(null);
        return out;
    }

    static Map<String, Object> body(Token t, Graph g) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("auth_enabled", t.authEnabled());
        if (!t.authEnabled()) {
            // Без токена опознать нечем: роль — то, что прислали заголовком, и это
            // сказано прямо, а не выдано за проверенное.
            b.put("kind", "unverified");
            b.put("seer_role", t.headerRole());
            b.put("client_id", null);
            b.put("note", "auth выключен: токена нет, роль взята из заголовка X-Seer-Role как есть и не проверена");
            return b;
        }
        boolean agent = t.agentScope() != null;
        boolean ambiguous = AgentScopeFilter.AMBIGUOUS_SCOPE.equals(t.agentScope());
        b.put("kind", agent ? "agent" : "human");
        b.put("client_id", t.clientId());
        b.put("sub", t.sub());
        b.put("profile", ambiguous ? "ambiguous" : t.agentScope());
        if (ambiguous) b.put("profile_note", "в токене два разных профиля agent_scope — запись отказывает (AO-07)");
        b.put("seer_role", seerRole(t.realmRoles()));
        b.put("realm_roles", t.realmRoles().stream().sorted().toList());
        b.put("write_families", agent ? writeFamilies(t.agentScope()) : null);
        if (!agent) b.put("write_families_note", "человек: агентская матрица не применяется, запись — по роли первой оси");
        b.put("human_only_families", AgentScopeFilter.humanOnlyFamilies().stream().sorted().toList());

        Map<String, Object> id = new LinkedHashMap<>();
        if (g.self() == null) {
            id.put("state", "unknown");
            id.put("reason", agent
                ? "клиента " + t.clientId() + " нет в графе (KnowActor с этим client_id) — LORE не знает, чей это агент"
                : "человека с kc_sub " + t.sub() + " нет в графе (KnowUser)");
        } else {
            id.put("state", "known");
            id.putAll(g.self());
        }
        b.put("identity", id);
        if (agent) b.put("owners", g.owners());
        b.put("project_roles", g.projectRoles());
        b.put("token_expires_at", t.exp() == null ? null : Instant.ofEpochSecond(t.exp()).toString());
        return b;
    }
}
