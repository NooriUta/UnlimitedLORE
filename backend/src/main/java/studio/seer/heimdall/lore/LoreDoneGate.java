package studio.seer.heimdall.lore;

import java.util.List;

/**
 * Гейт смены статуса задачи — SPRINT_LORE_WORK_ANY_KIND/WK-05, решение ADR-LORE-014-D5
 * (заменяет соло-закрытие ADR-LORE-014-D4; допущения A1–A6 подтверждены владелицей 14.11.2026).
 *
 * <p>Переход в done:
 * <ol>
 *   <li>агент не ставит done — 409 DONE_BY_HUMAN_ONLY; исключение — слово владелицы
 *       ({@link #OWNER_WORD} с непустым evidence_ref, решение 14.11.2026 D4);</li>
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

    /**
     * Вид доказательства «слово владелицы» — решение 14.11.2026 (D4, «вариант б»): с ним done может
     * поставить и агент; evidence_ref обязателен (дословная цитата или ссылка на её сообщение).
     * Годится для любого вида работы — приёмку делает сама владелица. Прочие проверки (только из
     * review, приёмщик ≠ исполнитель) остаются.
     */
    static final String OWNER_WORD = "owner_word";

    /** Вид работы по типу задачи; тип пуст или вне таблицы — dev (допущение A4). */
    static String kindOf(String taskType, LoreModelWorkflow.Workflow w) {
        String k = w.kindOf(taskType);
        return k != null ? k : DEFAULT_KIND;
    }

    /**
     * PU-29, правило владелицы 14.11.2026: done человека — само подтверждение («я нажала кнопку — это моё
     * решение»). Сервер пишет доказательство сам: вид {@code human}, ссылка «кто · когда».
     */
    static final String HUMAN = "human";

    /** Время (08:31) или дата (14.11 / 2026-11-14) — когда сказано. */
    private static final java.util.regex.Pattern WHEN =
        java.util.regex.Pattern.compile("\\d{1,2}[:.]\\d{2}|\\d{4}-\\d{2}-\\d{2}");
    /** Дословная цитата в кавычках: «…», "…" или „…“. */
    private static final java.util.regex.Pattern QUOTE =
        java.util.regex.Pattern.compile("«[^»]{2,}»|\"[^\"]{2,}\"|„[^“”]{2,}[“”]");

    /** Ссылка доказательства человека: имя (или «человек», если не опознан) · время. */
    static String humanEvidenceRef(String caller, String at) {
        return (blank(caller) ? "человек" : caller.trim()) + " · " + at;
    }

    static Verdict done(Facts f, LoreModelWorkflow.Workflow w) {
        // PU-29 (14.11.2026): «учётка не агента, а человека — тоже подтверждение; просто проверяй, что
        // перенесено человеком, и не проси с человека доп. работы». Человек закрывает из любого статуса.
        if (!f.agent()) return null;
        // MDL-11: задача уже закрыта — так и сказать, а не посылать в review.
        if ("done".equals(LoreWorkflowCore.core(f.currentToken())))
            return new Verdict(409, "ALREADY_DONE", "задача уже закрыта (done) — менять нечего; запись не сделана");
        boolean ownerWord = OWNER_WORD.equals(f.evidenceType());
        if (!ownerWord)
            return new Verdict(409, "DONE_BY_HUMAN_ONLY", "агент не ставит done — переведите задачу в review "
                + "(стадия stand_check или uat), done ставит человек. Исключение — слово человека: "
                + "evidence_type=owner_word и evidence_ref со временем и дословной цитатой (правило 14.11.2026)");
        // «По агенту необходим текст — время и цитата человека».
        String ref = f.evidenceRef() == null ? "" : f.evidenceRef();
        if (!WHEN.matcher(ref).find() || !QUOTE.matcher(ref).find())
            return new Verdict(409, "NO_EVIDENCE", "done агента по слову человека (owner_word): в evidence_ref нужны "
                + "время сказанного (08:31 или 14.11.2026) и дословная цитата в кавычках «…»; запись не сделана");
        if (!"review".equals(LoreWorkflowCore.core(f.currentToken())))
            return new Verdict(409, "DONE_ONLY_FROM_REVIEW", "done ставится только из review (приёмки); сейчас «"
                + f.currentToken() + "» — сначала переведите в review");
        boolean noReviewer = blank(f.reviewer());
        if (noReviewer && !blank(f.caller()) && f.caller().equals(f.executor()))
            return new Verdict(409, "NO_REVIEWER", "приёмщика нет, а закрывает исполнитель — самоприёмка; "
                + "назначьте приёмщика (reviewer_agent), отличного от исполнителя");
        if (!noReviewer && f.reviewer().equals(f.executor()))
            return new Verdict(409, "REVIEWER_IS_EXECUTOR", "приёмщик совпадает с исполнителем (" + f.executor() + ")");
        return null;
    }

    /**
     * PU-29 (правило владелицы 14.11.2026, «с человека не просить доп. работы»): обязательные слова перехода
     * (причина blocked и возврата с приёмки, адресат waiting) — только для агента. Человек может их дать,
     * но интерфейс не обязан спрашивать: иначе вернуть задачу назад из UI было нельзя (приёмка препрода).
     */
    static Verdict transitionFor(boolean agent, String currentToken, String target, String reason, String waitingFor) {
        return agent ? transition(currentToken, target, reason, waitingFor) : null;
    }

    static Verdict transition(String currentToken, String target, String reason, String waitingFor) {
        // UW-L0-SPEC, слово владельца 26.11: «агент ставит uat, но из uat дальше человек». done из uat решает
        // гейт done (агенту — только словом человека, owner_word); повтор того же статуса — не выход.
        if ("uat".equals(currentToken) && target != null && !"uat".equals(target) && !"done".equals(target))
            return new Verdict(409, "UAT_EXIT_HUMAN_ONLY", "задача на приёмке (uat): дальше её ведёт человек — "
                + "вернуть в работу, закрыть или отменить может только он; агент оставляет задачу в uat");
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
