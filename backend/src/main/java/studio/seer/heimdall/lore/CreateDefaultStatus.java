package studio.seer.heimdall.lore;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Статус по умолчанию при создании записи — начальный статус её типа по модели.
 *
 * <p>Слова владелицы 16.11.2026: «для спринтов и задач верно, для остальных по аналогии выбирать первый
 * статус и делать статусом по умолчанию». Правило владелицы 19.11.2026: «ставить начальный, где без статуса»,
 * «не только в файл решений, правь бэк».
 *
 * <p>Единственная реализация правила в бэкенде. Значение не зашито в код: это поле {@code initial} у статуса
 * типа в модели ({@code shared/model/lore-model.json}, копия бэкенда — {@code lore-model/lore-model.json}).
 * Значение записано в форме хранения бэкенда. Справочник поменяется — меняется модель, а не этот класс.
 * Выборы владелицы при переносе (ST-xx в файле решений установщика) сюда не попадают.
 *
 * <p>Подстановка не молчаливая: {@link #report} кладёт в ответ записи {@code defaulted: {status: {value, from}}}.
 */
final class CreateDefaultStatus {

    private CreateDefaultStatus() {}

    /** Тип модели → начальный статус ({@code initial} поля {@code status}); типы и дочерние типы модели. */
    static final Map<String, String> FIRST = fromModel(LoreModelFile.content());

    static Map<String, String> fromModel(LoreModelFile.Content c) {
        Map<String, String> m = new LinkedHashMap<>();
        for (Map<String, LoreRecordRegistry.TypeDef> defs : java.util.List.of(c.typeDefs(), c.childOnly()))
            for (Map.Entry<String, LoreRecordRegistry.TypeDef> e : defs.entrySet())
                for (LoreRecordRegistry.Field f : e.getValue().fields())
                    if ("status".equals(f.key()) && f.initial() != null && !f.initial().isBlank()) m.putIfAbsent(e.getKey(), f.initial());
        return Collections.unmodifiableMap(m);
    }

    /** Итог выбора статуса: значение, подставлено ли оно и откуда. */
    record Pick(String value, boolean defaulted, String from) {}

    /** Названный статус — как есть; не назван — начальный статус типа по модели. */
    static Pick pick(String type, String given) {
        if (given != null && !given.isBlank()) return new Pick(given, false, null);
        String first = FIRST.get(type);
        if (first == null) throw new IllegalArgumentException("у типа «" + type + "» в модели нет начального статуса (status.initial)");
        return new Pick(first, true, "модель: " + type + ".status.initial");
    }

    /** Названный статус — как есть; не назван — начальный статус типа по модели. */
    static String forNew(String type, String given) {
        return pick(type, given).value();
    }

    /** Подстановка — в ответ записи: {@code defaulted.status = {value, from}}. Названный статус ответ не меняет. */
    static void report(Map<String, Object> out, Pick p) {
        if (p == null || !p.defaulted()) return;
        @SuppressWarnings("unchecked")
        Map<String, Object> d = (Map<String, Object>) out.computeIfAbsent("defaulted", k -> new LinkedHashMap<String, Object>());
        d.put("status", Map.of("value", p.value(), "from", p.from()));
    }

    /** Строка хранения первого статуса фазы (фаза хранит статус в форме задачи). */
    static String phaseRaw() {
        return LoreResourceBase.SCD2_STATUS_RAW.get(FIRST.get("phase"));
    }
}
