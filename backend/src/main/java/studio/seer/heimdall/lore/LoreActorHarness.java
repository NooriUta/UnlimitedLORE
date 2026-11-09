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
        NAME_RULES.put("kimi-code", List.of("kimi"));
        NAME_RULES.put("dsh", List.of("dsh"));
        NAME_RULES.put("codex", List.of("codex"));
        NAME_RULES.put("opencode", List.of("opencode"));
    }

    /**
     * Факты владелицы сильнее имени. 09.11: «все кроме Kimi и basilisk harness Claude»,
     * «harness vasilisk Codex» — а зовётся он «Claude Code (full) vasilisk».
     */
    static final Map<String, String> OWNER_FACTS = Map.of("AGENT-FULL_VASILISK-mw85b6r4", "codex");

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
     * V75: свойство и засев справочника — только аддитивные формы (чек-лист v1). Заполнение
     * по имени — Java-шаг V76 ({@link #plan}, LoreSchemaMigrationRunner).
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
        return List.copyOf(sql);
    }

    /** Назначение harness актору при заполнении V76. */
    record Assign(String actorId, String harness) {}

    /**
     * План заполнения V76: вход — агенты с пустым harness (actor_id, name), выход — только
     * однозначные назначения по {@link #fromName}. Остальные остаются null — это видно в
     * agent_owners. Пишется с условием «harness ещё не стоит» — уже выставленное не трогается.
     */
    static List<Assign> plan(List<Map<String, Object>> agentsWithoutHarness) {
        List<Assign> out = new ArrayList<>();
        for (Map<String, Object> a : agentsWithoutHarness) {
            Object id = a.get("actor_id");
            String h = id == null ? null : OWNER_FACTS.get(String.valueOf(id));
            if (h == null) h = fromName(a.get("name") == null ? null : String.valueOf(a.get("name")));
            if (id != null && h != null) out.add(new Assign(String.valueOf(id), h));
        }
        return out;
    }
}
