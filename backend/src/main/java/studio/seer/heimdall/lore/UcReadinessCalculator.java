package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * PL-15 · ADR-LORE-029 (D17): готовность продуктового слоя ВЫЧИСЛЯЕТСЯ из
 * исполнения, а не объявляется.
 *
 * <h3>Почему вычислитель, а не поле</h3>
 * Статус, который ставят рукой, рано или поздно расходится с работой: сценарий
 * помечен shipped, а половина его задач открыта. D17 закрывает это по
 * построению — руками остаются только НАМЕРЕНИЯ (proposed/dropped), а факт
 * («делается», «выпущено», «в доработке») выводится из задач.
 *
 * <h3>Правило</h3>
 * <pre>
 *   нет REALIZES-задач        → статус не трогаем (живёт намерение автора)
 *   есть задачи, все done     → shipped
 *   есть открытые, был shipped→ in_rework   (реинжиниринг, OQ-022-REENG вариант «б»)
 *   есть открытые, не был     → active
 * </pre>
 * Родитель наследует транзитивно: shipped ⇔ все дети shipped; in_rework ⇔ хоть
 * один ребёнок in_rework. Лист без собственных задач считается по детям — так
 * промежуточные уровни (🪁 kite) не проваливаются мимо расчёта.
 *
 * <h3>Почему статус материализуется, а не считается слайсом</h3>
 * Считать на чтении честнее, но `shipped_at` всё равно требует записи (ADR-029
 * §2: факт первого выпуска обязан пережить реинжиниринг), а два источника
 * правды — вычисление на чтении и штамп на записи — разъезжаются. Поэтому
 * пишет один и тот же код, и пишет он только сюда: ручной shipped/active
 * REST-путь отклоняет (400).
 */
@ApplicationScoped
public class UcReadinessCalculator {

    private static final Logger LOG = Logger.getLogger(UcReadinessCalculator.class);

    /** Статусы, которые ставит ТОЛЬКО вычислитель. Руками — 400. */
    static final List<String> COMPUTED_STATUSES = List.of("active", "shipped", "in_rework");
    /** Намерения автора — единственное, что принимается от человека/агента. */
    static final List<String> INTENT_STATUSES = List.of("proposed", "dropped");

    /** Предел подъёма по иерархии — страховка от кольца в данных (цикл отбивается на записи, но данные могли прийти раньше защиты). */
    private static final int MAX_DEPTH = 20;

    @Inject LoreIngestService ingest;
    @Inject @RestClient LoreCommandClient writeClient;
    @Inject MartCredentials credentials;

    @ConfigProperty(name = "lore.db") String db;

    /**
     * Пересчитать сценарий по задаче, которая только что сменила статус.
     * Задача может не иметь REALIZES — тогда пересчитывать нечего.
     */
    public void recomputeForTask(String taskUid) {
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT out('REALIZES').uc_id AS ucs FROM KnowTask WHERE task_uid = :t", Map.of("t", taskUid));
            if (rows.isEmpty()) return;
            Object ucs = rows.get(0).get("ucs");
            if (!(ucs instanceof List<?> list)) return;
            for (Object uc : list) {
                if (uc != null) recompute(String.valueOf(uc), 0);
            }
        } catch (Exception e) {
            // Пересчёт — вторичное следствие смены статуса задачи. Сама смена уже
            // произошла и была тем, что просил вызывающий; ронять её ответ из-за
            // неудавшегося пересчёта нельзя. Но и молчать нельзя — расхождение
            // придётся искать глазами.
            LOG.warnf("[LORE READINESS] пересчёт по задаче %s не выполнен: %s", taskUid, e.getMessage());
        }
    }

    /** Пересчитать сценарий и поднять пересчёт к родителю. */
    public void recompute(String ucId) { recompute(ucId, 0); }

    private void recompute(String ucId, int depth) {
        if (depth > MAX_DEPTH) {
            LOG.warnf("[LORE READINESS] обход иерархии от %s превысил %d уровней — вероятен цикл в данных", ucId, MAX_DEPTH);
            return;
        }
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT status, shipped_at, " +
            "in('REALIZES').size() AS task_total, " +
            "in('REALIZES')[status_raw LIKE '%DONE%'].size() AS task_done, " +
            "out('DECOMPOSES_INTO').size() AS kid_total, " +
            "out('DECOMPOSES_INTO')[status = 'shipped'].size() AS kid_shipped, " +
            "out('DECOMPOSES_INTO')[status = 'in_rework'].size() AS kid_rework, " +
            "in('DECOMPOSES_INTO').uc_id AS parents " +
            "FROM KnowUseCase WHERE uc_id = :id", Map.of("id", ucId));
        if (rows.isEmpty()) return;
        Map<String, Object> r = rows.get(0);

        String stored = str(r.get("status"));
        // Намерение «отменено» вычислитель не перебивает: dropped — решение
        // человека о том, что сценарий не нужен, а не утверждение о работе.
        if ("dropped".equals(stored)) return;

        String computed = compute(
            num(r.get("task_total")), num(r.get("task_done")),
            num(r.get("kid_total")), num(r.get("kid_shipped")), num(r.get("kid_rework")),
            str(r.get("shipped_at")) != null);

        if (computed != null && !computed.equals(stored)) {
            StringBuilder sql = new StringBuilder("UPDATE KnowUseCase SET status = :s");
            // ADR-029 §2: shipped_at ставит СИСТЕМА при ПЕРВОМ достижении shipped
            // и больше не трогает — иначе доработка стёрла бы факт выпуска, а
            // отличить «выпущено и дорабатывается» от «ещё не выпускалось» стало
            // бы нечем.
            if ("shipped".equals(computed) && str(r.get("shipped_at")) == null) {
                sql.append(", shipped_at = :d");
            }
            sql.append(" WHERE uc_id = :id");
            Map<String, Object> p = new java.util.LinkedHashMap<>();
            p.put("s", computed);
            p.put("id", ucId);
            if (sql.indexOf(":d") >= 0) p.put("d", LocalDate.now().toString());
            writeClient.command(db, credentials.basicAuth(),
                new LoreCommandClient.LoreCommand("sql", sql.toString(), p)).await().indefinitely();
            LOG.debugf("[LORE READINESS] %s: %s → %s", ucId, stored, computed);
        }

        // Наверх — независимо от того, изменился ли этот узел: родитель мог
        // ждать именно этого ребёнка, а пересчёт «только при изменении» оставил
        // бы его в старом состоянии после ручной правки где-то ниже.
        if (r.get("parents") instanceof List<?> parents) {
            for (Object parent : parents) {
                if (parent != null) recompute(String.valueOf(parent), depth + 1);
            }
        }
    }

    /**
     * Чистая функция правила — вынесена, чтобы её можно было проверить без БД.
     * Возвращает null, когда считать не из чего (ни задач, ни детей): статус
     * остаётся тем намерением, которое поставил автор.
     */
    static String compute(int taskTotal, int taskDone,
                          int kidTotal, int kidShipped, int kidRework,
                          boolean wasShipped) {
        if (taskTotal == 0 && kidTotal == 0) return null;

        boolean tasksDone = taskTotal > 0 && taskDone == taskTotal;
        boolean kidsDone  = kidTotal > 0 && kidShipped == kidTotal;

        // Узел закрыт, когда закрыто ВСЁ, что у него есть: и собственные задачи,
        // и дети. Промежуточный уровень со своими задачами и своими детьми не
        // должен объявляться выпущенным по одной половине.
        boolean done = (taskTotal == 0 || tasksDone) && (kidTotal == 0 || kidsDone);
        if (done) return "shipped";

        if (kidRework > 0) return "in_rework";
        // Открытая работа поверх уже выпущенного — это доработка, а не откат к
        // «делается»: факт выпуска состоялся и не должен исчезать из отчётности.
        if (wasShipped) return "in_rework";
        return "active";
    }

    private static String str(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v);
        return s.isBlank() || "null".equals(s) ? null : s;
    }

    private static int num(Object v) { return v instanceof Number n ? n.intValue() : 0; }
}
