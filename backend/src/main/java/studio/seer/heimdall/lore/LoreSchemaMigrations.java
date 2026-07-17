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
        new Step(5, "java__backfill_content_hash_tail", List.of()),
        // ADR-LORE-022 (ACCEPTED 2026-07-17): продуктовый слой Feature → UC +
        // ось work_class. Feature/UC — vertex-only (без Hist, как KnowDecision/
        // KnowQuestion); work_class — на ВЕРШИНЕ KnowTask (carry-forward ловушка
        // Hist, ADR-021). Словарь work_class — канон (правят люди, D10) — сидится
        // идемпотентными UPSERT'ами здесь же.
        new Step(6, "product_layer_feature_uc_workclass", List.of(
            "CREATE VERTEX TYPE KnowFeature IF NOT EXISTS",
            "CREATE PROPERTY KnowFeature.feature_id   IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFeature.title        IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFeature.body_md      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFeature.status       IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFeature.component_id IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFeature.context_md   IF NOT EXISTS STRING", // D13: большое контекстное поле, как у спринта
            "CREATE PROPERTY KnowFeature.date_created IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowFeature (feature_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowFeature (title)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowFeature (body_md)    FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowFeature (context_md) FULL_TEXT",
            "CREATE VERTEX TYPE KnowUseCase IF NOT EXISTS",
            "CREATE PROPERTY KnowUseCase.uc_id         IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.title         IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.scenario_md   IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.acceptance_md IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.status        IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.feature_id    IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.date_created  IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (uc_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (feature_id) NOTUNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (title)         FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (scenario_md)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (acceptance_md) FULL_TEXT",
            "CREATE EDGE TYPE DECOMPOSES_INTO IF NOT EXISTS", // KnowFeature -> KnowUseCase
            "CREATE EDGE TYPE REALIZES        IF NOT EXISTS", // KnowTask    -> KnowUseCase
            "CREATE EDGE TYPE TRACED_TO       IF NOT EXISTS", // KnowUseCase -> KnowADR | KnowDecision (опц., D9)
            // D12: актор — первоклассная вершина («проектируемая роль приложения»),
            // у UC акторов может быть НЕСКОЛЬКО (multi-ребро HAS_ACTOR).
            "CREATE VERTEX TYPE KnowActor IF NOT EXISTS",
            "CREATE PROPERTY KnowActor.actor_id IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowActor.name     IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowActor.kind     IF NOT EXISTS STRING", // human-role | system | agent
            "CREATE PROPERTY KnowActor.body_md  IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowActor (actor_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowActor (body_md) FULL_TEXT",
            "CREATE EDGE TYPE HAS_ACTOR   IF NOT EXISTS", // KnowUseCase -> KnowActor (multi)
            // D13: граф UC не только иерархия — классические include/extend.
            "CREATE EDGE TYPE UC_INCLUDES IF NOT EXISTS", // UC -> UC (обязательный под-сценарий)
            "CREATE EDGE TYPE UC_EXTENDS  IF NOT EXISTS", // UC -> UC (вариант-расширение)
            "CREATE PROPERTY KnowTask.work_class IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowTask (work_class) NOTUNIQUE",
            // Сид канон-словаря work_class (идемпотентно; канон — правят люди, D10).
            "UPDATE KnowDictEntry SET dict_type='work_class', code='uc',  label_ru='Use Case — реализует сценарий', color='#5AB4E8', sort_order=10, is_active=true, is_extensible=false UPSERT WHERE dict_type='work_class' AND code='uc'",
            "UPDATE KnowDictEntry SET dict_type='work_class', code='jtd', label_ru='Job to be Done — задача-хелпер', color='#C0A36E', sort_order=20, is_active=true, is_extensible=false UPSERT WHERE dict_type='work_class' AND code='jtd'",
            "UPDATE KnowDictEntry SET dict_type='work_class', code='enb', label_ru='Enabler — расчищает дорогу', color='#9A8CDB', sort_order=30, is_active=true, is_extensible=false UPSERT WHERE dict_type='work_class' AND code='enb'"
        )),

        // ADR-LORE-031: generic-ассеты для всех MD-полей. Ключ = контент-адрес
        // {entity_type}/{entity_id}/{sha256-16}.{ext} — бакет самодокументируемый,
        // дедуп по содержимому; вершина+ребро создаются В ТОМ ЖЕ запросе, что и
        // файл (сирота невозможен на записи). Настройки — словарь app_setting
        // (реестр Админки AL-38); value живёт в label_ru.
        new Step(7, "generic_assets_knowasset", List.of(
            "CREATE VERTEX TYPE KnowAsset IF NOT EXISTS",
            "CREATE PROPERTY KnowAsset.asset_key    IF NOT EXISTS STRING", // {type}/{id}/{hash}.{ext}
            "CREATE PROPERTY KnowAsset.entity_type  IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowAsset.entity_id    IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowAsset.mime         IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowAsset.size_bytes   IF NOT EXISTS LONG",
            "CREATE PROPERTY KnowAsset.alt          IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowAsset.created_at   IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowAsset (asset_key) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowAsset (entity_id) NOTUNIQUE",
            "CREATE EDGE TYPE ATTACHED_TO IF NOT EXISTS", // сущность -> KnowAsset
            "UPDATE KnowDictEntry SET dict_type='app_setting', code='md_images_enabled', label_ru='true', sort_order=10, is_active=true, is_extensible=true UPSERT WHERE dict_type='app_setting' AND code='md_images_enabled'",
            "UPDATE KnowDictEntry SET dict_type='app_setting', code='md_image_max_mb', label_ru='5', sort_order=20, is_active=true, is_extensible=true UPSERT WHERE dict_type='app_setting' AND code='md_image_max_mb'"
        ))
    );
}
