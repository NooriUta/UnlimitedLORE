package studio.seer.heimdall.lore;

import java.util.regex.Pattern;

/**
 * Цвет статьи справочника — токен темы, не сырой цвет ([[task:SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS]], решение
 * владельца 25.11.2026, пункт 6а).
 *
 * <p>Почему: сырой {@code #hex} не следует палитре и режиму — в светлой теме бывает нечитаем, и свой стиль установки
 * (AP-APPEARANCE) его не перекрасит. На проде так было у 26 статей (task_type, gain_rank, job_kind, uc_goal_level,
 * work_class, uc_rigor), при том что area, product и статусы давно на токенах.
 *
 * <p>Годится {@code var(--токен)} или {@code color-mix(in <пространство>, A [N%], B [N%])}, где A и B — токены или
 * {@code transparent}. Пусто — «цвета нет», это не нарушение.
 */
final class DictColorToken {

    private DictColorToken() {}

    private static final String VAR = "var\\(--[a-z0-9_-]+\\)";
    private static final String ARG = "\\s*(?:" + VAR + "|transparent)(?:\\s+\\d{1,3}(?:\\.\\d+)?%)?\\s*";
    private static final Pattern TOKEN = Pattern.compile(
        VAR + "|color-mix\\(\\s*in\\s+[a-z-]+\\s*," + ARG + "," + ARG + "\\)");

    static boolean isToken(String color) {
        return color != null && TOKEN.matcher(color.trim()).matches();
    }

    /** Отказ словами или null: пусто и токен — годны. */
    static String refusal(String dictType, String code, String color) {
        if (color == null || color.isBlank() || isToken(color)) return null;
        return "цвет статьи " + dictType + "/" + code + " — токен темы (var(--…) или color-mix(in srgb,var(--…) N%,var(--…))), "
            + "а не «" + color + "»: сырой цвет не следует палитре и светлой теме";
    }
}
