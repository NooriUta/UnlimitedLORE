package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-06 · decision:D-2026-UXR-LINK-MENTION-EDGE —
 * каталог типов связей для кнопки «Связать» в панели «упоминания без связи».
 *
 * <p><b>Правило.</b> Предлагаются СУЩЕСТВУЮЩИЕ типизированные рёбра, допустимые
 * для пары сущностей: граф остаётся типизированным. Общий {@code REFERENCES}
 * («упоминает») — запасной вариант, когда подходящего типа нет; он идёт от
 * упоминающей записи к упомянутой и допустим для любой пары из каталога.
 *
 * <p><b>Что в таблицу НЕ входит — сознательно.</b>
 * <ul>
 *   <li>Структурные рёбра (HAS_STATE, PART_OF, IN_PHASE, BELONGS_TO,
 *       BELONGS_TO_PROJECT, TAGGED_WITH, DOC_CHILD_OF): это принадлежность и
 *       иерархия, а не «связь по смыслу», и у них есть свои пути записи.
 *       Исключение — привязка к компоненту: BELONGS_TO (adr/decision/doc/sprint)
 *       и TAGGED_WITH задача → компонент; «запись про компонент» ставится
 *       и из упоминания (SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK).</li>
 *   <li>Рёбра с побочным действием: ANSWERS (закрывает вопрос), SUPERSEDES
 *       (требует статуса SUPERSEDED у старого ADR), GATES (меняет готовность
 *       задачи), DEPENDS_ON спринтов (kind/reason и проверка цикла). Поставить их
 *       «голым» ребром значило бы обойти правило, которое их путь записи держит.</li>
 * </ul>
 *
 * <p>Направления взяты из путей записи, которыми эти рёбра ставятся сейчас
 * (task_link, adr_link, uc_link, feature_link, vp_link, question_link,
 * runbook_link, doc_link, decision_new). Обратное направление ломало бы
 * читателей-слайсы молча — поэтому вариант для развёрнутой пары приходит
 * с явными концами ({@link Option#reversed()}).
 */
final class LoreLinkTypes {

    private LoreLinkTypes() {}

    /** Запасной тип ребра. Объявлен миграцией V65 (references_edge). */
    static final String FALLBACK_EDGE = "REFERENCES";

    /**
     * Тип сущности в API (совпадает с {@code type} в выдаче /lore/search, чтобы
     * упоминание из поиска сразу годилось в «Связать»), его вершина, поле id и
     * семейство матрицы прав агента, которое правит эту сущность.
     */
    record Entity(String type, String vertexClass, String idField, String family) {}

    /** Строка таблицы допустимых пар: направленное ребро {@code from → to}. */
    record Pair(String fromType, String edgeType, String toType) {}

    /**
     * Вариант для UI под конкретное упоминание.
     *
     * @param reversed ребро идёт от упомянутой записи к упоминающей
     * @param fallback это запасной {@code REFERENCES}
     */
    record Option(String edgeType, String fromType, String toType, boolean reversed, boolean fallback) {}

    static final Map<String, Entity> ENTITIES;
    static {
        Map<String, Entity> m = new LinkedHashMap<>();
        put(m, "adr",      "KnowADR",          "adr_id",      "adr");
        put(m, "spec",     "KnowSpec",         "spec_id",     "spec");
        put(m, "sprint",   "KnowSprint",       "sprint_id",   "sprint");
        put(m, "task",     "KnowTask",         "task_uid",    "task");
        put(m, "decision", "KnowDecision",     "decision_id", "decision");
        put(m, "question", "KnowQuestion",     "question_id", "question");
        put(m, "runbook",  "KnowRunbook",      "runbook_id",  "runbook");
        put(m, "doc",      "KnowDoc",          "doc_id",      "doc");
        put(m, "use_case", "KnowUseCase",      "uc_id",       "uc");
        put(m, "pain",     "KnowPain",         "pain_id",     "pain");
        put(m, "gain",     "KnowGain",         "gain_id",     "gain");
        put(m, "job",      "KnowJob",          "job_id",      "job");
        put(m, "actor",    "KnowProjectActor", "actor_id",    "project-actor");
        put(m, "release",  "KnowRelease",      "release_id",  "release");
        put(m, "component", "LoreComponent",   "component_id", "component");
        ENTITIES = Collections.unmodifiableMap(m);
    }

    private static void put(Map<String, Entity> m, String type, String cls, String id, String family) {
        m.put(type, new Entity(type, cls, id, family));
    }

    /**
     * Таблица допустимых типизированных рёбер. Порядок внутри пары — порядок
     * показа в UI (самое частое первым).
     */
    static final List<Pair> PAIRS = List.of(
        // работа ↔ решения
        new Pair("task",     "JUSTIFIED_BY",           "adr"),
        new Pair("task",     "REALIZES",               "use_case"),
        new Pair("decision", "DECIDED_IN",             "adr"),
        new Pair("adr",      "IMPLEMENTED_IN",         "sprint"),
        new Pair("adr",      "IMPLEMENTED_IN_RELEASE", "release"),
        new Pair("adr",      "DEPENDS_ON",             "adr"),
        new Pair("doc",      "IMPLEMENTED_IN",         "sprint"),
        new Pair("runbook",  "REFERENCES_ADR",         "adr"),
        // вопросы: где подняты (GATES/ANSWERS — со своими правилами, вне таблицы)
        new Pair("question", "RAISED_IN",              "adr"),
        new Pair("question", "RAISED_IN",              "sprint"),
        new Pair("question", "RAISED_IN",              "task"),
        // сценарии: трассировка к обоснованию, акторы, граф сценариев
        new Pair("use_case", "TRACED_TO",              "adr"),
        new Pair("use_case", "TRACED_TO",              "decision"),
        new Pair("use_case", "HAS_ACTOR",              "actor"),
        new Pair("use_case", "UC_INCLUDES",            "use_case"),
        new Pair("use_case", "UC_EXTENDS",             "use_case"),
        new Pair("use_case", "BUILDS_ON",              "use_case"),
        // ценностное предложение: фича заявляет (ADDRESSES/PROMISES/HELPS_WITH),
        // сценарий делает (RELIEVES/DELIVERS/PERFORMS). Фича — KnowUseCase (PL-28).
        new Pair("use_case", "ADDRESSES",              "pain"),
        new Pair("use_case", "RELIEVES",               "pain"),
        new Pair("use_case", "PROMISES",               "gain"),
        new Pair("use_case", "DELIVERS",               "gain"),
        new Pair("use_case", "HELPS_WITH",             "job"),
        new Pair("use_case", "PERFORMS",               "job"),
        // профиль клиента: чья боль/выгода/работа, связи внутри профиля
        new Pair("pain",     "FELT_BY",                "actor"),
        new Pair("gain",     "DESIRED_BY",             "actor"),
        new Pair("job",      "PERFORMED_BY",           "actor"),
        new Pair("pain",     "BLOCKS",                 "job"),
        new Pair("gain",     "SUCCESS_OF",             "job"),
        // привязка к компоненту (SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK): рёбра те же, что ставят
        // adr_new/adr_link, decision_new, doc_new/doc_link, sprint_link. Спеки здесь НЕТ: у неё
        // компонент один (syncSpecComponent снимает все и ставит один, чтение берёт [0]).
        new Pair("adr",      "BELONGS_TO",             "component"),
        new Pair("decision", "BELONGS_TO",             "component"),
        new Pair("doc",      "BELONGS_TO",             "component"),
        new Pair("sprint",   "BELONGS_TO",             "component"),
        // У задачи СВОЁ ребро к компоненту — TAGGED_WITH (task/component, task_mv, срез
        // component_tasks, LoreRecordFrom SLICE_LINKS, LoreGraphBuilder). Слова владелицы 11.11:
        // «компоненты привязываются и к задаче».
        new Pair("task",     "TAGGED_WITH",            "component")
    );

    /**
     * Пары, которые сервер ставит САМ по упоминанию в теле (spec:SPEC-LORE-MD-INLINE-REF §7,
     * {@link LoreMentionAutoLink}). Явный список, а не «любая пара с одним ребром»:
     * одно ребро в каталоге ещё не значит, что упоминание его подразумевает — решение,
     * упомянувшее чужой ADR, не «решено в» нём (DECIDED_IN). Новая пара сюда — по слову владелицы.
     */
    static final java.util.Set<String> AUTO_PAIRS = java.util.Set.of(
        "adr|BELONGS_TO|component",
        "decision|BELONGS_TO|component",
        "doc|BELONGS_TO|component",
        "sprint|BELONGS_TO|component",
        "task|TAGGED_WITH|component");

    static boolean isAuto(String fromType, String edgeType, String toType) {
        return AUTO_PAIRS.contains(fromType + "|" + edgeType + "|" + toType)
            && isAllowed(fromType, toType, edgeType);
    }

    static Entity entity(String type) {
        return type == null ? null : ENTITIES.get(type);
    }

    /**
     * Варианты для упоминания: запись {@code mentioning} упоминает
     * {@code mentioned}. Сначала типизированные в прямом направлении, затем в
     * обратном, последним — запасной {@code REFERENCES}. Неизвестный тип —
     * пустой список.
     */
    static List<Option> optionsFor(String mentioning, String mentioned) {
        if (entity(mentioning) == null || entity(mentioned) == null) return List.of();
        List<Option> out = new ArrayList<>();
        for (Pair p : PAIRS) {
            if (p.fromType().equals(mentioning) && p.toType().equals(mentioned))
                out.add(new Option(p.edgeType(), mentioning, mentioned, false, false));
        }
        if (!mentioning.equals(mentioned)) {
            for (Pair p : PAIRS) {
                if (p.fromType().equals(mentioned) && p.toType().equals(mentioning))
                    out.add(new Option(p.edgeType(), mentioned, mentioning, true, false));
            }
        }
        out.add(new Option(FALLBACK_EDGE, mentioning, mentioned, false, true));
        return out;
    }

    /** Допустимо ли ребро {@code edgeType} ровно в направлении {@code from → to}. */
    static boolean isAllowed(String fromType, String toType, String edgeType) {
        if (entity(fromType) == null || entity(toType) == null || edgeType == null) return false;
        if (FALLBACK_EDGE.equals(edgeType)) return true;
        for (Pair p : PAIRS) {
            if (p.fromType().equals(fromType) && p.toType().equals(toType) && p.edgeType().equals(edgeType))
                return true;
        }
        return false;
    }
}
