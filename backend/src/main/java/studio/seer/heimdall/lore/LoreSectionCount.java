package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-07 — одно правило счётчиков на все места
 * (меню, фасет, вид).
 *
 * <p><b>Правило.</b> Число = <b>открытые</b> записи <b>в скоупе</b> вызывающего и
 * <b>с текущими фильтрами</b> среза; закрытые ({@code finished|withdrawn}) идут
 * отдельным слагаемым — клиент рисует «142 · +361». Открыто/закрыто решает
 * категория статуса S1-06 ({@link LoreStatusCategory}), а не клиент: иначе
 * {@code accepted} у ADR снова уехал бы в «закрытые». Нераспознанный статус —
 * {@code unknown}, открыт.
 *
 * <p><b>Честность числа.</b> Ответ несёт {@code scope} (сужено ли скоупом) и
 * {@code filters} (какие фильтры учтены), а обрезанная выдача — {@code completeness}
 * {@code partial}/{@code unknown}: неполное число не выдаётся за точное.
 * Страница ({@code limit/offset/fields}) в счётчик не входит — считается вся
 * отфильтрованная выдача.
 *
 * <p>Форма ответа — {@code SectionCount} из SPEC-LORE-UXR-S1-CONTRACTS, контракт 3
 * ({@code src/api/contracts/s1.ts}), ключи и их порядок — оттуда же.
 */
final class LoreSectionCount {

    private LoreSectionCount() {}

    /** Параметры страницы — не фильтры: в счётчик и в {@code filters} не попадают. */
    static final Set<String> PAGE_PARAMS = Set.of("limit", "offset", "fields");

    /** Срез считается, только если известно, каким полем он несёт статус какого типа. */
    static boolean isCountable(String sliceId) {
        return sliceId != null && LoreStatusCategory.SLICE_STATUS.containsKey(sliceId);
    }

    /** Фильтры запроса без параметров страницы, в порядке прихода. */
    static Map<String, String> filtersOf(Map<String, String> given) {
        Map<String, String> out = new LinkedHashMap<>();
        if (given == null) return out;
        given.forEach((k, v) -> { if (!PAGE_PARAMS.contains(k)) out.put(k, v); });
        return out;
    }

    /**
     * Счётчик секции по телу среза (как его собирает {@code AidaLoreResource.sliceBody}
     * плюс {@code scope}).
     *
     * @throws IllegalArgumentException срез без статуса — открытых/закрытых у него нет
     */
    static Map<String, Object> count(String sliceId, Map<String, Object> body, Map<String, String> filters) {
        LoreStatusCategory.StatusSource src = LoreStatusCategory.SLICE_STATUS.get(sliceId);
        if (src == null) {
            throw new IllegalArgumentException("slice " + sliceId + " has no status field — "
                + "open/closed count is undefined (countable: " + String.join(",", countableSlices()) + ")");
        }
        Object raw = body == null ? null : body.get("rows");
        List<?> rows = raw instanceof List<?> l ? l : List.of();

        Map<String, Integer> byCategory = new LinkedHashMap<>();
        int open = 0;
        int closed = 0;
        for (Object o : rows) {
            Object status = o instanceof Map<?, ?> m ? m.get(src.field()) : null;
            String cat = LoreStatusCategory.of(src.type(), status);
            byCategory.merge(cat, 1, Integer::sum);
            if (LoreStatusCategory.isClosed(cat)) closed++; else open++;
        }

        Object truncated = body == null ? null : body.get("truncated");
        String completeness = Boolean.TRUE.equals(truncated) ? "partial"
            : "unknown".equals(truncated) ? "unknown"
            : "complete";

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("section", sliceId);
        out.put("open", open);
        out.put("closed", closed);
        out.put("byCategory", byCategory);
        out.put("scope", body == null ? null : body.get("scope"));
        out.put("filters", filtersOf(filters));
        out.put("completeness", completeness);
        return out;
    }

    static List<String> countableSlices() {
        return LoreStatusCategory.SLICE_STATUS.keySet().stream().sorted().toList();
    }
}
