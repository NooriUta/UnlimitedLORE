package studio.seer.heimdall.lore;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-10 (D-2026-LORE-FREE-FIELDS-SHOWN): значения записи вне модели.
 *
 * <p>Паспорт собирается из строки среза, а срез отдаёт только названные колонки: свойство вершины,
 * которого нет среди полей модели, в паспорт не попадало вовсе. Здесь — отдельное чтение вершины и
 * отбор «вне модели»: всё, что не поле модели (по тому же сопоставлению, что у {@code /lore/model}),
 * не ключ записи, не служебное и не внутреннее. Блок только для чтения; клиент рисует его последним
 * в свойствах с пометкой «не описано в модели».
 *
 * <p>Границы первого шага: читается вершина, свойства открытой версии истории не читаются; типы о
 * людях ({@link #PEOPLE}) не читаются совсем — вне модели у них могут лежать персональные сведения,
 * а видимости на уровне поля в модели ещё нет.
 */
final class LoreRecordUnmodeled {

    private LoreRecordUnmodeled() {}

    /** Длиннее — обрезается: блок показывает, что значение есть, а не несёт тело документа. */
    static final int MAX_TEXT = 2000;

    /** Типы, у которых блок не отдаётся: человек, агент, роль продукта. */
    static final Set<String> PEOPLE = Set.of("user", "agent", "actor");

    /**
     * Служебные поля по перечню, утверждённому владелицей 15.11.2026 (+ changed_by_session, changed_by_harness, changed_by_machine — сессия, harness и машина правки, 16.11.2026,
     * SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG): в блок не попадают
     * (D-2026-LORE-FREE-FIELDS-SHOWN). Часть из них уже отсекают isSystem и isInternal модели;
     * здесь перечень назван целиком, чтобы правило не зависело от чужих списков.
     */
    static final Set<String> SERVICE = Set.of("valid_from", "valid_to", "state_uid", "content_hash", "changed_by",
        "changed_by_kind", "changed_by_session", "changed_by_harness", "changed_by_harness_note", "changed_by_machine", "change_reason", "status_category", "status_known_from", "status_backfilled", "source_commit", "hist_for",
        "created_at", "updated_at", "origin");

    static boolean reads(String type) {
        return type != null && !PEOPLE.contains(type) && LoreModelTypes.GRAPH.containsKey(type);
    }

    /** Запрос вершины записи по её ключу; {@code null} — тип не читается. */
    static String sql(String type) {
        if (!reads(type)) return null;
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
        return "SELECT FROM " + g.vertex() + " WHERE " + g.key() + " = :id LIMIT 1";
    }

    /** Свойства вершины → значения вне модели, ключи по алфавиту. Пустое значение не идёт. */
    static Map<String, Object> of(String type, Map<String, Object> vertex) {
        Map<String, Object> out = new TreeMap<>();
        if (vertex == null || !reads(type)) return out;
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
        Set<String> modeled = modeled(type);
        for (Map.Entry<String, Object> e : vertex.entrySet()) {
            String p = e.getKey();
            if (p.startsWith("@") || p.equals(g.key()) || modeled.contains(p)) continue;
            if (SERVICE.contains(p) || LoreModelTypes.isSystem(p) || LoreModelTypes.isInternal(p, g.key())) continue;
            if ("task".equals(type) && LoreModelTypes.LEGACY_ROLE_STRINGS.contains(p)) continue;
            Object v = e.getValue();
            if (v == null || (v instanceof String s && s.isBlank()) || (v instanceof Collection<?> c && c.isEmpty())
                || (v instanceof Map<?, ?> m && m.isEmpty())) continue;
            out.put(p, v instanceof String s && s.length() > MAX_TEXT ? s.substring(0, MAX_TEXT) + "…" : v);
        }
        return out;
    }

    /** Имена свойств, которыми заняты поля модели типа: псевдоним, поле пути записи, ключ поля. */
    private static Set<String> modeled(String type) {
        Set<String> names = new LinkedHashSet<>();
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
        if (d == null) return names;
        Map<String, String> aliases = LoreModelTypes.ALIASES.getOrDefault(type, Map.of());
        for (LoreRecordRegistry.Field f : d.fields()) add(names, aliases, f.key(), f.write());
        for (LoreRecordRegistry.Body b : d.body()) add(names, aliases, b.key(), b.write());
        return names;
    }

    private static void add(Set<String> names, Map<String, String> aliases, String key, LoreRecordRegistry.Write w) {
        names.add(key);
        if (aliases.containsKey(key)) names.add(aliases.get(key));
        if (w != null && w.field() != null) names.add(w.field());
    }
}
