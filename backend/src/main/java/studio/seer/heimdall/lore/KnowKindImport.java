package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-09 (окно OQ-064-KNOWKIND-IMPORT) — план build-time импорта KnowKind.
 *
 * <p>Чистая часть: «что в базе (kind → content_hash открытой версии)» × «что выдал генератор» → какие
 * виды вставить, какие переписать новой SCD2-версией, какие не трогать. Импорт идемпотентен по kind:
 * повторный прогон с тем же входом — ноль записей. Двойник kind во входе — отказ прогона с перечнем
 * (не silent-merge, SPEC-MODEL-EXPORT-064 §5). Виды, которых во входе больше нет, не удаляются —
 * только перечисляются в {@code stale}: снятие вида — решение (replaces), а не побочный эффект импорта.
 */
final class KnowKindImport {

    private KnowKindImport() {}

    record Plan(List<Map<String, Object>> inserts, List<Map<String, Object>> updates,
                List<String> unchanged, List<String> stale) {
        boolean isNoop() { return inserts.isEmpty() && updates.isEmpty(); }
    }

    /**
     * @param existing kind → content_hash открытой версии в базе (null-хэш — версии нет: перепишется)
     * @param desired  записи генератора (каждая с kind и content_hash)
     * @param managed  префиксы видов, которыми владеет этот импорт (entity:, ddl:, slice:, tag:) — stale
     *                 считается только среди них
     */
    static Plan plan(Map<String, String> existing, List<Map<String, Object>> desired, Set<String> managed) {
        Map<String, Map<String, Object>> byKind = new TreeMap<>();
        Set<String> dup = new TreeSet<>();
        for (Map<String, Object> k : desired) {
            String kind = String.valueOf(k.get("kind"));
            if (byKind.put(kind, k) != null) dup.add(kind);
        }
        if (!dup.isEmpty()) throw new IllegalStateException("импорт KnowKind: двойники видов во входе " + dup);
        List<Map<String, Object>> inserts = new ArrayList<>();
        List<Map<String, Object>> updates = new ArrayList<>();
        List<String> unchanged = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> e : byKind.entrySet()) {
            if (!existing.containsKey(e.getKey())) inserts.add(e.getValue());
            else if (String.valueOf(e.getValue().get("content_hash")).equals(existing.get(e.getKey()))) unchanged.add(e.getKey());
            else updates.add(e.getValue());
        }
        List<String> stale = new ArrayList<>();
        for (String kind : new TreeSet<>(existing.keySet()))
            if (!byKind.containsKey(kind) && managed.stream().anyMatch(kind::startsWith)) stale.add(kind);
        return new Plan(inserts, updates, unchanged, stale);
    }

    /** Свойства вершины KnowKind из записи генератора — ровно колонки DDL V94 (служебное — в hist). */
    static final List<String> COLUMNS = List.of("kind", "id_field", "title", "fields", "links", "guards", "roles", "replaces", "source", "lifecycle");
}
