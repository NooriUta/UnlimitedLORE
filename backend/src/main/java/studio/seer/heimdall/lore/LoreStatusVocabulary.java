package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Locale;

/**
 * SPRINT_QG_REBUILD/QG-13 — единственный источник того, что значит статус.
 *
 * <p><b>Зачем.</b> Определение «закрыто» жило в корпусе три раза независимо:
 * {@code AidaLoreResource.classifyStatus()} (значок, затем слова подстрокой),
 * SQL-предикат в {@link LoreSlices} (только значок) и {@code taskTick()} во
 * фронтовом {@code lore-status.ts} (значок, затем слова якорем). Словари были
 * похожи, но не совпадали: {@code MERGED} знали двое из трёх, {@code ЗАКРЫТ} —
 * один, а SQL требовал {@code ЗАВЕРШЁН} строго через Ё, из-за чего
 * {@code ЗАВЕРШЕНО} через Е не считалось закрытым в SQL и считалось в Java.
 *
 * <p>Расхождение молчало: один спринт остался без даты закрытия, семь задач
 * числились открытыми (SPRINT_QG_REBUILD/QG-06). Ни один из трёх не знал о
 * существовании остальных, сверять было нечего.
 *
 * <h2>Почему слова сверяются якорем, а не подстрокой</h2>
 * Подстрока — прежнее поведение Java — считает закрытым {@code "NOT DONE"} и
 * {@code "⬜ TODO — (V1 ✅ DONE…)"}. Ровно на этом обжигались до AL-117.
 *
 * <p>Переход на якорь измерен, а не предположен: на 2026-08-26 в проде на 406
 * открытых состояний спринтов и 3 239 состояний задач приходится <b>ровно одно
 * значение без значка</b> — {@code "DONE"} (1 спринт + 7 задач). Все остальные
 * 15 различных значений начинаются со значка. То есть слой слов существует для
 * восьми строк, и сужение до якоря не может задеть ничего другого.
 *
 * <h2>Где источник правды</h2>
 * Не здесь. Канон — {@code shared/lore-statuses.json}, секция {@code statusMatch};
 * этот класс её <b>зеркало</b>, расхождение роняет
 * {@code LoreStatusesConsistencyTest} — тем же механизмом, каким уже защищены
 * {@code planStatuses} и {@code adrStatuses}. Заводить рядом с ним второй
 * канонический источник значило бы лечить дублирование дублированием.
 *
 * <p>Фронтовое зеркало ({@code taskTick()} в {@code lore-status.ts}) сверяется
 * своим механизмом — {@code scripts/check-lore-statuses.mjs}, как и остальные
 * TS/MCP-зеркала.
 *
 * <h2>Что НЕ унифицируется</h2>
 * Имена канонов у фронта свои ({@code active} там, где здесь
 * {@code in_progress}) — они завязаны на ключи {@code STATUS_META} и иконки, и
 * переименование задело бы UI целиком. Сверяется то, что расходилось молча и
 * стоило записей: значок и набор слов.
 */
final class LoreStatusVocabulary {

    private LoreStatusVocabulary() {}

    /**
     * Одна строка словаря: канон, значок-префикс и слова, по которым строка
     * опознаётся, когда значка нет.
     */
    record Entry(String canon, String marker, List<String> words) {}

    /**
     * Порядок значим: сначала все значки, потом слова в этом же порядке.
     * Порядок значков — канон SCD2 ({@code SCD2_STATUS_RAW}).
     */
    static final List<Entry> ENTRIES = List.of(
        new Entry("done",             "✅", List.of("DONE", "CLOSED", "MERGED", "ЗАВЕРШ", "ЗАКРЫТ")),
        new Entry("in_progress",      "🔄", List.of("IN PROGRESS", "IN-PROGRESS", "PROGRESS", "WIP", "ACTIVE")),
        new Entry("partial",          "🟡", List.of("PARTIAL", "ЧАСТИЧ")),
        new Entry("ready_for_deploy", "🚀", List.of("READY", "RFD", "К ДЕПЛОЮ", "ДЕПЛО")),
        new Entry("blocked",          "🔴", List.of("BLOCK", "ЗАБЛОК")),
        new Entry("cancelled",        "🚫", List.of("CANCEL", "ОТМЕН")),
        new Entry("design",           "🔬", List.of("DESIGN", "ДИЗАЙН", "ПРОЕКТ")),
        new Entry("backlog",          "🟣", List.of("BACKLOG", "БЭКЛОГ", "БЭКЛ")),
        new Entry("planned",          "📋", List.of("PLANNED", "ЗАПЛАН", "ПЛАН")),
        new Entry("deferred",         "⏸", List.of("DEFER", "ОТЛОЖ", "HOLD", "PAUSE", "CONDITION", "УСЛОВН", "ПАУ")),
        new Entry("todo",             "⬜", List.of("TODO", "TO DO", "НЕ НАЧАТ"))
    );

    /**
     * Статус не задан вовсе. Отдельно от {@code todo}: «поля нет» и «не начато»
     * — разные утверждения, и сваливать первое во второе значит придумывать факт
     * (ADR-LORE-039).
     */
    static final String NONE = "none";

    /** Канон строки статуса: значок в приоритете, затем слово в начале строки. */
    static String classify(String raw) {
        if (raw == null || raw.isBlank()) return NONE;
        String trimmed = raw.stripLeading();
        for (Entry e : ENTRIES) {
            if (trimmed.startsWith(e.marker())) return e.canon();
        }
        String upper = trimmed.toUpperCase(Locale.ROOT);
        for (Entry e : ENTRIES) {
            for (String w : e.words()) {
                if (upper.startsWith(w)) return e.canon();
            }
        }
        // Значок есть, слова не узнаны — строка написана не по канону. «todo»
        // здесь исторический выбор, сохранён: менять его без нужды значит
        // сдвинуть все счётчики разом.
        return "todo";
    }

    /** Все SQL-префиксы канона: значок и слова, в том же порядке. */
    static List<String> prefixesOf(String canon) {
        for (Entry e : ENTRIES) {
            if (e.canon().equals(canon)) {
                java.util.List<String> out = new java.util.ArrayList<>();
                out.add(e.marker());
                out.addAll(e.words());
                return List.copyOf(out);
            }
        }
        throw new IllegalArgumentException("неизвестный канон статуса: " + canon);
    }

    /**
     * SQL «выражение попадает хотя бы в один из канонов» — цепочка OR.
     * Вызывающий сам оборачивает в скобки там, где рядом есть AND.
     */
    static String anySql(String expr, String... canons) {
        StringBuilder sb = new StringBuilder();
        for (String canon : canons) {
            for (String p : prefixesOf(canon)) {
                if (sb.length() > 0) sb.append(" OR ");
                sb.append(expr).append(" LIKE '").append(p).append("%'");
            }
        }
        return sb.toString();
    }

    /**
     * SQL «выражение не попадает ни в один из канонов» — отрицание {@link
     * #anySql} по де Моргану, цепочкой {@code NOT LIKE}.
     *
     * <p>Не {@code NOT ( … OR … )} намеренно: поведение грамматики ArcadeDB на
     * такой форме в позиции WHERE не проверено, а тихо пустая выдача там
     * неотличима от «подходящих строк нет».
     */
    static String noneSql(String expr, String... canons) {
        StringBuilder sb = new StringBuilder();
        for (String canon : canons) {
            for (String p : prefixesOf(canon)) {
                if (sb.length() > 0) sb.append(" AND ");
                sb.append(expr).append(" NOT LIKE '").append(p).append("%'");
            }
        }
        return sb.toString();
    }
}
