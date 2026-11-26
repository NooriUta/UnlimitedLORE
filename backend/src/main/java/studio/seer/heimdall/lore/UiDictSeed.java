package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Доводка v3 · словари, которые читает UI, а свежая база их не содержала
 * ([[task:SPRINT_LORE_EXT_ISSUES_W2/ISS-02-DICT-SEED-GUARD]], issue SeidrStudio/UnlimitedLORE#2; решение владельца
 * 25.11.2026 «словари сеять каких нет»).
 *
 * <ul>
 *   <li>{@code task_type} — ADR-LORE-015 (девять видов); подписи и иконки — как на проде, цвета — токены темы
 *       (решение владельца 25.11.2026, 6а: сырой hex прода не следует палитре; перевод прода — правкой через dict_set);</li>
 *   <li>{@code priority} — шкала модели и установщика (critical/high/normal/low, правила переноса
 *       {@code status-unification.json}); цвета и иконка — с прода, где те же ступени лежат кодами P0–P3. P0–P3 —
 *       синонимы: база, где шкала уже заведена P-кодами (прод), второй шкалы не получает;</li>
 *   <li>{@code agent_profile} — профили модели ({@code mcp-server/agent-profiles}); подписи — с прода, цвета на проде
 *       нет — нейтральный токен.</li>
 * </ul>
 *
 * <p>Как V90/V93/V100: только INSERT недостающих статей (без учёта регистра и с учётом синонимов), правленные людьми
 * строки не трогаются. Подписи — ru/en (поля KnowDictEntry); польская подпись живёт в правилах установщика.
 */
final class UiDictSeed {

    private UiDictSeed() {}

    private static StatusDictCoreSeed.Entry e(String code, String ru, String en, String icon, String color, int sort) {
        return new StatusDictCoreSeed.Entry(code, ru, en, icon, color, sort);
    }

    static final List<StatusDictCoreSeed.Entry> TASK_TYPE = List.of(
        e("planning", "Планирование", "Planning", "compass", "var(--t2)", 1),
        e("design", "Дизайн", "Design", "scroll-quill", "color-mix(in srgb,var(--inf) 50%,var(--dng))", 2),
        e("dev", "Разработка", "Development", "gears", "var(--suc)", 3),
        e("test", "Тестирование", "Testing", "checkered-flag", "var(--wrn)", 4),
        e("ops", "Релиз/Ops", "Release/Ops", "cog", "var(--dng)", 5),
        e("research", "Исследование", "Research", "magnifying-glass", "var(--inf)", 10),
        e("analytics", "Аналитика", "Analytics", "pie-chart", "color-mix(in srgb,var(--dng) 55%,var(--inf))", 11),
        e("docs", "Документация", "Docs", "spell-book", "color-mix(in srgb,var(--inf) 55%,var(--suc))", 12),
        e("content", "Контент", "Content", "quill-ink", "var(--acc)", 13));

    static final List<StatusDictCoreSeed.Entry> PRIORITY = List.of(
        e("critical", "Критический", "Critical", "dice-fire", "var(--dng)", 0),
        e("high", "Высокий", "High", null, "var(--wrn)", 1),
        e("normal", "Средний", "Normal", null, "var(--inf)", 2),
        e("low", "Низкий", "Low", null, "var(--t3)", 3));

    static final List<StatusDictCoreSeed.Entry> AGENT_PROFILE = List.of(
        e("full", "full (Claude, основной)", "full (Claude, primary)", null, "var(--t3)", 0),
        e("architect", "архитектор", "architect", null, "var(--t3)", 1),
        e("developer", "разработчик", "developer", null, "var(--t3)", 2),
        e("tester", "тестировщик", "tester", null, "var(--t3)", 3),
        e("pm", "РП", "pm", null, "var(--t3)", 4),
        e("analyst", "аналитик", "analyst", null, "var(--t3)", 5),
        e("marketer", "маркетолог", "marketer", null, "var(--t3)", 6),
        e("product-analyst", "продуктовый аналитик", "product analyst", null, "var(--t3)", 7));

    /** Справочник → статьи. Порядок — порядок вставки. */
    static final Map<String, List<StatusDictCoreSeed.Entry>> SEEDS = seeds();

    private static Map<String, List<StatusDictCoreSeed.Entry>> seeds() {
        Map<String, List<StatusDictCoreSeed.Entry>> m = new LinkedHashMap<>();
        m.put("task_type", TASK_TYPE);
        m.put("priority", PRIORITY);
        m.put("agent_profile", AGENT_PROFILE);
        return java.util.Collections.unmodifiableMap(m);
    }

    /** Синонимы кодов (как {@code synonyms} правил переноса): код базы → код посева. */
    static final Map<String, Map<String, String>> SYNONYMS = Map.of(
        "priority", Map.of("p0", "critical", "p1", "high", "p2", "normal", "p3", "low", "blocker", "critical", "medium", "normal"));

    /** Расширяемые справочники (как на проде): профили агентов заводит админ установки. */
    static final Set<String> EXTENSIBLE = Set.of("agent_profile");

    static final String INSERT_SQL =
        "INSERT INTO KnowDictEntry SET dict_type = :dict_type, code = :code, label_ru = :label_ru, "
            + "label_en = :label_en, icon = :icon, color = :color, sort_order = :sort_order, "
            + "is_active = true, is_extensible = :is_extensible";

    /** Что вставить: статьи, которых нет ни под своим кодом, ни под синонимом (без учёта регистра). */
    static List<StatusDictCoreSeed.Insert> plan(Map<String, Set<String>> existing) {
        Map<String, Set<String>> canon = new LinkedHashMap<>();
        for (String dict : SEEDS.keySet()) {
            Map<String, String> syn = SYNONYMS.getOrDefault(dict, Map.of());
            Set<String> have = new HashSet<>();
            for (String c : existing.getOrDefault(dict, Set.of())) {
                String low = c.toLowerCase(Locale.ROOT);
                have.add(syn.getOrDefault(low, low));
            }
            canon.put(dict, have);
        }
        return new ArrayList<>(StatusDictCoreSeed.plan(SEEDS, canon));
    }

    static Map<String, Object> params(StatusDictCoreSeed.Insert i) {
        Map<String, Object> p = new LinkedHashMap<>(i.params());
        p.put("is_extensible", EXTENSIBLE.contains(i.dictType()));
        return p;
    }
}
