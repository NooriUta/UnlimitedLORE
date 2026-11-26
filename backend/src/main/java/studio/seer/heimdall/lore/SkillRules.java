package studio.seer.heimdall.lore;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-01 + SKILL-02 · гарды записи скилла (SPEC-SKILLS-TAGS-062 §5–§7) —
 * чистые функции без базы: их зовёт {@link LoreSkillResource}, их же проверяет {@code SkillRulesTest}.
 *
 * <p>Отказы — форма конверта SPEC-AGENT-SURFACE-061 §5 ({@code error}, {@code allowed?}, {@code hint?},
 * {@code next}) поверх привычного {@link LoreResourceBase.LoreError}: ключ кода — {@code error}, как у всех
 * отказов LORE, чтобы клиенты (MCP, miniLORE) разбирали его тем же путём.
 */
final class SkillRules {

    private SkillRules() {}

    /** Словарь skill_status (V97) и lifecycle §5: draft → active → deprecated → (owner) active. */
    static final List<String> STATUSES = List.of("draft", "active", "deprecated");

    /** Происхождение записи (§5): посев, агент, человек. */
    static final List<String> SOURCES = List.of("seed", "agent", "human");

    /** RBAC записи skill:* (§5, по образцу ADR-LORE-060): создают и меняют — full и architect. */
    static final List<String> WRITERS = List.of("full", "architect");

    /** Обязательные рёбра создания (§5, §7) — в порядке проверки гарда. */
    static final List<String> REQUIRED_EDGES = List.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE");

    static final String PREFIX = "skill:";
    private static final Pattern SLUG = Pattern.compile("[a-z0-9][a-z0-9-]{0,62}");

    /** {@code skill:<slug>} из голого slug или геоида; не kebab-case латиницей — {@code null}. */
    static String geoid(String raw) {
        if (raw == null) return null;
        String s = raw.strip();
        if (s.startsWith(PREFIX)) s = s.substring(PREFIX.length());
        if (s.contains(":") || !SLUG.matcher(s).matches()) return null;
        return PREFIX + s;
    }

    /** slug геоида — короткое имя скилла ({@code name}). */
    static String slug(String geoid) {
        return geoid != null && geoid.startsWith(PREFIX) ? geoid.substring(PREFIX.length()) : geoid;
    }

    private static boolean noneGiven(List<String> v) {
        if (v == null) return true;
        for (String s : v) if (s != null && !s.isBlank()) return false;
        return true;
    }

    /** Недостающие обязательные рёбра создания; пусто — гард пройден. */
    static List<String> missingRequiredEdges(List<String> projects, List<String> roles) {
        List<String> out = new ArrayList<>();
        if (noneGiven(projects)) out.add("BELONGS_TO_PROJECT");
        if (noneGiven(roles)) out.add("APPLIES_TO_ROLE");
        return out;
    }

    /** rel запроса → тип ребра; чужой rel — {@code null}. EXTENDS — ключевое слово SQL, ребро SKILL_EXTENDS. */
    static String edgeOf(String rel) {
        if (rel == null) return null;
        return switch (rel) {
            case "role" -> "APPLIES_TO_ROLE";
            case "project" -> "BELONGS_TO_PROJECT";
            case "extends" -> "SKILL_EXTENDS";
            case "owner" -> "OWNED_BY";
            default -> null;
        };
    }

    /** Снятие ребра {@code rel}, когда их {@code have} штук, оставит скилл висяком (§10 инвариант 1). */
    static boolean removalLeavesDangling(String rel, int have) {
        return ("project".equals(rel) || "role".equals(rel)) && have <= 1;
    }

    /**
     * Цикл, который замкнёт новое ребро {@code from → to} в графе EXTENDS; {@code null} — цикла нет.
     * Цепочка начинается и кончается {@code from}: {@code from → to → … → from}.
     */
    static List<String> extendsCycle(Map<String, List<String>> graph, String from, String to) {
        if (from.equals(to)) return List.of(from, from);
        // BFS от to по рёбрам наследования: дошли до from — новое ребро закрывает цикл
        Map<String, String> prev = new HashMap<>();
        Set<String> seen = new HashSet<>(Set.of(to));
        Deque<String> q = new ArrayDeque<>(List.of(to));
        while (!q.isEmpty()) {
            String cur = q.poll();
            for (String nxt : graph.getOrDefault(cur, List.of())) {
                if (!seen.add(nxt)) continue;
                prev.put(nxt, cur);
                if (nxt.equals(from)) {
                    List<String> path = new ArrayList<>();
                    for (String at = from; at != null; at = prev.get(at)) path.add(0, at);
                    List<String> chain = new ArrayList<>();
                    chain.add(from);
                    chain.addAll(path);
                    return chain;
                }
                q.add(nxt);
            }
        }
        return null;
    }

    /** Исход смены статуса. */
    enum Move { OK, SAME, NOOP_OWNER_ONLY, BAD_TRANSITION, BAD_STATUS }

    /** Смена статуса по §5: обратно в draft нельзя; deprecated → active — только owner (OWNED_BY). */
    static Move move(String from, String to, boolean callerIsOwner) {
        if (!STATUSES.contains(to)) return Move.BAD_STATUS;
        if (to.equals(from)) return Move.SAME;
        if (from == null) return Move.OK;
        return switch (from + "→" + to) {
            case "draft→active", "draft→deprecated", "active→deprecated" -> Move.OK;
            case "deprecated→active" -> callerIsOwner ? Move.OK : Move.NOOP_OWNER_ONLY;
            default -> Move.BAD_TRANSITION;
        };
    }

    // ── тела отказов (конверт 061 §5) ─────────────────────────────────────────

    static Map<String, Object> refusedMissingEdges(List<String> missing) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "REFUSED");
        m.put("detail", "скилл без обязательных рёбер не создаётся (висяк, которого никто не увидит): нет " + missing);
        m.put("missing", missing);
        m.put("allowed", REQUIRED_EDGES);
        m.put("hint", "describe_full skill:*");
        m.put("next", "повторить вызов с обоими полями: projects ≥1 (BELONGS_TO_PROJECT) и roles ≥1 (APPLIES_TO_ROLE)");
        return m;
    }

    static Map<String, Object> refusedCycle(List<String> chain) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "REFUSED");
        m.put("detail", "ребро EXTENDS замкнуло бы цикл наследования");
        m.put("chain", chain);
        m.put("hint", String.join(" → ", chain));
        m.put("next", "разорвать цикл: снять или перенаправить одно ребро EXTENDS, затем повторить");
        return m;
    }

    static Map<String, Object> refusedDangling(String skillId, String rel) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "REFUSED");
        m.put("detail", skillId + ": последнее ребро " + edgeOf(rel) + " снять нельзя — скилл станет висяком");
        m.put("allowed", REQUIRED_EDGES);
        m.put("next", "сначала добавить другое ребро " + edgeOf(rel) + ", потом снять это");
        return m;
    }

    static Map<String, Object> noopOwnerOnly(String skillId, String owner) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "NOOP");
        m.put("detail", skillId + " снят с поддержки; вернуть в active может только его владелец");
        m.put("status", "deprecated");
        m.put("owner", owner);
        m.put("hint", owner == null
            ? "у скилла нет владельца (OWNED_BY) — назначьте его: entity_link type=skill rel=owner"
            : "запросить активацию у владельца (OWNED_BY)");
        m.put("next", "владелец: status active или замена другим скиллом; повтор после активации");
        return m;
    }

    static Map<String, Object> forbiddenForRole(String scope) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "FORBIDDEN_FOR_ROLE");
        m.put("detail", "профиль agent-" + scope + " не пишет skill:* — запись у " + WRITERS);
        m.put("allowed", WRITERS);
        m.put("hint", "переложить правку на роль из allowed (full или architect)");
        return m;
    }

    /** Переход статуса вне жизненного цикла §5 — INVALID_VALUE (061 §5 E2); прежний код — в legacy_code. */
    static Map<String, Object> invalidTransition(String from, String to, String hint) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "INVALID_VALUE");
        m.put("legacy_code", "BAD_TRANSITION");
        m.put("detail", (from == null ? "создание" : from) + " → " + to + " не по жизненному циклу скилла");
        m.put("allowed", STATUSES);
        m.put("hint", hint);
        return m;
    }
}
