package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Locale;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-11 — статус при создании задачи.
 *
 * <p>Раньше {@code POST /lore/task} статуса не принимал: задача всегда рождалась «запланирована»,
 * а присланный {@code status} молча выбрасывался. Теперь статус принимается и записывается.
 *
 * <p>Правило владелицы 16.11.2026: «если статус не указан при создании — ставим первый статус,
 * в бэклог»; пустого статуса у задачи не бывает ни при создании, ни при смене.
 *
 * <p>При создании допустимы только статусы, которым не нужны слова и доказательства. Закрытие,
 * приёмка, блокировка и ожидание идут через смену статуса ({@code POST /lore/status}): там проверяются
 * доказательство, причина и «кого ждём» — создание не должно быть путём мимо этих проверок.
 */
final class TaskCreateStatus {

    private TaskCreateStatus() {}

    static final List<String> ALLOWED = List.of("planned", "todo", "backlog", "design", "active");

    /** Первый статус: с него задача начинается, когда создающий статуса не назвал. Из модели (task.status.initial). */
    static final String DEFAULT = CreateDefaultStatus.FIRST.get("task");

    /** Статус не назван — будет поставлен {@link #DEFAULT}. */
    static boolean defaulted(String status) {
        return token(status).isEmpty();
    }

    private static String token(String status) {
        return status == null ? "" : status.trim().toLowerCase(Locale.ROOT);
    }

    /** Причина отказа либо {@code null}, если статус годится для создания. */
    static String refuse(String status) {
        String t = token(status);
        if (t.isEmpty() || ALLOWED.contains(t)) return null;
        if (LoreResourceBase.SCD2_STATUS_RAW.containsKey(t))
            return "задача не создана: статус «" + t + "» при создании не ставится — он требует причины или доказательства; "
                + "создайте задачу в одном из " + String.join(", ", ALLOWED) + " и переведите через status_set";
        return "задача не создана: незнакомый статус «" + status.trim() + "» (ключ status). При создании допустимы: "
            + String.join(", ", ALLOWED) + "; остальные статусы ставятся через status_set";
    }

    /** Строка хранения статуса; вызывать после {@link #refuse}. */
    static String raw(String status) {
        return LoreResourceBase.SCD2_STATUS_RAW.get(defaulted(status) ? DEFAULT : token(status));
    }
}
