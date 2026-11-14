package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * V90 — базовые статусы в справочниках task_status, sprint_status и adr_status
 * (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE).
 *
 * <p>Находка 14.11.2026 (SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES): на базе, поднятой
 * с нуля всеми миграциями, в task_status/sprint_status были только коды V85 (uat)
 * и V87 (waiting, review, failed), а adr_status не было вовсе. Остальные строки на
 * проде когда-то внесли руками, ни одна миграция их не заводила. Итог: LORE,
 * развёрнутый с нуля, отдавал модель с оговоркой «статус есть в жизненном цикле, но
 * его нет в справочнике», и клиент брал умолчание.
 *
 * <p>Значения — как строки, заведённые на проде (сняты 14.11 срезом dictionary;
 * task_status и sprint_status совпадают; у adr_status коды в верхнем регистре —
 * так на проде, модель сопоставляет их с циклом без учёта регистра). Вставляется
 * ТОЛЬКО недостающее (сравнение без учёта регистра): существующая строка не
 * переписывается, поэтому на проде шаг — no-op, и подписи, иконки, цвета, правленные
 * людьми, остаются как есть. Поэтому это Java-шаг, а не UPSERT, как в V85/V87:
 * UPSERT перекрасил бы прод.
 */
final class StatusDictCoreSeed {

    private StatusDictCoreSeed() {}

    record Entry(String code, String labelRu, String labelEn, String icon, String color, int sortOrder) {}

    record Insert(String dictType, Entry entry) {
        String code() { return entry.code(); }
        Map<String, Object> params() {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("dict_type", dictType);
            p.put("code", entry.code());
            p.put("label_ru", entry.labelRu());
            p.put("label_en", entry.labelEn());
            p.put("icon", entry.icon());
            p.put("color", entry.color());
            p.put("sort_order", entry.sortOrder());
            return p;
        }
    }

    /** Десять кодов задачи и спринта, которые не заводил ни один шаг. uat — V85; waiting, review, failed — V87. */
    static final List<Entry> CORE = List.of(
        new Entry("todo", "К выполнению", "To Do", "checkbox-tree", "var(--t3)", 10),
        new Entry("backlog", "Бэклог", "Backlog", "tied-scroll", "var(--t3)", 15),
        new Entry("planned", "Запланировано", "Planned", "calendar", "var(--wrn)", 20),
        new Entry("design", "Проектирование", "Design", "magic-swirl", "var(--wrn)", 25),
        new Entry("active", "В работе", "In Progress", "progression", "var(--inf)", 30),
        new Entry("partial", "Частично", "Partial", "battery-50", "var(--wrn)", 40),
        new Entry("ready_for_deploy", "Готово к деплою", "Ready for Deploy", "wave-crest", "var(--inf)", 50),
        new Entry("done", "Готово", "Done", "divided-spiral", "var(--suc)", 60),
        new Entry("blocked", "Заблокировано", "Blocked", "handcuffed", "var(--dng)", 70),
        new Entry("cancelled", "Отменено", "Cancelled", "cross-mark", "var(--t3)", 80));

    /** Статусы ADR — как на проде (коды в верхнем регистре, DEPRECATED тоже есть на проде). */
    static final List<Entry> ADR = List.of(
        new Entry("DRAFT", "Черновик", "Draft", "quill-ink", "var(--t3)", 5),
        new Entry("PROPOSED", "Предложен", "Proposed", "calendar", "var(--inf)", 10),
        new Entry("ACCEPTED", "Принят", "Accepted", "laurel-crown", "var(--suc)", 20),
        new Entry("DEFERRED", "Отложен", "Deferred", "pause-button", "var(--wrn)", 25),
        new Entry("DEPRECATED", "Устарел", "Deprecated", "broken-tablet", "var(--wrn)", 30),
        new Entry("SUPERSEDED", "Заменён", "Superseded", "pause-button", "var(--t3)", 40));

    /** Справочник → что в нём обязано быть. Порядок — порядок вставки. */
    static final Map<String, List<Entry>> SEEDS = seeds();

    private static Map<String, List<Entry>> seeds() {
        Map<String, List<Entry>> m = new LinkedHashMap<>();
        m.put("task_status", CORE);
        m.put("sprint_status", CORE);
        m.put("adr_status", ADR);
        return java.util.Collections.unmodifiableMap(m);
    }

    /** Чистая вставка: повтор отсекает план, а не перезапись. */
    static final String INSERT_SQL =
        "INSERT INTO KnowDictEntry SET dict_type = :dict_type, code = :code, label_ru = :label_ru, "
            + "label_en = :label_en, icon = :icon, color = :color, sort_order = :sort_order, "
            + "is_active = true, is_extensible = false";

    /** Коды, уже лежащие в справочнике. */
    static final String EXISTING_SQL = "SELECT code FROM KnowDictEntry WHERE dict_type = :dict_type";

    /**
     * Что вставить: коды из {@link #SEEDS}, которых нет в справочнике. Сравнение без учёта
     * регистра — как в модели (LoreModel.statusBlock): строка «proposed» уже закрывает «PROPOSED».
     * Существующие строки не трогаются. Справочник, которого нет в {@code existing}, — пустой.
     */
    static List<Insert> plan(Map<String, Set<String>> existing) {
        List<Insert> out = new ArrayList<>();
        for (Map.Entry<String, List<Entry>> s : SEEDS.entrySet()) {
            Set<String> have = new HashSet<>();
            for (String c : existing.getOrDefault(s.getKey(), Set.of())) have.add(c.toLowerCase(Locale.ROOT));
            for (Entry e : s.getValue())
                if (!have.contains(e.code().toLowerCase(Locale.ROOT))) out.add(new Insert(s.getKey(), e));
        }
        return out;
    }
}
