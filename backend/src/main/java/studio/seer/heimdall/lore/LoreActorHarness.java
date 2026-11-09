package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-15, ADR-MINILORE-007 (поправка 09.11): harness — поле актора-агента
 * из закрытого реестра. Гармонизация с LORE: реестр — справочник {@code harness} (как
 * {@code agent_role}), правится в админке; сервер проверяет значения по нему, при пустом
 * справочнике — по {@link #REGISTRY}. Неизвестное — null, а не угадка.
 */
final class LoreActorHarness {

    private LoreActorHarness() {}

    /** Реестр ADR-MINILORE-007 — и запасной список, если справочник пуст. */
    static final List<String> REGISTRY = List.of("claude-code", "kimi-code", "dsh", "codex", "opencode");

    /** Правила опознавания по имени актора: код → подстроки (без учёта регистра). */
    static final Map<String, List<String>> NAME_RULES = new LinkedHashMap<>();
    static {
        NAME_RULES.put("claude-code", List.of("claude code", "claude-code"));
        NAME_RULES.put("kimi-code", List.of("kimi code", "kimi-code"));
        NAME_RULES.put("dsh", List.of("dsh"));
        NAME_RULES.put("codex", List.of("codex"));
        NAME_RULES.put("opencode", List.of("opencode"));
    }

    /** harness по имени — только если подходит РОВНО одно правило; иначе null. */
    static String fromName(String name) {
        if (name == null) return null;
        String n = name.toLowerCase(Locale.ROOT);
        String hit = null;
        for (Map.Entry<String, List<String>> e : NAME_RULES.entrySet()) {
            if (e.getValue().stream().anyMatch(n::contains)) {
                if (hit != null) return null;   // два правила — неоднозначно
                hit = e.getKey();
            }
        }
        return hit;
    }

    /** Причина отказа или null. null и "" — допустимы (не трогать / сбросить). */
    static String error(String harness, List<String> allowed) {
        if (harness == null || harness.isEmpty()) return null;
        if (!allowed.contains(harness))
            return "harness must be one of: " + allowed + " (справочник harness, правится в админке; \"\" — сбросить)";
        return null;
    }

    private static final Map<String, String[]> LABELS = Map.of(
        "claude-code", new String[]{"Claude Code", "Claude Code"},
        "kimi-code", new String[]{"Kimi Code", "Kimi Code"},
        "dsh", new String[]{"dsh", "dsh"},
        "codex", new String[]{"Codex", "Codex"},
        "opencode", new String[]{"OpenCode", "OpenCode"});

    /**
     * V75: свойство, засев справочника, заполнение по имени. Заполнение — из тех же
     * {@link #NAME_RULES}, что {@link #fromName}: каждое UPDATE исключает совпадения с
     * другими правилами (неоднозначное остаётся null) и не трогает уже выставленное.
     */
    static final List<String> SCHEMA_SQL_V75 = build();

    private static List<String> build() {
        List<String> sql = new ArrayList<>();
        sql.add("CREATE PROPERTY KnowActor.harness IF NOT EXISTS STRING");
        int order = 10;
        for (String code : REGISTRY) {
            String[] l = LABELS.get(code);
            sql.add("UPDATE KnowDictEntry SET dict_type='harness', code='" + code + "', label_ru='" + l[0]
                + "', label_en='" + l[1] + "', icon='robot-golem', color='var(--inf)', sort_order=" + order
                + ", is_active=true, is_extensible=true UPSERT WHERE dict_type='harness' AND code='" + code + "'");
            order += 10;
        }
        for (Map.Entry<String, List<String>> e : NAME_RULES.entrySet()) {
            StringBuilder s = new StringBuilder("UPDATE KnowActor SET harness='" + e.getKey()
                + "' WHERE kind='agent' AND harness IS NULL AND (");
            s.append(likeAny(e.getValue())).append(")");
            for (Map.Entry<String, List<String>> other : NAME_RULES.entrySet())
                if (!other.getKey().equals(e.getKey()))
                    for (String p : other.getValue()) s.append(" AND name.toLowerCase() NOT LIKE '%").append(p).append("%'");
            sql.add(s.toString());
        }
        return List.copyOf(sql);
    }

    private static String likeAny(List<String> patterns) {
        StringBuilder s = new StringBuilder();
        for (String p : patterns) {
            if (s.length() > 0) s.append(" OR ");
            s.append("name.toLowerCase() LIKE '%").append(p).append("%'");
        }
        return s.toString();
    }
}
