package studio.seer.heimdall.lore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * ADR-LORE-023: реестр миграций схемы system_aida_lore. Принципы взяты из
 * ADR-HND-022 (V{n}__имя, ledger применённых, checksum-verify, деструктив за
 * флагом), раннер — свой, под специфику LORE (ответ OQ-023-RUNNER, 2026-07-17).
 *
 * Правила:
 * - Шаг применяется РОВНО один раз; факт — строка LoreSchemaVersion (версия,
 *   имя, checksum, applied_at). Текущая версия БД = max(version).
 * - Каждый SQL-стейтмент идемпотентен (IF NOT EXISTS) — повторный прогон
 *   безопасен; но ledger предотвращает его в норме.
 * - Изменять УЖЕ ВЫПУЩЕННЫЙ шаг нельзя — checksum-verify откажет старту
 *   (дрейф кода против применённой истории). Нужна правка → новый шаг.
 * - Аддитивные шаги (всё ниже) данных не трогают (ADR-023 п.5).
 * - version=4 — Java-шаг (backfill), см. LoreSchemaMigrationRunner#javaStep.
 */
final class LoreSchemaMigrations {

    record Step(int version, String name, List<String> sql) {
        String checksum() {
            try {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                for (String s : sql) md.update(s.getBytes(StandardCharsets.UTF_8));
                byte[] d = md.digest();
                StringBuilder sb = new StringBuilder(16);
                for (int i = 0; i < 8; i++) sb.append(String.format("%02x", d[i]));
                return sb.toString();
            } catch (Exception e) { throw new IllegalStateException(e); }
        }
    }

    private LoreSchemaMigrations() {}

    /** Код-ожидаемая версия схемы = максимум реестра. */
    static int codeVersion() { return STEPS.get(STEPS.size() - 1).version(); }

    // SV-06: DDL сессий 2026-07 задним числом. На живой БД эти стейтменты уже
    // исполнялись out-of-band — идемпотентный replay безвреден и ставит ledger.
    static final List<Step> STEPS = List.of(
        new Step(1, "2026-07_questions_files_hosts_decision_component", List.of(
            "CREATE PROPERTY KnowDecision.component_id IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowDecision (component_id) NOTUNIQUE",
            "CREATE PROPERTY KnowGitProject.hosts IF NOT EXISTS STRING",
            "CREATE VERTEX TYPE KnowFile IF NOT EXISTS",
            "CREATE PROPERTY KnowFile.project    IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFile.file_path  IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFile.summary_md IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowFile (project, file_path) UNIQUE",
            "CREATE EDGE TYPE EDITED_IN IF NOT EXISTS",
            "CREATE VERTEX TYPE KnowQuestion IF NOT EXISTS",
            "CREATE PROPERTY KnowQuestion.question_id  IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowQuestion.component_id IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowQuestion (question_id)  UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowQuestion (component_id) NOTUNIQUE",
            "CREATE EDGE TYPE ANSWERS   IF NOT EXISTS",
            "CREATE EDGE TYPE RAISED_IN IF NOT EXISTS"
        )),
        new Step(2, "fulltext_primary_bodies", List.of(
            "CREATE PROPERTY KnowADRHist.context_md      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowADRHist.decision_md     IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowADRHist.consequences_md IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowADRHist (context_md)      FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowADRHist (decision_md)     FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowADRHist (consequences_md) FULL_TEXT",
            "CREATE PROPERTY KnowDecision.title   IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowDecision.body_md IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowDecision (title)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowDecision (body_md) FULL_TEXT",
            "CREATE PROPERTY KnowQuestion.title   IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowQuestion.body_md IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowQuestion (title)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowQuestion (body_md) FULL_TEXT",
            "CREATE PROPERTY KnowSpecHist.content_md    IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowSpecHist (content_md)    FULL_TEXT",
            "CREATE PROPERTY KnowRunbookHist.content_md IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowRunbookHist (content_md) FULL_TEXT",
            "CREATE PROPERTY KnowDocHist.content_md     IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowDocHist (content_md)     FULL_TEXT",
            "CREATE PROPERTY KnowSprintHist.context_md  IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowSprintHist (context_md)  FULL_TEXT",
            "CREATE PROPERTY KnowTaskHist.note_md       IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowTaskHist (note_md)       FULL_TEXT"
        )),
        // SV-09: сплошная ревизия — ВСЕ оставшиеся *_md объявлены и проиндексированы.
        // Самый заметный долг: KnowSprintHist.outcome_md — именно там живут эссе
        // спринтов, а поиска по ним не было.
        new Step(3, "fulltext_md_sweep_rest", List.of(
            "CREATE PROPERTY KnowSprintHist.outcome_md   IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowSprintHist (outcome_md)   FULL_TEXT",
            "CREATE PROPERTY KnowRelease.description_md  IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowRelease (description_md)  FULL_TEXT",
            "CREATE PROPERTY KnowMilestoneHist.goal_md   IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowMilestoneHist (goal_md)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowFile (summary_md)         FULL_TEXT",
            "CREATE PROPERTY KnowDoc.content_md          IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowDoc (content_md)          FULL_TEXT",
            "CREATE PROPERTY BragiChannel.rules_md       IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON BragiChannel (rules_md)       FULL_TEXT",
            "CREATE PROPERTY BragiInsight.statement_md   IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON BragiInsight (statement_md)   FULL_TEXT",
            "CREATE PROPERTY BragiPublication.main_text_md IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON BragiPublication (main_text_md) FULL_TEXT",
            "CREATE PROPERTY BragiVariant.text_md        IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON BragiVariant (text_md)        FULL_TEXT",
            // SV-10: content_hash объявляется на всех Hist-типах (писаться будет
            // кодом на записи; объявление нужно на будущее индексирование/выборку).
            "CREATE PROPERTY KnowADRHist.content_hash     IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowSprintHist.content_hash  IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowTaskHist.content_hash    IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowSpecHist.content_hash    IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowRunbookHist.content_hash IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowDocHist.content_hash     IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowMilestoneHist.content_hash IF NOT EXISTS STRING"
        )),
        // Java-шаг: backfill content_hash по существующим Hist-строкам (SQL не умеет
        // SHA-256) — см. LoreSchemaMigrationRunner#javaStep.
        new Step(4, "java__backfill_content_hash", List.of()),
        // V4 первой редакции брал LIMIT 5000 БЕЗ цикла — на живой БД KnowTaskHist
        // упёрся в лимит, хвост остался без хэша. Выпущенный шаг неизменяем
        // (checksum-гард) — добор оформлен новым шагом, backfill теперь циклом.
        new Step(5, "java__backfill_content_hash_tail", List.of())
    );
}
