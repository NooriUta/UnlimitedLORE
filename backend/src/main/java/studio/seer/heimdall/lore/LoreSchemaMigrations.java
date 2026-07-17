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
        ))
    );
}
