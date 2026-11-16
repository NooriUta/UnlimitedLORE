package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * SPRINT_MINILORE_POLISH/LORE-DOOR-HISTORY-ALL-PASSPORTS — признак «у записи есть история» в ответе
 * паспорта. Клиент не угадывает по типу и не показывает пустую вкладку:
 * <ul>
 *   <li>{@code available: true}, {@code type} — тип для {@code GET /lore/history?type=&id=};</li>
 *   <li>{@code available: false}, {@code reason: no_versions} — у типа версий нет
 *       ({@code time.history = none} в модели);</li>
 *   <li>{@code available: false}, {@code reason: no_door} — версии есть, но двери истории под код
 *       записи этого типа нет (технология живёт в цепочке спеки, продукт — в цепочке статьи
 *       справочника).</li>
 * </ul>
 */
final class LoreRecordHistory {

    private LoreRecordHistory() {}

    static Map<String, Object> flag(String type) {
        Map<String, Object> m = new LinkedHashMap<>();
        Map<String, Object> time = type == null ? null : LoreModelTypes.TIME.get(type);
        boolean versions = time != null && "scd2".equals(time.get("history"));
        boolean door = type != null && LoreEntityHistory.types().contains(type);
        m.put("available", versions && door);
        if (versions && door) m.put("type", type);
        else m.put("reason", versions ? "no_door" : "no_versions");
        return m;
    }
}
