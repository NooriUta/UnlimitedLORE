package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Подпись «кто» — одна для человека и агента (пакет 1.18; SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-HUMAN-NAME).
 *
 * <ul>
 *   <li>Человек — имя (из профиля или «Имя Фамилия» из KC, {@link KcUserNames}), нет — логин, нет — код учётки.</li>
 *   <li>Агент — «имя · профиль · машина»: имя — из реестра агентов (нет — harness), профиль — из учётки
 *       {@code lore-mcp-<профиль>[_…]}, машина — если известна (владелица 21.11.2026: «и машину если есть, если нет
 *       пока так»). Учётка (client_id) — подсказкой; в данных она остаётся — фильтры и админка работают по ней.</li>
 * </ul>
 */
final class WhoLabel {

    private WhoLabel() {}

    static final String SEP = " · ";

    private static final Pattern MCP_CLIENT = Pattern.compile("^lore-mcp-([A-Za-z0-9-]+?)(?:_.*)?$");

    /** Что о агенте знает реестр (срез agents / KnowActor). */
    record Agent(String name, String harness) {}

    /** Профиль из учётки MCP: {@code lore-mcp-full_kimi} → {@code full}; не учётка MCP — null. */
    static String profileOf(String clientId) {
        if (clientId == null) return null;
        Matcher m = MCP_CLIENT.matcher(clientId.strip());
        return m.matches() ? m.group(1) : null;
    }

    static String human(String displayName, String login, String sub) {
        String n = clean(displayName);
        if (n != null) return n;
        String l = clean(login);
        return l != null ? l : sub;
    }

    static String agent(String name, String harness, String clientId, String machine) {
        List<String> parts = new ArrayList<>();
        String who = clean(name) != null ? clean(name) : clean(harness);
        if (who != null) parts.add(who);
        String profile = profileOf(clientId);
        if (profile != null) parts.add(profile);
        String m = clean(machine);
        if (m != null && !AgentMachine.UNKNOWN.equals(m) && !AgentMachine.NOT_APPLICABLE.equals(m)) parts.add(m);
        return parts.isEmpty() ? clientId : String.join(SEP, parts);
    }

    /**
     * Подписи агентов для ленты ({@code who_names}): значения «Кто», которые — учётки агентов из реестра.
     * Машины у события ленты нет — подпись без неё. Кто не агент — не трогается (людей подписывает KnowUser).
     */
    static Map<String, String> agentNames(Set<String> whos, List<Map<String, Object>> agentRows) {
        Map<String, String> out = new HashMap<>();
        for (Map<String, Object> r : agentRows) {
            String client = r.get("client_id") == null ? null : String.valueOf(r.get("client_id"));
            if (client == null || !whos.contains(client)) continue;
            out.put(client, agent(str(r.get("name")), str(r.get("harness")), client, null));
        }
        return out;
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static String clean(String s) {
        if (s == null) return null;
        String t = s.strip();
        return t.isEmpty() ? null : t;
    }
}
