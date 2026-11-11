package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** SPRINT_UXR_S10_SEIDR_KIT_2/MD-REQUIRED — ЗАГЛУШКА до правки (тесты до кода). */
final class LoreFieldRequirement {

    private LoreFieldRequirement() {}

    static final String BLOCK = "block";
    static final String WARN = "warn";

    static Map<String, Set<String>> mandatoryOf(List<Map<String, Object>> schemaRows) {
        return Map.of();
    }

    static List<String> missingCodes(String type, Map<String, String> cond) {
        return List.of();
    }
}
