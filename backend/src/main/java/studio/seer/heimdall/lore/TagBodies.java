package studio.seer.heimdall.lore;

import java.util.List;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-05 · KREG-06 (SPEC-SKILLS-TAGS-062 §8) — корпус тел, где живут токены
 * {@code [[GEOID#тег]]}: один список и для переписи rename, и для сторожа битых ссылок. Сторож обязан
 * смотреть ровно туда, куда пишет перепись, — иначе хвост вне корпуса переписи сторож не увидит, а хвост
 * вне корпуса сторожа перепись не починит.
 *
 * <p>Тела — по модели body-полей ({@link LoreHashStamper#HIST_BODIES}, {@link LoreLinkResource#BACKFILL_BODIES}):
 * у типов с SCD2 текущий текст — на ОТКРЫТОЙ строке истории ({@code valid_to IS NULL}), вершина — зеркало
 * (берутся обе: так читают паспорт и срезы). Закрытые строки *Hist — неизменяемый слепок, их здесь нет.
 *
 * @param type      тип записи (для отчёта)
 * @param from      класс, из которого читается и в который пишется строка
 * @param idExpr    выражение ключа записи-хозяина (для открытой строки истории — через HAS_STATE)
 * @param fields    поля-тела строки
 * @param openHist  строка — открытая версия истории: фильтр {@code valid_to IS NULL} и пересчёт content_hash
 * @param stamp     для открытой истории: {Hist, Vertex, idField} для {@link LoreHashStamper#stampOpenHist}
 */
record TagBodies(String type, String from, String idExpr, List<String> fields, boolean openHist, String[] stamp) {

    static TagBodies vertex(String type, String from, String key, String... fields) {
        return new TagBodies(type, from, key, List.of(fields), false, null);
    }

    static TagBodies hist(String type, String vertex, String key, String... fields) {
        return new TagBodies(type, vertex + "Hist", "in('HAS_STATE')." + key + "[0]", List.of(fields), true,
            new String[]{vertex + "Hist", vertex, key});
    }

    /** Корпус: вершины с телами и открытые строки истории типов с SCD2. */
    static final List<TagBodies> ALL = List.of(
        vertex("doc", "KnowDoc", "doc_id", "content_md_en", "content_md_ru"),
        hist("doc", "KnowDoc", "doc_id", "content_md"),
        vertex("decision", "KnowDecision", "decision_id", "body_md", "rationale_md"),
        vertex("question", "KnowQuestion", "question_id", "body_md"),
        vertex("skill", "KnowSkill", "skill_id", "body_md"),
        vertex("feature", "KnowUseCase", "uc_id", "context_md", "body_md"),
        hist("adr", "KnowADR", "adr_id", "context_md", "decision_md", "consequences_md"),
        hist("spec", "KnowSpec", "spec_id", "content_md"),
        vertex("spec", "KnowSpec", "spec_id", "content_md"),
        hist("runbook", "KnowRunbook", "runbook_id", "content_md"),
        vertex("runbook", "KnowRunbook", "runbook_id", "content_md"),
        hist("sprint", "KnowSprint", "sprint_id", "context_md", "outcome_md"),
        vertex("sprint", "KnowSprint", "sprint_id", "context_md", "outcome_md"),
        hist("task", "KnowTask", "task_uid", "note_md"),
        vertex("task", "KnowTask", "task_uid", "note_md"));

    /**
     * SELECT строк источника, у которых хоть одно тело содержит {@code :p} (шаблон LIKE).
     * Колонки: {@code r} — адрес строки, {@code id} — ключ хозяина, дальше — поля-тела.
     */
    String selectSql() {
        StringBuilder like = new StringBuilder();
        for (String f : fields) {
            if (like.length() > 0) like.append(" OR ");
            like.append(f).append(" LIKE :p");
        }
        return "SELECT @rid AS r, " + idExpr + " AS id, " + String.join(", ", fields) + " FROM " + from
            + " WHERE " + (openHist ? "valid_to IS NULL AND " : "") + "(" + like + ")";
    }

    /** Типы-пробы резолвера геоида: токен сопоставляется, только если хозяин — живая запись LORE. */
    static final List<String> GEOID_PROBES = List.of(
        "SELECT count(*) AS n FROM KnowDoc WHERE doc_id = :g",
        "SELECT count(*) AS n FROM KnowADR WHERE adr_id = :g",
        "SELECT count(*) AS n FROM KnowSpec WHERE spec_id = :g",
        "SELECT count(*) AS n FROM KnowTask WHERE task_uid = :g",
        "SELECT count(*) AS n FROM KnowDecision WHERE decision_id = :g",
        "SELECT count(*) AS n FROM KnowSprint WHERE sprint_id = :g",
        "SELECT count(*) AS n FROM KnowQuestion WHERE question_id = :g",
        "SELECT count(*) AS n FROM KnowRunbook WHERE runbook_id = :g",
        "SELECT count(*) AS n FROM KnowUseCase WHERE uc_id = :g",
        "SELECT count(*) AS n FROM KnowPain WHERE pain_id = :g",
        "SELECT count(*) AS n FROM KnowGain WHERE gain_id = :g",
        "SELECT count(*) AS n FROM KnowJob WHERE job_id = :g",
        "SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = :g",
        "SELECT count(*) AS n FROM KnowSkill WHERE skill_id = :g");
}
