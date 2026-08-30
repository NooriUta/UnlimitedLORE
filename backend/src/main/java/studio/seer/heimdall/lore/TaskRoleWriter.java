package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Чистая логика назначения роли на задаче (ADR-LORE-042, TR-04/TR-06).
 *
 * <p>Без БД и HTTP — по образцу {@link WorkQuality}: факты собирает вызывающий,
 * здесь только правила. Так их можно проверить тестом, а не прогоном.
 *
 * <p>Правила ровно те, которых у свободного поля не было ни одного, и потому
 * в нём накопились 73 написания на десять заявленных личностей.
 */
final class TaskRoleWriter {

    private TaskRoleWriter() {}

    /** Что делать вызывающему по итогам проверки. */
    enum Verdict {
        /** Ставить новое ребро. */
        CREATE,
        /** Держатель тот же — ничего не менять (ADR-LORE-043: unchanged ≠ noop). */
        UNCHANGED,
        /** Закрыть текущее ребро и открыть новое: смена держателя. */
        REPLACE,
        /** Отказ; причина в {@code message}. */
        REFUSE
    }

    /** Решение по одному назначению. */
    record Decision(Verdict verdict, String message, String replaces) {
        static Decision create()               { return new Decision(Verdict.CREATE, null, null); }
        static Decision unchanged()            { return new Decision(Verdict.UNCHANGED, null, null); }
        static Decision replace(String who)    { return new Decision(Verdict.REPLACE, null, who); }
        static Decision refuse(String why)     { return new Decision(Verdict.REFUSE, why, null); }
    }

    /**
     * Кандидаты, на которых можно сослаться: люди с ролью в проекте задачи плюс
     * заявленные агентные личности.
     *
     * <p>Решение владельца: «пусть сверяется с ролями в проекте на людей».
     * Список ВЫВОДИТСЯ из графа, а не вспоминается пишущим — в этом вся разница
     * с полем, куда можно было написать что угодно.
     */
    static List<String> candidates(Collection2 peopleInProject, Collection2 declaredAgents) {
        Set<String> all = new LinkedHashSet<>();
        all.addAll(peopleInProject.values());
        all.addAll(declaredAgents.values());
        return List.copyOf(all);
    }

    /** Минимальная обёртка, чтобы не тащить сюда типы графа. */
    record Collection2(List<String> values) {}

    /**
     * Проверить назначение роли.
     *
     * @param role       author | executor | reviewer | handoff
     * @param taskUid    задача
     * @param identity   кого назначают
     * @param known      допустимые личности (см. {@link #candidates})
     * @param currentHolders активные держатели ЭТОЙ роли на ЭТОЙ задаче
     */
    static Decision check(String role, String taskUid, String identity,
                          List<String> known, List<String> currentHolders) {

        if (role == null || !TaskRole.ALL.contains(role)) {
            return Decision.refuse(TaskRole.roleError(role));
        }
        if (identity == null || identity.isBlank()) {
            return Decision.refuse("не указано, кого назначать на роль '" + role + "'");
        }

        // Незаявленная личность — отказ СО СПИСКОМ. Просто «не найдено»
        // заставило бы угадывать снова, а угадывание уже дало 73 написания.
        if (!known.contains(identity)) {
            return Decision.refuse(TaskRole.unknownIdentityError(identity, known));
        }

        // Тот же держатель — не ошибка и не работа. ADR-LORE-043 различает
        // «прислали то же самое» и «сделать не удалось»: первое законно.
        if (currentHolders.contains(identity)) {
            return Decision.unchanged();
        }

        // Толпа. Для author/executor держатель один: «двое делают» на практике
        // означает, что не делает никто конкретный.
        if (TaskRole.SINGLE_HOLDER.contains(role) && !currentHolders.isEmpty()) {
            // Это НЕ отказ, а смена: старое ребро закрывается, новое
            // открывается. Отказать значило бы требовать снимать держателя
            // отдельным вызовом — и потерять причину смены между вызовами.
            return Decision.replace(currentHolders.get(0));
        }

        return Decision.create();
    }

    /**
     * Проверить вердикт ревью.
     *
     * <p>Вердикт бывает только у {@code reviewer}. У {@code handoff} его нет и
     * быть не может: он ничего не оценивал. Разрешить ему вердикт значило бы
     * вернуть склейку «подхватил» и «проверил», ради разведения которой роль и
     * появилась.
     */
    static Decision checkVerdict(String role, String verdict) {
        if (verdict == null || verdict.isBlank()) return Decision.unchanged();
        if (!TaskRole.canGiveVerdict(role)) {
            return Decision.refuse("вердикт бывает только у роли '" + TaskRole.REVIEWER
                + "', а роль здесь '" + role + "'. " + (TaskRole.HANDOFF.equals(role)
                ? "handoff принял работу к продолжению и ничего не оценивал — "
                  + "засчитывать это за проверку нельзя."
                : "оценивает работу ревьюер."));
        }
        if (!VERDICTS.contains(verdict)) {
            return Decision.refuse("verdict='" + verdict + "' не бывает. Допустимо: "
                + String.join(" | ", VERDICTS));
        }
        return Decision.create();
    }

    /** Исход ревью. Закрытый список: свободный текст здесь повторил бы историю ролей. */
    static final List<String> VERDICTS = List.of("accepted", "rework", "accepted_with_notes");

    /**
     * Ответ по ADR-LORE-043: называет ПРОИЗОШЕДШЕЕ, а не факт вызова.
     *
     * <p>Значение выводится из решения, а не назначается вызывающим — иначе
     * {@code outcome} стал бы вторым {@code ok}, проставляемым не глядя.
     */
    static Map<String, Object> describe(Decision d, String role, String identity) {
        Map<String, Object> out = new LinkedHashMap<>();
        switch (d.verdict()) {
            case CREATE    -> { out.put("outcome", "created");   out.put("role", role); out.put("identity", identity); }
            case UNCHANGED -> { out.put("outcome", "unchanged"); out.put("role", role); out.put("identity", identity);
                                out.put("hint", "эта роль уже за " + identity + " — ничего не изменилось"); }
            case REPLACE   -> { out.put("outcome", "updated");   out.put("role", role); out.put("identity", identity);
                                out.put("replaced", d.replaces());
                                out.put("hint", "прежнее назначение закрыто, а не стёрто: "
                                    + "историю смен видно по valid_to"); }
            case REFUSE    -> { out.put("outcome", "noop");      out.put("reason", d.message()); }
        }
        return out;
    }

    /** Пакет назначений: счётчики вместо «сделано» (ADR-LORE-043 §4). */
    static Map<String, Object> summarise(List<Decision> decisions) {
        int created = 0, updated = 0, unchanged = 0, refused = 0;
        List<String> reasons = new ArrayList<>();
        for (Decision d : decisions) {
            switch (d.verdict()) {
                case CREATE -> created++;
                case REPLACE -> updated++;
                case UNCHANGED -> unchanged++;
                case REFUSE -> { refused++; reasons.add(d.message()); }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("created", created);
        out.put("updated", updated);
        out.put("unchanged", unchanged);
        // Ноль отказов — тоже результат, и он виден: молчание о них было бы
        // ровно тем, против чего написан ADR-LORE-043.
        out.put("refused", refused);
        if (!reasons.isEmpty()) out.put("refusals", reasons);
        return out;
    }
}
