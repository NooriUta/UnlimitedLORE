package studio.seer.heimdall.lore;

import java.util.OptionalInt;
import java.util.Set;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-03 — квоты агентов, чистая часть.
 *
 * <p>Два уровня, как у образца (Völva: лимит группы и лимит инстанса): потолок на агента
 * (профиль agent_scope) и потолок на весь контур. Второй из первого не выводится — контур
 * может выбрать потолок, когда ни один агент свой не выбрал.
 *
 * <p>Расход считается по журналу действий AO-01 ({@code AgentActionLog}, D-2026-LORE-AGENT-
 * MACHINE-EVERYWHERE п.4; ось agent) за окно. Третий уровень — потолок на клиента KC (тег
 * {@code client}): одним профилем ходят разные клиенты, и «по клиенту» — их собственный счёт — своего счётчика нет, иначе две правды о расходе.
 * Журналируются только мутации, поэтому квота — на запись, чтение не считается.
 *
 * <p>Отказ — жёсткий (решение задачи: мягкий лимит без места, куда смотреть, равен
 * отсутствию лимита): код и причина словами. Потолки задаются конфигом и по умолчанию
 * ВЫКЛЮЧЕНЫ — значения решает владелица.
 */
final class AgentQuota {

    private AgentQuota() {}

    static final String PER_AGENT = "lore.agent.quota.per-agent";
    static final String TOTAL = "lore.agent.quota.total";
    static final String WINDOW = "lore.agent.quota.window";
    static final String PER_CLIENT = "lore.agent.quota.per-client";

    static final String AGENT_SQL = "SELECT count(*) AS n FROM AgentActionLog "
        + "WHERE segment = 'agent' AND source = :scope AND ts >= :from";
    static final String TOTAL_SQL = "SELECT count(*) AS n FROM AgentActionLog "
        + "WHERE segment = 'agent' AND ts >= :from";
    static final String CLIENT_SQL = "SELECT count(*) AS n FROM AgentActionLog "
        + "WHERE segment = 'agent' AND client = :client AND ts >= :from";

    /**
     * Считать ли потолок клиента. «Неизвестно» и пусто — не клиент: иначе все агенты без
     * client_id делили бы один общий потолок, которого никто не выбирал.
     */
    static boolean countsPerClient(String client) {
        return client != null && !client.isBlank() && !AgentMachine.UNKNOWN.equals(client)
            && !AgentMachine.NOT_APPLICABLE.equals(client);
    }

    private static final Set<String> READS = Set.of("GET", "HEAD", "OPTIONS");

    record Denial(String code, String reason) {}

    /** Квота касается только записи агента: чтение и человек не считаются. */
    static boolean applies(String method, String agentScope) {
        return agentScope != null && method != null && !READS.contains(method.toUpperCase(java.util.Locale.ROOT));
    }

    /**
     * Решение по уже посчитанному расходу. {@code null} — пропустить.
     * Порог включительный: при потолке 100 сотое действие за окно — последнее разрешённое
     * уже записано, следующий вызов отказывает.
     */
    static Denial judge(String scope, OptionalInt perAgent, OptionalInt total, long agentCount, long totalCount) {
        return judge(scope, null, perAgent, OptionalInt.empty(), total, agentCount, 0, totalCount);
    }

    /** То же с потолком клиента: профиль → клиент → контур, первый исчерпанный отказывает. */
    static Denial judge(String scope, String client, OptionalInt perAgent, OptionalInt perClient, OptionalInt total,
                        long agentCount, long clientCount, long totalCount) {
        if (perAgent.isPresent() && agentCount >= perAgent.getAsInt())
            return new Denial("AGENT_QUOTA_EXCEEDED", "профиль агента '" + scope + "' исчерпал квоту записи: "
                + agentCount + " из " + perAgent.getAsInt() + " за окно (" + PER_AGENT + ")");
        if (perClient.isPresent() && countsPerClient(client) && clientCount >= perClient.getAsInt())
            return new Denial("CLIENT_QUOTA_EXCEEDED", "клиент '" + client + "' исчерпал квоту записи: "
                + clientCount + " из " + perClient.getAsInt() + " за окно (" + PER_CLIENT + ")");
        if (total.isPresent() && totalCount >= total.getAsInt())
            return new Denial("TOTAL_QUOTA_EXCEEDED", "контур агентов исчерпал общую квоту записи: "
                + totalCount + " из " + total.getAsInt() + " за окно (" + TOTAL + ")");
        return null;
    }
}
