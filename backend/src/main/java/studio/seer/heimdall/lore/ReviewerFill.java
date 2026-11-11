package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-REVIEWER-AUTHOR — ревьюер задачи при смене статуса.
 *
 * <p><b>Почему.</b> 11.11 при пакетном закрытии 27 задач под учёткой агента
 * ревьюера выставляли руками: запись статуса не связывала действие с человеком,
 * от имени которого пишет агент.
 *
 * <p><b>Правило (владелица 11.11):</b>
 * <ul>
 *   <li>смена статуса под учёткой АГЕНТА → ревьюер — человек, от имени которого
 *       пишет агент: владелец актора-агента (ребро {@code OWNED_BY}, ADR-LORE-036);
 *       сессия агента сама владельца не несёт — {@code KnowAgentSession} висит на том
 *       же акторе ({@code LOGGED_BY}), значит человек тот же;</li>
 *   <li>под учёткой ЧЕЛОВЕКА → ревьюер — сам этот человек ({@code KnowUser} по
 *       {@code kc_sub} из токена).</li>
 * </ul>
 *
 * <p><b>Только если ревьюера на задаче нет.</b> Назначенный ревьюер — решение
 * человека, и смена статуса его не переписывает. Гейт приёмки (ADR-LORE-014 §4)
 * не ослабляется: он проверяется ДО смены статуса по тому, что было на задаче.
 *
 * <p>Личность — только из проверенного токена ({@link ChangeAuthor}), не из тела.
 * Чистая часть — здесь; запись идёт единственной точкой ролей {@link TaskRoleService}.
 */
final class ReviewerFill {

    private ReviewerFill() {}

    enum Action { FILL, KEEP, SKIP }

    /**
     * @param identity кого ставим (FILL) или кто уже стоит (KEEP)
     * @param source   откуда личность: {@code agent_owner} | {@code self}
     * @param reason   почему не поставили (SKIP)
     */
    record Decision(Action action, String identity, String source, String reason) {}

    record Query(String sql, Map<String, Object> params) {}

    /** Как найти человека-инициатора: у агента — владелец, у человека — он сам. */
    static Query resolveQuery(ChangeAuthor author) {
        if (author == null || author.by() == null) return null;
        if (ChangeAuthor.KIND_AGENT.equals(author.kind()))
            return new Query("SELECT out('OWNED_BY').display_name AS names FROM KnowActor WHERE client_id = :c",
                Map.of("c", author.by()));
        if (ChangeAuthor.KIND_HUMAN.equals(author.kind()))
            return new Query("SELECT display_name AS names FROM KnowUser WHERE kc_sub = :s",
                Map.of("s", author.by()));
        return null;
    }

    /**
     * @param currentReviewers держатели роли reviewer сейчас (открытые рёбра)
     * @param humans           найденные по {@link #resolveQuery} имена людей
     */
    static Decision decide(ChangeAuthor author, List<String> currentReviewers, List<String> humans) {
        if (currentReviewers != null && !currentReviewers.isEmpty())
            return new Decision(Action.KEEP, String.join(", ", currentReviewers), null, null);
        boolean agent = author != null && ChangeAuthor.KIND_AGENT.equals(author.kind());
        boolean human = author != null && ChangeAuthor.KIND_HUMAN.equals(author.kind());
        if (!agent && !human)
            return new Decision(Action.SKIP, null, null,
                "автор смены статуса не опознан (нет проверенного токена) — ревьюера подставить не из кого");
        List<String> names = humans == null ? List.of()
            : humans.stream().filter(n -> n != null && !n.isBlank()).distinct().toList();
        String source = agent ? "agent_owner" : "self";
        if (names.isEmpty())
            return new Decision(Action.SKIP, null, source, agent
                ? "у агента '" + author.by() + "' нет владельца (OWNED_BY) — назначьте его в админке «Агенты»"
                : "человек '" + author.by() + "' не заведён в графе (KnowUser) — ревьюер не подставлен");
        if (names.size() > 1)
            return new Decision(Action.SKIP, null, source,
                "владельцев у агента несколько (" + String.join(", ", names) + ") — кого ставить, неоднозначно");
        return new Decision(Action.FILL, names.get(0), source, null);
    }

    /**
     * Поле {@code reviewer} ответа status_set.
     *
     * @param applied тело ответа TaskRoleService (null — запись не делалась)
     */
    static Map<String, Object> answer(Decision d, Map<String, Object> applied) {
        Map<String, Object> out = new LinkedHashMap<>();
        switch (d.action()) {
            case KEEP -> { out.put("outcome", "kept"); out.put("identity", d.identity()); }
            case SKIP -> { out.put("outcome", "skipped"); out.put("reason", d.reason()); }
            case FILL -> {
                boolean refused = applied != null && "noop".equals(applied.get("outcome"));
                out.put("outcome", refused ? "refused" : "filled");
                out.put("identity", d.identity());
                if (refused && applied.get("reason") != null) out.put("reason", applied.get("reason"));
            }
        }
        if (d.source() != null) out.put("source", d.source());
        return out;
    }
}
