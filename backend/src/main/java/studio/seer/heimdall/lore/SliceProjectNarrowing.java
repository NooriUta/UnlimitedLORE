package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Владелица 09.11.2026: «верхний фильтр по проектам не влияет на элементы внизу».
 *
 * <p>{@code ?scope_projects=a,b} у любого среза: выбор проектов в шапке v2 сужает выдачу.
 * Выбор ПЕРЕСЕКАЕТСЯ с правами вызывающего — сужает, но никогда не расширяет; отброшенные
 * проекты называются в ответе. Срез, не привязанный к проектам, сузить нечем — это сказано
 * словами ({@code applied:false} + причина), а выдача остаётся прежней: молча проигнорированный
 * фильтр выглядел бы как работающий.
 */
final class SliceProjectNarrowing {
    static final String PARAM = "scope_projects";

    /**
     * @param scope         множество проектов для {@link LoreSlices#compose(String, Map, Set)}
     *                      ({@code null} — без ограничения)
     * @param meta          отметка для ответа ({@code null} — параметра не было)
     * @param emptyByChoice ни один выбранный проект вызывающему не доступен: пусто по выбору,
     *                      а не «нет прав вообще» (тот случай — SCOPE_EMPTY, 403)
     */
    record Result(Set<String> scope, Map<String, Object> meta, boolean emptyByChoice) {}

    private SliceProjectNarrowing() {}

    /** Вынимает {@link #PARAM} из {@code given} (срез этого параметра не знает) и считает скоуп. */
    static Result apply(String sliceId, Map<String, String> given, Set<String> rowScope) {
        String raw = given.remove(PARAM);
        if (raw == null) return new Result(rowScope, null, false);
        List<String> requested = LoreSlices.listValue(PARAM, raw);

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("requested", requested);
        if (!LoreSlices.PROJECT_SCOPED.containsKey(sliceId)) {
            meta.put("applied", false);
            // Ревью 10.11, B11: текст отметки — в `note` (его читает клиент), не в `reason`.
            meta.put("note", "срез " + sliceId + " не привязан к проектам — сузить по выбранным проектам "
                + "нечем, показано всё доступное");
            return new Result(rowScope, meta, false);
        }
        Set<String> effective = new LinkedHashSet<>();
        List<String> dropped = new ArrayList<>();
        for (String p : requested) {
            if (rowScope == null || rowScope.contains(p)) effective.add(p);
            else dropped.add(p);
        }
        meta.put("applied", true);
        // Отброшенные называются один раз — списком dropped; та же фраза в note была дублем (ревью 10.11).
        meta.put("dropped", dropped);
        return new Result(effective, meta, effective.isEmpty());
    }
}
