package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Сопоставление свободного текста ролей заявленным личностям (ADR-LORE-042).
 *
 * <p>Таблица построена по ЗАМЕРУ прода 30.08.2026, а не по догадке: 4114
 * заполненных значений, 73 различных написания при десяти заявленных личностях.
 * Каждая строка ниже покрывает конкретные записи, число которых посчитано.
 *
 * <p><b>Здесь только однозначное.</b> Сессии, проекты и проза (438 записей) в
 * таблицу НЕ входят и остаются в поле без ребра — сопоставить их значило бы
 * угадать. Их число печатает миграция, и ноль в нём был бы подозрителен: он
 * означал бы, что шаг сопоставил то, о чём решения не было.
 */
final class TaskRoleMapping {

    private TaskRoleMapping() {}

    /** Что вышло из сопоставления одного значения. */
    record Target(String identity, boolean isAgent, String profile, String model) {}

    /**
     * Владелец продукта. Шесть написаний одной учётной записи — и это не
     * курьёз: гейт самоприёмки сравнивает СТРОКИ, поэтому сегодня `owner` и
     * `omiloreadmin` для него разные люди, и запрет обходится сменой написания.
     */
    private static final String OWNER = "omiloreadmin";
    private static final String IVANOV = "ivanovalex32";

    /**
     * Единственная агентная личность, которая писала.
     *
     * <p>Решение владельца: «все агенты сейчас claude-full, разделение по ролям
     * не тестировали». Подтверждается журналом сессий: все 55 записей
     * принадлежат AGENT-FULL, у остальных шести личностей — ни одной.
     *
     * <p>Поэтому `architect`, `pm`, `analyst` в полях — НЕ шесть личностей, а
     * одна под заявленным профилем. Профиль сохраняется атрибутом ребра, а не
     * выбрасывается: он говорит, кем себя назвали, и это отдельный факт.
     */
    private static final String AGENT = "AGENT-FULL-msbt0fed";

    private static Map<String, Target> build() {
        Map<String, Target> m = new LinkedHashMap<>();

        // ── Люди ──────────────────────────────────────────────────────────
        for (String s : new String[]{"owner", "omiloreadmin", "letopisets", "владелец",
                                     "alexa", "NooriUta"}) {
            m.put(s, new Target(OWNER, false, null, null));
        }
        for (String s : new String[]{"Ivanov-AIvan", "ivanov"}) {
            m.put(s, new Target(IVANOV, false, null, null));
        }

        // ── Агент без профиля ─────────────────────────────────────────────
        for (String s : new String[]{"claude-full", "claude", "full", "claude-code", "claude-app"}) {
            m.put(s, new Target(AGENT, true, null, null));
        }

        // ── Агент под заявленным профилем ─────────────────────────────────
        // Профиль — УТВЕРЖДЕНИЕ, а не проверенный факт: разделение по ролям
        // заявлено, но не проверялось. Атрибут это и фиксирует.
        m.put("architect",       new Target(AGENT, true, "architect", null));
        m.put("architect-session", new Target(AGENT, true, "architect", null));
        m.put("pm",              new Target(AGENT, true, "pm", null));
        m.put("pm-session",      new Target(AGENT, true, "pm", null));
        m.put("developer",       new Target(AGENT, true, "developer", null));
        m.put("dev-agent-1",     new Target(AGENT, true, "developer", null));
        m.put("tester",          new Target(AGENT, true, "tester", null));
        m.put("tester-agent-1",  new Target(AGENT, true, "tester", null));
        m.put("analyst",         new Target(AGENT, true, "analyst", null));

        // ── Агент на названной модели ─────────────────────────────────────
        // Решение владельца: модель — необязательный атрибут ребра. Само по
        // себе значение отвечало на вопрос «на чём», стоя в поле «кто»: тот же
        // тип ошибки, что `high` (приоритет) в словаре статусов.
        m.put("claude-opus",   new Target(AGENT, true, null, "claude-opus"));
        m.put("claude-opus-5", new Target(AGENT, true, null, "claude-opus-5"));
        m.put("claude-opus5",  new Target(AGENT, true, null, "claude-opus-5"));
        m.put("claude-fable",  new Target(AGENT, true, null, "claude-fable"));
        m.put("claude-sonnet", new Target(AGENT, true, null, "claude-sonnet"));

        return Map.copyOf(m);
    }

    static final Map<String, Target> TABLE = build();

    /** {@code null} — значение не сопоставляется и остаётся в поле. */
    /**
     * Порядок проверок: СНАЧАЛА точное совпадение, потом префиксное правило.
     *
     * <p>Иначе `claude-opus-5` — ответ на «на чём», уже разобранный строкой
     * таблицы с атрибутом модели, — попал бы под правило «любой claude-* это
     * агент» и потерял модель. Правило, добавленное позже, не должно съедать
     * то, что уже умели различать.
     */
    static Target of(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        Target exact = TABLE.get(v);
        if (exact != null) return exact;
        return byPrefix(v);
    }

    /**
     * Любое {@code claude-<что-то>} — тот же единственный агент (TR-05,
     * согласовано владельцем 31.08.2026).
     *
     * <p><b>Почему это не догадка.</b> Владелец уже решила: «все агенты сейчас
     * claude-full, разделение по ролям не тестировали». Значит вопрос «кто»
     * имеет ровно один ответ, и суффикс на него не влияет: `claude-machine`,
     * `claude-minilore-srv`, `claude-печать` отвечают на «ГДЕ работала сессия»
     * — на вопрос, которого в модели ролей нет вовсе. Он есть в журнале сессий
     * агентов, и там ему место.
     *
     * <p>Замер корпуса: 22 написания за 320 строками — самая большая группа из
     * непокрытых 444.
     *
     * <p><b>Граница осталась.</b> Всё, что НЕ начинается на {@code claude-},
     * по-прежнему не сопоставляется: `rollout` похож на агента, `minilore-app`
     * на проект, `volva-team` на команду, а `claude-full + соседняя сессия` —
     * это два участника в одном поле. Их 124 строки, и они ждут владельца.
     * Сопоставить их значило бы вернуть ровно ту догадку, ради отказа от
     * которой таблица и писалась.
     */
    private static Target byPrefix(String v) {
        if (!v.startsWith("claude-")) return null;
        // ОДНО СЛОВО, и это не придирка. `claude-full + соседняя сессия` тоже
        // начинается на claude-, но означает ДВУХ участников в одном поле;
        // `mig_gen (внешний баг-репорт)` — имя с пояснением прозой. Правило,
        // сработавшее на них, записало бы одного вместо двоих и молча потеряло
        // второго — то есть выдало бы за факт ровно половину правды.
        // Поймано собственным тестом на границе: первая редакция правила эти
        // строки съедала.
        if (!SINGLE_TOKEN.matcher(v).matches()) return null;
        return new Target(AGENT, true, null, null);
    }

    /** Имя без пробелов, скобок, кавычек и знаков объединения. */
    private static final java.util.regex.Pattern SINGLE_TOKEN =
        java.util.regex.Pattern.compile("[\\w\\-.]+", java.util.regex.Pattern.UNICODE_CHARACTER_CLASS);
}
