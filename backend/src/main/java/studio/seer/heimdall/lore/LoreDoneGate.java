package studio.seer.heimdall.lore;

import java.util.List;

/**
 * Гейт смены статуса задачи — SPRINT_LORE_WORK_ANY_KIND/WK-05, решение ADR-LORE-014-D5
 * (заменяет соло-закрытие ADR-LORE-014-D4; допущения A1–A6 подтверждены владелицей 14.11.2026).
 *
 * <p>Переход в done:
 * <ol>
 *   <li>агент не ставит done никогда — 409 DONE_BY_HUMAN_ONLY;</li>
 *   <li>только из review (ready_for_deploy и uat — его стадии) — 409 DONE_ONLY_FROM_REVIEW;</li>
 *   <li>приёмщика нет — закрывающий человек становится им сам (подставляет fillReviewer), но не если он
 *       исполнитель — 409 NO_REVIEWER; приёмщик = исполнитель — 409 REVIEWER_IS_EXECUTOR;</li>
 *   <li>доказательство по виду работы (раздел модели workflow) — 409 NO_EVIDENCE со списком.</li>
 * </ol>
 * Прочие переходы: blocked и возврат с приёмки — с причиной (400 REASON_REQUIRED), waiting — с
 * адресатом (400 WAITING_FOR_REQUIRED). Решения чистые — без базы, факты собирает вызывающий.
 */
final class LoreDoneGate {

    private LoreDoneGate() {}

    /**
     * @param agent        вызывающий — агент (у токена agent_scope или автор вида agent)
     * @param caller       имя вызывающего человека (display_name), null — не опознан
     * @param currentToken текущий статус задачи токеном (rawToToken)
     * @param evidenceType тип доказательства — из запроса, иначе прикреплённый ранее
     */
    record Facts(boolean agent, String caller, String executor, String reviewer, String currentToken,
                 String taskType, String evidenceType, String evidenceRef) {}

    record Verdict(int status, String code, String detail) {}

    static final String DEFAULT_KIND = "dev";

    /** Вид работы по типу задачи; тип пуст или вне таблицы — dev (допущение A4). */
    static String kindOf(String taskType, LoreModelWorkflow.Workflow w) {
        String k = w.kindOf(taskType);
        return k != null ? k : DEFAULT_KIND;
    }

    static Verdict done(Facts f, LoreModelWorkflow.Workflow w) {
        if (f.agent())
            return new Verdict(409, "DONE_BY_HUMAN_ONLY", "агент не ставит done — переведите задачу в review "
                + "(стадия stand_check или uat), done ставит человек-приёмщик (ADR-LORE-014-D5, правило 13.11.2026)");
        if (!"review".equals(LoreWorkflowCore.core(f.currentToken())))
            return new Verdict(409, "DONE_ONLY_FROM_REVIEW", "done ставится только из review (приёмки); сейчас «"
                + f.currentToken() + "» — сначала переведите в review, приложив доказательство");
        boolean noReviewer = blank(f.reviewer());
        if (noReviewer && !blank(f.caller()) && f.caller().equals(f.executor()))
            return new Verdict(409, "NO_REVIEWER", "приёмщика нет, а закрывает исполнитель — самоприёмка; "
                + "назначьте приёмщика (reviewer_agent), отличного от исполнителя");
        if (!noReviewer && f.reviewer().equals(f.executor()))
            return new Verdict(409, "REVIEWER_IS_EXECUTOR", "приёмщик совпадает с исполнителем (" + f.executor() + ")");
        String kind = kindOf(f.taskType(), w);
        LoreModelWorkflow.Kind k = w.kinds().get(kind);
        List<String> allowed = k.evidence().stream().map(LoreModelWorkflow.Evidence::type).toList();
        String need = String.join("; ", k.evidence().stream().map(e -> e.type() + " — " + e.label()).toList());
        if (blank(f.evidenceType()) || blank(f.evidenceRef()))
            return new Verdict(409, "NO_EVIDENCE", "для вида «" + k.label() + "» done требует доказательства: " + need
                + ". Передайте evidence_type и evidence_ref — запись не сделана");
        if (!allowed.contains(f.evidenceType()))
            return new Verdict(409, "NO_EVIDENCE", "доказательство «" + f.evidenceType() + "» не подходит виду «"
                + k.label() + "»; подходит: " + need);
        return null;
    }

    static Verdict transition(String currentToken, String target, String reason, String waitingFor) {
        if ("blocked".equals(target) && blank(reason))
            return new Verdict(400, "REASON_REQUIRED", "у blocked обязательна причина (reason) — без неё блокировку "
                + "не отличить от забытой задачи");
        if ("review".equals(LoreWorkflowCore.core(currentToken)) && "active".equals(LoreWorkflowCore.core(target)) && blank(reason))
            return new Verdict(400, "REASON_REQUIRED", "возврат с приёмки — с причиной (reason): исполнитель должен знать, что переделать");
        if ("waiting".equals(target) && blank(waitingFor))
            return new Verdict(400, "WAITING_FOR_REQUIRED", "укажите, чьего ответа ждём (waiting_for): waiting без адресата не отличить от blocked");
        return null;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
