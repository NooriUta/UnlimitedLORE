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

    /**
     * version — сквозной ordinal: порядок применения и ключ ledger, неизменяем.
     * compatMajor — ось СОВМЕСТИМОСТИ (major версии схемы). Аддитивные шаги делят
     * major с предыдущими (10.1/10.2/10.3 — старый бинарь major=10 их спокойно
     * переживёт, форвард-совместимость), несовместимый шаг ПОДНИМАЕТ major (11) —
     * и только тогда дрейф-гард отказывает старту старого кода.
     * Историческим шагам (3-арг конструктор) compatMajor=version — каждый сам себе
     * major; НОВЫЙ аддитивный шаг передаёт МЕНЬШИЙ compatMajor явно (4-арг), напр.
     * new Step(11, 10, "…", …) = ordinal 11, но major 10 → человеку это «10.1».
     */
    record Step(int version, int compatMajor, String name, List<String> sql) {
        Step(int version, String name, List<String> sql) { this(version, version, name, sql); }

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

        /** Человекочитаемая версия major.minor (minor = порядковый среди шагов того же major). */
        String human() {
            long minor = STEPS.stream()
                .filter(s -> s.compatMajor() == compatMajor && s.version() <= version).count() - 1;
            return compatMajor + "." + minor;
        }
    }

    private LoreSchemaMigrations() {}

    /** Код-ожидаемая версия схемы = максимум реестра (ordinal). */
    static int codeVersion() { return STEPS.get(STEPS.size() - 1).version(); }

    /** Ось совместимости: максимальный major в реестре. Отстал от него бинарь → отказ старта. */
    static int codeCompatMajor() { return STEPS.stream().mapToInt(Step::compatMajor).max().orElse(0); }

    /** major.minor последнего шага — для логов и сообщений. */
    static String codeHuman() { return STEPS.get(STEPS.size() - 1).human(); }

    /** Решение раннера о старте по версиям — чистое, тестируется без БД (ADR-023). */
    enum StartupDecision {
        UP_TO_DATE,      // db == code
        RUN_PENDING,     // db < code — доиграть недостающие шаги
        FORWARD_COMPAT,  // db впереди по аддитивным шагам того же major — работаем, варнинг
        INCOMPATIBLE     // у БД major новее кода — ломающий шаг, которого нет в коде → отказ
    }

    static StartupDecision decide(int dbVersion, int dbCompatMajor, int codeVersion, int codeCompatMajor) {
        if (dbCompatMajor > codeCompatMajor) return StartupDecision.INCOMPATIBLE;
        if (dbVersion > codeVersion)         return StartupDecision.FORWARD_COMPAT;
        if (dbVersion < codeVersion)         return StartupDecision.RUN_PENDING;
        return StartupDecision.UP_TO_DATE;
    }

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
        )),

        // ADR-LORE-032 (§2, решение D5) + ADR-LORE-027 (D1) + ADR-LORE-029 (§2):
        // ценность фичи становится ВЫЧИСЛИМОЙ — боли и выгоды выносятся из прозы
        // в вершины, а fit VP-канвы считается по рёбрам, не парсингом MD.
        // Единая шкала целей Коберна на весь слой (☁ cloud/🪁 kite — фичи,
        // 🌊 sea-level/🐟 subfunction — UC) + два веса оформления (casual|fully-dressed).
        new Step(8, "product_layer_vp_pain_gain_cockburn_scale", List.of(
            // Боль клиента: чья (FELT_BY), какая фича адресует (ADDRESSES), какой UC снимает (RELIEVES).
            "CREATE VERTEX TYPE KnowPain IF NOT EXISTS",
            "CREATE PROPERTY KnowPain.pain_id      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowPain.title        IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowPain.body_md      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowPain.severity     IF NOT EXISTS STRING", // high|normal|low (словарь priority)
            "CREATE PROPERTY KnowPain.date_created IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowPain (pain_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowPain (title)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowPain (body_md) FULL_TEXT",
            // Выгода: metric_md — ОБЯЗАТЕЛЬНОЕ поле для fit (выгода без метрики не замкнута).
            "CREATE VERTEX TYPE KnowGain IF NOT EXISTS",
            "CREATE PROPERTY KnowGain.gain_id      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowGain.title        IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowGain.body_md      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowGain.metric_md    IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowGain.date_created IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowGain (gain_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowGain (title)     FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowGain (body_md)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowGain (metric_md) FULL_TEXT",
            // Шесть рёбер VP-канвы: левая половина (профиль) и правая (value map).
            "CREATE EDGE TYPE FELT_BY    IF NOT EXISTS", // KnowPain    -> KnowActor
            "CREATE EDGE TYPE DESIRED_BY IF NOT EXISTS", // KnowGain    -> KnowActor
            "CREATE EDGE TYPE ADDRESSES  IF NOT EXISTS", // KnowFeature -> KnowPain
            "CREATE EDGE TYPE PROMISES   IF NOT EXISTS", // KnowFeature -> KnowGain
            "CREATE EDGE TYPE RELIEVES   IF NOT EXISTS", // KnowUseCase -> KnowPain (pain reliever)
            "CREATE EDGE TYPE DELIVERS   IF NOT EXISTS", // KnowUseCase -> KnowGain (gain creator)
            // Стратегическая цель фичи (ADR-032 §1, KAOS: веха = goal, фича = refinement).
            // Тип ребра уже существует у спринтов — объявление идемпотентно.
            "CREATE EDGE TYPE TARGETS_MILESTONE IF NOT EXISTS",
            // Обоснование enb-задачи (D16): KnowTask -> KnowADR.
            "CREATE EDGE TYPE JUSTIFIED_BY IF NOT EXISTS",
            // Классификация Коберна: уровень цели и вес оформления (ADR-027 §2).
            "CREATE PROPERTY KnowUseCase.goal_level IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.rigor      IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowUseCase.priority   IF NOT EXISTS STRING",
            // shipped_at ставит СИСТЕМА при первом переходе вычислителя в shipped
            // (ADR-029 §2) — факт первого выхода переживает реинжиниринг.
            "CREATE PROPERTY KnowUseCase.shipped_at IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (goal_level) NOTUNIQUE",
            // Фича живёт на той же шкале — ☁ cloud/🪁 kite (ADR-032 §1).
            "CREATE PROPERTY KnowFeature.goal_level IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFeature.shipped_at IF NOT EXISTS STRING",
            // Канон-словари (правят люди, механизм ADR-012). Уровни целей — по Коберну.
            "UPDATE KnowDictEntry SET dict_type='uc_goal_level', code='cloud',      label_ru='☁ Облако — стратегическая цель (фича)', color='#88B8A8', sort_order=10, is_active=true, is_extensible=false UPSERT WHERE dict_type='uc_goal_level' AND code='cloud'",
            "UPDATE KnowDictEntry SET dict_type='uc_goal_level', code='kite',       label_ru='🪁 Змей — обзорная цель', color='#A8B860', sort_order=20, is_active=true, is_extensible=false UPSERT WHERE dict_type='uc_goal_level' AND code='kite'",
            "UPDATE KnowDictEntry SET dict_type='uc_goal_level', code='sea-level',  label_ru='🌊 Уровень моря — пользовательская цель', color='#5AB4E8', sort_order=30, is_active=true, is_extensible=false UPSERT WHERE dict_type='uc_goal_level' AND code='sea-level'",
            "UPDATE KnowDictEntry SET dict_type='uc_goal_level', code='subfunction', label_ru='🐟 Рыба — подфункция', color='#665C48', sort_order=40, is_active=true, is_extensible=false UPSERT WHERE dict_type='uc_goal_level' AND code='subfunction'",
            "UPDATE KnowDictEntry SET dict_type='uc_rigor', code='casual',        label_ru='⚡ Лёгкий (casual)', color='#D4922A', sort_order=10, is_active=true, is_extensible=false UPSERT WHERE dict_type='uc_rigor' AND code='casual'",
            "UPDATE KnowDictEntry SET dict_type='uc_rigor', code='fully-dressed', label_ru='📋 Полный (fully dressed)', color='#88B8A8', sort_order=20, is_active=true, is_extensible=false UPSERT WHERE dict_type='uc_rigor' AND code='fully-dressed'"
        )),

        // ADR-LORE-028 (D19): primary|supporting — свойство role на ребре HAS_ACTOR.
        // У сценария ровно один primary-актор (правило линтера ADR-027 №7); первый
        // привязанный становится primary по умолчанию (D19). Свойство на РЕБРЕ, не
        // на вершине: одна роль может быть primary в одном UC и supporting в другом.
        new Step(9, "has_actor_role_property", List.of(
            "CREATE PROPERTY HAS_ACTOR.role IF NOT EXISTS STRING"
        )),

        // ADR-LORE-032 §2.1: добор канвы Остервальдера до полной. Боли и выгоды
        // (V8) — только ДВА столпа профиля клиента; третий, из которого растут оба,
        // — РАБОТЫ (customer jobs): «боль мешает работе», «выгода — успех в работе».
        // Без Job'а как вершины job-строки в тексте фичи не проверить рёбрами (fit
        // считался по 2 осям из 3) и не переиспользовать между фичами, как pain/gain.
        new Step(10, "vpc_osterwalder_jobs_and_ranks", List.of(
            "CREATE VERTEX TYPE KnowJob IF NOT EXISTS",
            "CREATE PROPERTY KnowJob.job_id       IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowJob.title        IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowJob.body_md      IF NOT EXISTS STRING",
            // Остервальдер: тип работы — функциональная | социальная | эмоциональная
            // | supporting (вспомогательная). Словарь job_kind ниже.
            "CREATE PROPERTY KnowJob.kind         IF NOT EXISTS STRING",
            // importance: насколько работа важна клиенту (Остервальдер ранжирует
            // jobs по important|insignificant — у нас словарь priority-шкалы).
            "CREATE PROPERTY KnowJob.importance   IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowJob.date_created IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowJob (job_id) UNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowJob (title)   FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowJob (body_md) FULL_TEXT",
            // Профиль клиента: чья работа (как FELT_BY/DESIRED_BY у pain/gain).
            "CREATE EDGE TYPE PERFORMED_BY IF NOT EXISTS", // KnowJob     -> KnowActor
            // Фича ЗАЯВЛЯЕТ, что помогает с работой (симметрия ADDRESSES/PROMISES).
            "CREATE EDGE TYPE HELPS_WITH   IF NOT EXISTS", // KnowFeature -> KnowJob
            // UC РЕАЛЬНО выполняет работу — это ребро и замыкает третью ось fit
            // (симметрия RELIEVES/DELIVERS).
            "CREATE EDGE TYPE PERFORMS     IF NOT EXISTS", // KnowUseCase -> KnowJob
            // Остервальдер связывает боли и выгоды С РАБОТАМИ: боль мешает работе,
            // выгода — желаемый успех в работе. Без этих рёбер профиль клиента —
            // три несвязанных списка, а не канва.
            "CREATE EDGE TYPE BLOCKS   IF NOT EXISTS",     // KnowPain -> KnowJob
            "CREATE EDGE TYPE SUCCESS_OF IF NOT EXISTS",   // KnowGain -> KnowJob
            // Ранги Остервальдера: боль severe|moderate (у нас severity уже есть,
            // V8), выгода — essential|expected|desired|unexpected.
            "CREATE PROPERTY KnowGain.rank IF NOT EXISTS STRING",
            // Словарь типов работ (канон, правят люди — механизм ADR-012).
            "UPDATE KnowDictEntry SET dict_type='job_kind', code='functional', label_ru='⚙ Функциональная — выполнить задачу', color='#5AB4E8', sort_order=10, is_active=true, is_extensible=false UPSERT WHERE dict_type='job_kind' AND code='functional'",
            "UPDATE KnowDictEntry SET dict_type='job_kind', code='social', label_ru='👥 Социальная — как выглядеть в глазах других', color='#C0A36E', sort_order=20, is_active=true, is_extensible=false UPSERT WHERE dict_type='job_kind' AND code='social'",
            "UPDATE KnowDictEntry SET dict_type='job_kind', code='emotional', label_ru='💭 Эмоциональная — как себя чувствовать', color='#9A8CDB', sort_order=30, is_active=true, is_extensible=false UPSERT WHERE dict_type='job_kind' AND code='emotional'",
            "UPDATE KnowDictEntry SET dict_type='job_kind', code='supporting', label_ru='🔧 Вспомогательная — обслуживает основную работу', color='#665C48', sort_order=40, is_active=true, is_extensible=false UPSERT WHERE dict_type='job_kind' AND code='supporting'",
            // Словарь рангов выгоды (Остервальдер, VPC).
            "UPDATE KnowDictEntry SET dict_type='gain_rank', code='essential', label_ru='🔴 Обязательная — без неё решение не работает', color='#C85848', sort_order=10, is_active=true, is_extensible=false UPSERT WHERE dict_type='gain_rank' AND code='essential'",
            "UPDATE KnowDictEntry SET dict_type='gain_rank', code='expected', label_ru='🟠 Ожидаемая — клиент считает её само собой', color='#D4922A', sort_order=20, is_active=true, is_extensible=false UPSERT WHERE dict_type='gain_rank' AND code='expected'",
            "UPDATE KnowDictEntry SET dict_type='gain_rank', code='desired', label_ru='🟢 Желаемая — обрадуется, но не ждёт', color='#7DBF78', sort_order=30, is_active=true, is_extensible=false UPSERT WHERE dict_type='gain_rank' AND code='desired'",
            "UPDATE KnowDictEntry SET dict_type='gain_rank', code='unexpected', label_ru='✨ Неожиданная — превосходит ожидания', color='#88B8A8', sort_order=40, is_active=true, is_extensible=false UPSERT WHERE dict_type='gain_rank' AND code='unexpected'"
        )),

        // ── V11 (10.1) SRCH-03: полнотекст под сквозной поиск ────────────────
        // Аддитивный шаг: объявляем недостающие текстовые свойства, индексы
        // создаёт Java-шаг (см. ниже, почему не SQL).
        //
        // Замерено на ArcadeDB 26.7.2: заголовки ADR/спек/задач/ранбуков/спринтов
        // ЛЕЖАТ В ДАННЫХ, но в схеме не объявлены — а необъявленное поле
        // проиндексировать нельзя. Отсюда поиск по названию ADR шёл сканом.
        // Проверено там же: поздно объявленное свойство индексируется вместе с
        // уже лежащими значениями, ручной backfill не нужен.
        new Step(11, 10, "fulltext_named_multifield_indexes", List.of(
            "CREATE PROPERTY KnowADR.name              IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowSpec.title            IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowTask.title            IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowRunbook.name          IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowSprint.name           IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowDoc.title             IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowReleaseHist.description_md IF NOT EXISTS STRING"
        )),

        // ── V12 (10.2) SRCH-06: полный охват + область поиска ────────────────
        // Аудит схемы показал текст, который в поиск не попадал вовсе: тела
        // релизной истории, сводки по файлам, цели вех, двуязычные тела доков,
        // а также два соседних продукта в той же БД — Bragi и QG-рутины.
        // Индексируем ВСЁ, но каждая ветка несёт область (FtScope), и поиск
        // отсекает лишнее ДО запроса, а не фильтрует выдачу после.
        new Step(12, 10, "fulltext_full_coverage_and_scope", List.of(
            "CREATE PROPERTY KnowPhase.title       IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowPR.title          IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowRelease.release_name IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowFinding.summary   IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowSpecHist.summary  IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowDoc.content_md_en IF NOT EXISTS STRING",
            "CREATE PROPERTY KnowDoc.content_md_ru IF NOT EXISTS STRING"
        )),

        // ── V13 (13.0) PL-28: ОДИН тип с само-иерархией ──────────────────────
        // Решение владельца №141: KnowFeature и KnowUseCase сливаются в ОДИН
        // тип. Фича — это корневой сценарий, а не отдельная сущность: она
        // отвечает на тот же вопрос «какую пользовательскую цель закрываем»,
        // только на верхнем уровне шкалы Коберна. Дискриминатором уровня
        // становится уже существующий и заполненный goal_level:
        // ☁ cloud / 🪁 kite — бывшие фичи, 🌊 sea-level / 🐟 subfunction — бывшие UC.
        //
        // Почему это ЛОМАЮЩИЙ шаг (compatMajor=13, а не аддитивный 10.x):
        // тип KnowFeature исчезает. Старый бинарь читает его в слайсах, REST и
        // поиске — против новой схемы он отдавал бы пустоту, молча и с ok:true.
        // Скачок major заставляет такой бинарь ОТКАЗАТЬСЯ стартовать
        // (StartupDecision.INCOMPATIBLE), а не работать неправильно.
        //
        // Здесь только АДДИТИВНАЯ часть — поля, которые были у фичи и которых
        // нет у сценария. Перенос данных, перевод рёбер и снос типа делает
        // javaStep(13): рёбра нельзя перецепить SQL-запросом, у них
        // неизменяемые концы, а @rid-адресация нужна поимённо (см.
        // LoreSchemaMigrationRunner#mergeFeaturesIntoUseCases).
        new Step(13, "product_layer_merge_feature_into_usecase", List.of(
            // Ценность/критерий фичи. У сценария были только scenario_md и
            // acceptance_md — короткому «зачем это вообще» места не было.
            "CREATE PROPERTY KnowUseCase.body_md    IF NOT EXISTS STRING",
            // Большой контекст (D13) — как у спринта; у UC его не было.
            "CREATE PROPERTY KnowUseCase.context_md IF NOT EXISTS STRING",
            // Родитель в само-иерархии. Заменяет денормализованный feature_id:
            // тот указывал в другой тип, этот — в свой же.
            "CREATE PROPERTY KnowUseCase.parent_uc_id IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (parent_uc_id) NOTUNIQUE",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (body_md)    FULL_TEXT",
            "CREATE INDEX IF NOT EXISTS ON KnowUseCase (context_md) FULL_TEXT"
        ))
    );

    /**
     * SRCH-03: анализатор для русскоязычного корпуса. Замерено: с ним документ
     * со словом «релиза» находится по запросу «релиз», на дефолтном — нет.
     */
    static final String FT_ANALYZER = "org.apache.lucene.analysis.ru.RussianAnalyzer";

    /**
     * similarity ОБЯЗАН быть указан ЯВНО, хотя BM25 и заявлен умолчанием.
     *
     * Замерено на ArcadeDB 26.7.2, три варианта одного индекса на одних данных
     * (документы: 5 вхождений термина / 1 вхождение / 1 вхождение + 150 слов балласта):
     *   без METADATA вообще        → 0.272 / 0.218 / 0.076 — BM25, ранжирует
     *   METADATA только analyzer   → 1 / 1 / 1             — CLASSIC, НЕ ранжирует
     *   METADATA analyzer+similarity → 0.272 / 0.218 / 0.076 — BM25, ранжирует
     *
     * То есть передача METADATA БЕЗ similarity молча сбрасывает модель в CLASSIC.
     * Умолчание «BM25 для новых индексов» действует, только пока METADATA не
     * передан вовсе — а нам он нужен ради анализатора. Первая редакция этого
     * шага задавала лишь analyzer, и на проде получился корпус без ранжирования:
     * все совпадения со скором 1.
     */
    static final String FT_SIMILARITY = "BM25";

    /**
     * Область поиска — «куда ходить». Отсекает ветки ДО запроса, а не фильтрует
     * выдачу после: Bragi и QG живут в той же БД, но это другие продукты, и по
     * умолчанию в выдачу Forseti попадать не должны. Заодно дешевле: меньше
     * веток unionall на запрос.
     *
     * Имена совпадают с ПРОСТРАНСТВАМИ в шапке Seiðr (FORSETI / BRAGI), а не с
     * внутренними («LORE»): иначе реестр и интерфейс называют одно разными
     * словами, и «искать в LORE» перестаёт совпадать с тем, где пользователь стоит.
     *
     * Почему НЕ разносим по разным БД, хотя связность почти нулевая: замерено
     * 23 ребра из 21754 пересекают границу продуктов (QGRecommendation→KnowTask
     * ×10, QualityGate→LoreComponent ×12, BragiInsight→KnowTask ×1). Но это ровно
     * те рёбра, ради которых слой существует — рекомендация гейта, ставшая
     * задачей. Рёбер между базами в ArcadeDB нет: разделение превратило бы их в
     * мягкие ссылки по id, без обхода и без целостности.
     */
    enum FtScope { FORSETI, BRAGI, QUALITY }

    /** Именованный мультиполевой FULL_TEXT-индекс: одна ветка поиска = один вызов. */
    record FtIndex(String name, String type, List<String> fields, FtScope scope) {
        FtIndex(String name, String type, List<String> fields) { this(name, type, fields, FtScope.FORSETI); }

        String createSql() {
            return "CREATE INDEX `" + name + "` ON " + type + " (" + String.join(", ", fields) + ")"
                 + " FULL_TEXT METADATA {\"analyzer\":\"" + FT_ANALYZER + "\","
                 + "\"similarity\":\"" + FT_SIMILARITY + "\"}";
        }
    }

    /**
     * Реестр индексов сквозного поиска (ADR-LORE-033 D10): у типа РОВНО ОДИН
     * индекс на заголовок + все его *_md. Тогда ветка unionall — один вызов
     * SEARCH_INDEX, а не вызов на поле.
     *
     * Имена явные и стабильные: ранжирование доступно только через
     * SEARCH_INDEX('<имя>', …), а автоимена вида KnowADR_0_4240054376237
     * привязаны к внутренним id и меняются при пересоздании.
     *
     * Тела ADR/спек/задач/спринтов/ранбуков берём из *Hist: на самих вершинах
     * те же поля не объявлены, а в Hist объявлены и заполнены — так текст не
     * дублируется в индексах (ADR-LORE-033 D4/D10).
     */
    static final List<FtIndex> FT_INDEXES = List.of(
        new FtIndex("ftKnowADR",         "KnowADR",         List.of("name")),
        new FtIndex("ftKnowADRHist",     "KnowADRHist",     List.of("context_md", "decision_md", "consequences_md")),
        new FtIndex("ftKnowSpec",        "KnowSpec",        List.of("title")),
        new FtIndex("ftKnowSpecHist",    "KnowSpecHist",    List.of("content_md")),
        new FtIndex("ftKnowTask",        "KnowTask",        List.of("title")),
        new FtIndex("ftKnowTaskHist",    "KnowTaskHist",    List.of("note_md")),
        new FtIndex("ftKnowSprint",      "KnowSprint",      List.of("name", "context_md")),
        new FtIndex("ftKnowSprintHist",  "KnowSprintHist",  List.of("context_md", "outcome_md")),
        new FtIndex("ftKnowRunbook",     "KnowRunbook",     List.of("name")),
        new FtIndex("ftKnowRunbookHist", "KnowRunbookHist", List.of("content_md")),
        // content_md_en/ru — двуязычные тела доков: без них искалась только
        // основная колонка, а переводы в выдачу не попадали вовсе.
        new FtIndex("ftKnowDoc",         "KnowDoc",         List.of("title", "content_md", "content_md_en", "content_md_ru")),
        new FtIndex("ftKnowDocHist",     "KnowDocHist",     List.of("content_md")),
        new FtIndex("ftKnowDecision",    "KnowDecision",    List.of("title", "body_md")),
        new FtIndex("ftKnowQuestion",    "KnowQuestion",    List.of("title", "body_md")),
        // PL-28: ftKnowFeature снят вместе с типом. Поля обеих прежних веток
        // собраны здесь — иначе после слияния перестал бы искаться либо
        // контекст корня, либо сценарий, и пропажу заметили бы не сразу.
        new FtIndex("ftKnowUseCase",     "KnowUseCase",
            List.of("title", "body_md", "context_md", "scenario_md", "acceptance_md")),
        new FtIndex("ftKnowPain",        "KnowPain",        List.of("title", "body_md")),
        new FtIndex("ftKnowGain",        "KnowGain",        List.of("title", "body_md", "metric_md")),
        new FtIndex("ftKnowJob",         "KnowJob",         List.of("title", "body_md")),
        new FtIndex("ftKnowActor",       "KnowActor",       List.of("name", "body_md")),
        new FtIndex("ftKnowRelease",     "KnowRelease",     List.of("description_md")),

        // ── V12: добор по аудиту схемы ──────────────────────────────────────
        // Тела релизов жили только на вершине; история описаний не искалась.
        new FtIndex("ftKnowReleaseHist", "KnowReleaseHist", List.of("description_md")),
        // Сводки по файлам репозитория — единственный текст, связывающий код с задачами.
        new FtIndex("ftKnowFile",        "KnowFile",        List.of("summary_md")),
        // Цели вех: короткие, но это формулировка «зачем», её ищут.
        new FtIndex("ftKnowMilestoneHist", "KnowMilestoneHist", List.of("goal_md")),
        // Реестр git-проектов: имя и описание.
        new FtIndex("ftKnowGitProject",  "KnowGitProject",  List.of("name", "description")),
        // Русские подписи словарей — по ним ищут «как это называется в интерфейсе».
        new FtIndex("ftKnowDictEntry",   "KnowDictEntry",   List.of("label_ru")),

        // ── BRAGI: другой продукт в той же БД, отсекается областью ───────────
        new FtIndex("ftBragiPublication", "BragiPublication", List.of("title", "topic", "main_text_md"), FtScope.BRAGI),
        new FtIndex("ftBragiRubric",      "BragiRubric",      List.of("name", "description"),            FtScope.BRAGI),
        new FtIndex("ftBragiPage",        "BragiPage",        List.of("title", "description"),           FtScope.BRAGI),
        new FtIndex("ftBragiChannel",     "BragiChannel",     List.of("rules_md"),                       FtScope.BRAGI),
        new FtIndex("ftBragiCompetitor",  "BragiCompetitor",  List.of("name"),                           FtScope.BRAGI),
        new FtIndex("ftBragiInsight",     "BragiInsight",     List.of("statement_md"),                   FtScope.BRAGI),
        new FtIndex("ftBragiVariant",     "BragiVariant",     List.of("text_md"),                        FtScope.BRAGI),

        // ── КАЧЕСТВО: прогоны рутин и рекомендации ──────────────────────────
        new FtIndex("ftClRoutineRun",    "ClRoutineRun",    List.of("detail_md"),          FtScope.QUALITY),
        new FtIndex("ftClRoutineOutput", "ClRoutineOutput", List.of("title", "content_md"),FtScope.QUALITY),
        new FtIndex("ftQGRecommendation","QGRecommendation",List.of("title", "body_md"),   FtScope.QUALITY),
        new FtIndex("ftQGJobTask",       "QGJobTask",       List.of("note_md"),            FtScope.QUALITY)
    );
}
