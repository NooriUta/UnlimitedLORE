package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Непротиворечивость модели паспорта и графа (слово владелицы 11.11: «в паспортах много где
 * связь с компонентами и технологиями пропала — доделай и провалидируй точность модели и
 * паспортов и непротиворечивость»).
 *
 * <p>Чистый тест, без БД: реестр паспорта ({@link LoreRecordRegistry}), описания чтения
 * ({@link LoreRecordFrom}) сверяются с каталогом рёбер — схемой ({@link LoreSchemaInitializer#DDL},
 * {@link LoreSchemaMigrations#STEPS}), таблицей пар {@link LoreLinkTypes#PAIRS} и таблицей
 * {@link #GRAPH} — рёбрами, которые ставят пути записи вне таблицы пар.
 *
 * <p>Ловит: ребро, которого нет ни в схеме, ни в каталоге; направление против того, как ребро
 * пишется; тип цели, расходящийся с тем, что отдаёт чтение; ребро «запись ↔ компонент/технология»,
 * которое есть в графе, но не объявлено в паспорте одного из концов. Намеренный пропуск — только
 * в явном списке с причиной.
 */
class LorePassportLinksContractTest {

    /** Факт графа: {@code from -edge-> to} в терминах типов сущностей и где он пишется. */
    record Fact(String from, String edge, String to, String writtenBy) {}

    /**
     * Рёбра к компоненту и технологии, которые ставят пути записи, но которых нет в
     * {@link LoreLinkTypes#PAIRS} (у них свои правила: один компонент спеки, дерево, стек).
     * Каждая строка — с местом записи: таблица не выдумывает рёбер.
     */
    static final List<Fact> GRAPH = List.of(
        new Fact("question", "BELONGS_TO", "component", "LoreQuestionResource question/component, question_new"),
        new Fact("use_case", "BELONGS_TO", "component", "LoreProductResource feature_new (linkComponentEdge KnowUseCase)"),
        new Fact("qg", "BELONGS_TO", "component", "LoreQgResource qg_new (linkComponentEdge QualityGate)"),
        new Fact("spec", "BELONGS_TO", "component", "LoreResourceBase.syncSpecComponent"),
        new Fact("component", "DOCUMENTED_IN", "spec", "LoreResourceBase.relinkSpecComponentEdge"),
        // Технология — спека SPEC-TECH-…: те же два ребра пишет тот же путь (/lore/spec upsert).
        new Fact("tech", "BELONGS_TO", "component", "LoreResourceBase.syncSpecComponent (SPEC-TECH-…)"),
        new Fact("component", "DOCUMENTED_IN", "tech", "LoreResourceBase.relinkSpecComponentEdge (SPEC-TECH-…)"),
        new Fact("component", "PARENT_OF", "component", "LoreResourceBase (ребёнок → родитель, parent_id)"),
        new Fact("component", "USES", "tech_ref", "LoreTechnology по tech_id (стек компонента)"),

        // ── Полная карта (слово владелицы 11.11: «все типы связей описаны в модели и попадают
        //    в паспорта»). Каждое ребро схемы — здесь фактом с концами и местом записи, либо в
        //    SERVICE. Рёбра из LoreLinkTypes.PAIRS здесь не повторяются.
        // работа и план
        new Fact("sprint", "DEPENDS_ON", "sprint", "LoreSprintTaskResource sprint_link(rel:dep)"),
        new Fact("adr", "SUPERSEDES", "adr", "LoreAdrResource adr_new/adr_link supersedes_ids"),
        new Fact("decision", "SUPERSEDES", "decision", "пути записи в коде нет — наследие; читается срезом decision"),
        new Fact("decision", "ANSWERS", "question", "LoreQuestionResource question_link(rel:answer)"),
        new Fact("question", "GATES", "task", "LoreQuestionResource question_link(rel:gates)"),
        new Fact("task", "PART_OF", "sprint", "LoreSprintTaskResource task_new / task_mv"),
        new Fact("phase", "PART_OF", "sprint", "LoreSprintTaskResource sprint_phase_new"),
        new Fact("task", "IN_PHASE", "phase", "LoreSprintTaskResource task_new / task_link(phase)"),
        new Fact("task", "CLOSED_BY", "pr", "LoreSprintTaskResource task_link(pr)"),
        new Fact("file", "EDITED_IN", "task", "LoreSprintTaskResource task_link(files)"),
        new Fact("sprint", "IMPLEMENTED_IN_RELEASE", "release", "LoreReleaseResource release_link, LoreForgejoResource"),
        new Fact("pr", "SHIPPED_IN", "release", "LoreReleaseResource release_link, LoreForgejoResource"),
        new Fact("sprint", "TARGETS_MILESTONE", "milestone", "LoreMilestoneResource milestone_link / sprint_link"),
        new Fact("use_case", "TARGETS_MILESTONE", "milestone", "LoreProductResource feature_link(rel:milestone)"),
        new Fact("use_case", "DECOMPOSES_INTO", "use_case", "LoreProductResource uc_new (родитель → сценарий)"),
        // ADR ↔ компонент пишет и ingest (LoreIngestService), то же ребро, что adr_new.
        // Легаси: NM-02 достроил BELONGS_TO задачам по полю component_id (канон задачи — TAGGED_WITH).
        new Fact("task", "BELONGS_TO", "component", "LoreSchemaMigrationRunner NM-02 (COMPONENT_FIELD_TYPES, легаси)"),
        new Fact("qg_job", "BELONGS_TO", "component", "LoreSchemaMigrationRunner NM-07"),
        new Fact("qg_recommendation", "BELONGS_TO", "component", "LoreSchemaMigrationRunner NM-07"),
        // теги
        new Fact("adr", "TAGGED_WITH", "tag", "LoreAdrResource adr_new tags"),
        new Fact("decision", "TAGGED_WITH", "tag", "LoreDecisionResource decision_new tags"),
        new Fact("use_case", "TAGGED_WITH", "tag", "LoreSchemaMigrationRunner (перенос KnowFeature → KnowUseCase, легаси)"),
        // QG и BRAGI
        new Fact("qg_recommendation", "PROMOTED_TO", "task", "LoreQgResource rec_promote"),
        new Fact("qg", "YIELDED", "qg_job", "LoreQgResource qg_job_new"),
        new Fact("qg_job", "PRODUCED", "qg_recommendation", "LoreQgResource rec_new"),
        new Fact("qg", "MEASURED_BY", "qg_metric", "LoreIngestService (метрики гейта)"),
        new Fact("insight", "LED_TO", "task", "LoreBragiResource insight_link"),
        new Fact("insight", "LED_TO", "adr", "LoreBragiResource insight_link"),
        new Fact("publication", "PRODUCED_BY", "task", "LoreBragiResource bragi_link (публикация или её вариант)"),
        new Fact("publication", "PRODUCED_BY", "sprint", "LoreBragiResource bragi_link (публикация или её вариант)"),
        new Fact("publication", "SHIPPED_IN", "release", "LoreBragiResource bragi_link (публикация или её вариант)"),
        new Fact("publication", "HAS_VARIANT", "variant", "LoreBragiResource bragi_variant_new"),
        new Fact("variant", "IN_CHANNEL", "channel", "LoreBragiResource bragi_variant_new"),
        new Fact("variant", "HAS_ASSET", "bragi_asset", "LoreBragiResource bragi_asset_attach"),
        new Fact("publication", "HAS_ASSET", "bragi_asset", "LoreBragiResource bragi_asset_attach"),
        new Fact("publication", "TARGETS_KEY", "keyword", "LoreBragiResource bragi_pub_new"),
        new Fact("keyword", "TARGETS_PAGE", "page", "LoreBragiResource bragi_keyword_set"),
        new Fact("campaign", "FOR_VARIANT", "variant", "LoreBragiResource bragi_campaign_new"),
        new Fact("publication", "IN_RUBRIC", "rubric", "LoreBragiResource bragi_rubric_set"),
        new Fact("keyword", "IN_RUBRIC", "rubric", "LoreBragiResource bragi_rubric_set"),
        // знания
        new Fact("doc", "DOC_CHILD_OF", "doc", "LoreDocResource doc_new parent_doc_id"),
        // продукт, область
        new Fact("component", "IN_AREA", "area", "LoreResourceBase.relinkAreaEdge"),
        new Fact("component", "IN_PRODUCT", "product", "LoreProductAxisResource product_link(rel:component)"),
        new Fact("product", "PARENT_PRODUCT", "product", "LoreProductAxisResource product_link(rel:parent)"),
        new Fact("product", "SERVES", "product", "LoreProductAxisResource product_link(rel:serves)"),
        new Fact("milestone", "TARGETS_PRODUCT", "product", "LoreMilestoneResource milestone_product"),
        // проект
        new Fact("sprint", "BELONGS_TO_PROJECT", "project", "LoreSprintTaskResource sprint_new / sprint_link"),
        new Fact("adr", "BELONGS_TO_PROJECT", "project", "LoreAdrResource adr_link(project)"),
        new Fact("release", "BELONGS_TO_PROJECT", "project", "LoreReleaseResource release_new"),
        new Fact("spec", "BELONGS_TO_PROJECT", "project", "LoreSpecResource spec_link(rel:project)"),
        new Fact("decision", "BELONGS_TO_PROJECT", "project", "LoreDecisionResource decision_new / decision_link"),
        new Fact("question", "BELONGS_TO_PROJECT", "project", "LoreQuestionResource question_link(project)"),
        new Fact("use_case", "BELONGS_TO_PROJECT", "project", "LoreProductResource uc_link(rel:project)"),
        new Fact("doc", "BELONGS_TO_PROJECT", "project", "LoreDocResource doc_link(project)"),
        new Fact("runbook", "BELONGS_TO_PROJECT", "project", "LoreRunbookResource runbook_link(project)"),
        new Fact("actor", "BELONGS_TO_PROJECT", "project", "LoreProductResource actor_new (KnowProjectActor)"),
        new Fact("agent", "BELONGS_TO_PROJECT", "project", "LoreProductResource project_actor_new (KnowActor)"),
        new Fact("file", "BELONGS_TO_PROJECT", "project", "LoreSprintTaskResource task_link(files)"),
        new Fact("pr", "BELONGS_TO_PROJECT", "project", "LoreReleaseResource (PR релиза)"),
        new Fact("component", "BELONGS_TO_PROJECT", "project", "scripts/backfill-component-project.js (по спринтам)"),
        new Fact("user", "HAS_PROJECT_ROLE", "project", "LoreProjectResource / LoreUserResource project_role_set"),
        // «упоминает» — между любыми сущностями каталога (LoreLinkTypes.ENTITIES): /lore/link/mention,
        // автосвязи по упоминанию, холст. Конец «any» — каждый тип паспорта из каталога.
        new Fact("any", "REFERENCES", "any", "LoreLinkResource /lore/link/mention, LoreMentionAutoLink, LoreCanvasResource"),
        // Служебные (SERVICE) — фактами, чтобы сторожить направление там, где паспорт их объявляет.
        new Fact("sprint", "HAS_STATE", "hist", "StatusHistoryService (строка SCD2)"),
        new Fact("task", "HAS_STATE", "hist", "StatusHistoryService (строка SCD2)"),
        new Fact("adr", "HAS_STATE", "hist", "StatusHistoryService (строка SCD2)"),
        new Fact("spec", "HAS_STATE", "hist", "StatusHistoryService (строка SCD2)"),
        new Fact("sprint", "ATTACHED_TO", "asset", "LoreAssetResource asset_up (сущность → KnowAsset)"),
        new Fact("task", "ATTACHED_TO", "asset", "LoreAssetResource asset_up (сущность → KnowAsset)"),
        new Fact("adr", "ATTACHED_TO", "asset", "LoreAssetResource asset_up (сущность → KnowAsset)"),
        new Fact("spec", "ATTACHED_TO", "asset", "LoreAssetResource asset_up (сущность → KnowAsset)"),
        new Fact("task", "ROLE_HELD_BY", "agent", "TaskRoleService (роль задачи → KnowActor)"),
        new Fact("task", "ROLE_HELD_BY", "user", "TaskRoleService (роль задачи → KnowUser)"),
        new Fact("agent", "OWNED_BY", "user", "LoreProductResource project_actor_new"),
        new Fact("agent", "FILLS_ROLE", "actor", "LoreProductResource actor_link(rel:fills_role)"),
        new Fact("agent", "USES_MACHINE", "machine", "AgentMachine"),
        new Fact("user", "MACHINE_ACCESS", "agent", "LoreUserResource"),
        new Fact("agent_session", "LOGGED_BY", "agent", "LoreProductResource agent_session_log"));

    /**
     * Исход «в»: ребро служебное или структурное — в паспорте связью не показывается (или
     * показывается не связью). Ребро → причина. Концы у таких рёбер не сверяются, направление —
     * сверяется, если факт есть.
     */
    static final Map<String, String> SERVICE = Map.ofEntries(
        Map.entry("E", "базовый тип рёбер схемы (EXTENDS E) — экземпляров нет"),
        Map.entry("HAS_STATE", "строка истории SCD2 — раздел «История», а не связь"),
        Map.entry("HAS_STATUS", "легаси: словарь статусов у KnowADRHist, снят V51; пути записи нет"),
        Map.entry("ATTACHED_TO", "вложения тела (MinIO) — показываются в тексте MD, а не связью"),
        Map.entry("ROLE_HELD_BY", "роли задачи — поля автор/исполнитель/принимающий (выбор из task_identities)"),
        Map.entry("OWNED_BY", "личность: агент → его владелец (права, AL-104)"),
        Map.entry("FILLS_ROLE", "личность: агент → роль продукта (профиль клиента)"),
        Map.entry("USES_MACHINE", "личность: агент → машина (miniLORE)"),
        Map.entry("MACHINE_ACCESS", "права: человек → доступ к машине miniLORE"),
        Map.entry("LOGGED_BY", "журнал сессий агентов"),
        Map.entry("ClRoutineHasOutput", "журнал рутин (ClRoutine*); пути записи в коде нет"),
        Map.entry("ON_MILESTONE", "конфиг плана (контрольные точки, срез plan_checkpoints); пути записи в коде нет"),
        Map.entry("OF_TYPE", "конфиг плана (тип трека, срез plan_tracks); пути записи в коде нет"),
        Map.entry("CHANGED_IN", "объявлено DDL, ни записи, ни чтения в коде нет"),
        Map.entry("FORMALIZED_AS", "объявлено DDL, ни записи, ни чтения в коде нет"),
        Map.entry("INCLUDES", "объявлено DDL, ни записи, ни чтения в коде нет (сценарии — UC_INCLUDES)"),
        Map.entry("RELEASED_IN", "объявлено DDL, ни записи, ни чтения в коде нет (релиз — IMPLEMENTED_IN_RELEASE)"),
        Map.entry("VALIDATES", "объявлено DDL, ни записи, ни чтения в коде нет"));

    /**
     * Сущности графа без паспорта v2: их конец ребра не показывается — причина здесь, одна на
     * сущность. Конец с паспортом при этом сверяется как обычно.
     */
    static final Map<String, String> NO_PASSPORT = Map.ofEntries(
        Map.entry("runbook", "у ранбука нет паспорта v2"),
        Map.entry("qg", "у гейта качества нет паспорта v2"),
        Map.entry("qg_job", "прогон гейта — служебная запись QG"),
        Map.entry("qg_recommendation", "рекомендация QG — служебная запись прогона"),
        Map.entry("qg_metric", "метрика гейта — служебная запись QG"),
        Map.entry("pain", "профиль клиента (VP-канва) — без паспорта v2"),
        Map.entry("gain", "профиль клиента (VP-канва) — без паспорта v2"),
        Map.entry("job", "профиль клиента (VP-канва) — без паспорта v2"),
        Map.entry("actor", "роль продукта KnowProjectActor — без паспорта v2"),
        Map.entry("agent", "личность агента KnowActor — без паспорта v2"),
        Map.entry("user", "личность человека KnowUser — без паспорта v2"),
        Map.entry("pr", "PR — внешняя запись Forgejo, без паспорта"),
        Map.entry("file", "файл репозитория — без паспорта"),
        Map.entry("phase", "фаза — только ребёнок спринта (CHILD_ONLY)"),
        Map.entry("tag", "тег — справочник"),
        Map.entry("area", "область — словарь (KnowDictEntry area)"),
        Map.entry("tech_ref", "LoreTechnology — метка стека (tech_id), не паспорт"),
        Map.entry("insight", "инсайт BRAGI — без паспорта v2"),
        Map.entry("publication", "публикация BRAGI — без паспорта v2"),
        Map.entry("variant", "вариант публикации BRAGI"),
        Map.entry("channel", "канал BRAGI"),
        Map.entry("bragi_asset", "ассет BRAGI"),
        Map.entry("keyword", "ключ BRAGI"),
        Map.entry("page", "страница BRAGI"),
        Map.entry("campaign", "кампания BRAGI"),
        Map.entry("rubric", "рубрика BRAGI"));
    // Концы только служебных рёбер (hist, asset, machine, agent_session) здесь не нужны:
    // концы рёбер SERVICE не сверяются, и причина без случая считалась бы протухшей.

    /**
     * Тип паспорта → тип сущности в каталоге рёбер ({@link LoreLinkTypes#ENTITIES}, {@link #GRAPH}).
     * Фича — KnowUseCase (PL-28).
     */
    static String entityOf(String passportType) {
        return "feature".equals(passportType) ? "use_case" : passportType;
    }

    /**
     * Пропуски, которые сделаны НАМЕРЕННО: «тип|ребро|сторона» → причина. Сторона — тип паспорта,
     * который ребро не показывает.
     */
    static final Map<String, String> NOT_SHOWN = Map.ofEntries(
        Map.entry("spec|BELONGS_TO|component", LorePassportLinksContractTest.ALIAS),
        Map.entry("tech|BELONGS_TO|component", LorePassportLinksContractTest.ALIAS),
        // Легаси NM-02: задачам достроено BELONGS_TO по полю component_id, а канон задачи — TAGGED_WITH
        // (паспорт задачи, component_tasks, граф). Показать второе ребро — задвоить компонент.
        Map.entry("task|BELONGS_TO|task", "легаси NM-02; компонент задачи — TAGGED_WITH (поле «Компоненты»)"),
        Map.entry("task|BELONGS_TO|component", "легаси NM-02; задачи компонента — вкладка tasks по TAGGED_WITH"),
        Map.entry("qg_job|BELONGS_TO|component", "прогон гейта — служебная запись; на компоненте виден гейт (вкладка qgs)"),
        Map.entry("qg_recommendation|BELONGS_TO|component", "рекомендация QG — служебная; на компоненте виден гейт (вкладка qgs)"),
        Map.entry("use_case|TAGGED_WITH|use_case", "легаси переноса KnowFeature: пути записи тегов у фичи нет"),
        // Проект: слово владелицы 11.11 «у проекта всё показывать, что связано напрямую» — все концы
        // BELONGS_TO_PROJECT показаны вкладками проекта (исход а). Остаётся только сторона компонента:
        Map.entry("component|BELONGS_TO_PROJECT|component",
            "проекты компонента — чипы через его спринты (git_projects); прямое ребро ставит только бэкфилл по тем же спринтам"));

    /**
     * Спека/технология ↔ компонент — один факт, два ребра (syncSpecComponent ставит оба). Компонент
     * показывает его одной вкладкой по DOCUMENTED_IN, а чтение сводит туда и BELONGS_TO
     * ({@link LoreRecordFrom.LinkFrom#unionColumn()}) — это проверяет {@link #specAliasIsReadAsUnion()}.
     */
    static final String ALIAS = "показывается вкладкой specs/tech (DOCUMENTED_IN out) — чтение сводит оба ребра";

    /**
     * Ключ вкладки «Технологии» компонента — прежний tech: на нём держатся контракт /lore/model
     * (surfaces) и сохранённый личный порядок вкладок. Меняется содержимое, не ключ.
     */
    @Test
    void componentTechTabKeepsItsKey() {
        LoreRecordRegistry.Relation r = LoreRecordRegistry.get("component").relations().stream()
            .filter(x -> x.key().equals("tech")).findFirst().orElseThrow();
        assertEquals(List.of("DOCUMENTED_IN", "out", "tech", "link_tab"),
            List.of(r.rel(), r.dir(), r.targetType(), r.place()), "вкладка tech — паспорта технологий SPEC-TECH-…");
    }

    /**
     * Замечание kit-сессии 11.11: вид конца ребра клиент угадывал по загруженным записям, и запись,
     * которой среди них нет, тихо пропадала из вкладки. Сервер знает вид обоих концов — отдаёт его
     * в каждой связи: fromKind/toKind (ключи только добавляются).
     */
    @Test
    void linksCarryKindOfBothEnds() {
        List<Map<String, Object>> got = LoreRecordValues.withKinds("component", LoreRecordValues.rowLinks("component", Map.of(
            "specs", List.of("SPEC-TECH-C-JAVA"), "decisions", List.of("D-1"))));
        assertEquals(List.of("component→tech", "decision→component"),
            got.stream().map(m -> m.get("fromKind") + "→" + m.get("toKind")).toList());
        assertEquals("tech", got.get(0).get("type"), "прежний ключ type на месте");
    }

    @Test
    void specAliasIsReadAsUnion() {
        LoreRecordFrom.LinkFrom l = LoreRecordFrom.ROW_LINKS.get("component").stream()
            .filter(x -> x.rel().equals("DOCUMENTED_IN") && x.dir().equals("out")).findFirst().orElseThrow();
        assertNotNull(l.unionColumn(), "спеки только с BELONGS_TO пропадали из паспорта компонента");
        assertTrue(LoreSlices.get("component").baseSql().contains("in('BELONGS_TO')[@this INSTANCEOF 'KnowSpec'].spec_id")
            && LoreSlices.get("component").baseSql().contains(l.unionColumn()), "колонка сведения читается срезом");
        List<Map<String, Object>> got = LoreRecordValues.rowLinks("component", Map.of(
            "specs", List.of("SPEC-A", "SPEC-TECH-C-JAVA"), "belonging_specs", List.of("SPEC-A", "SPEC-B")));
        assertEquals(List.of("SPEC-A/spec", "SPEC-TECH-C-JAVA/tech", "SPEC-B/spec"),
            got.stream().map(m -> m.get("id") + "/" + m.get("type")).toList(), "без повторов, технология — tech");
    }

    /**
     * Рёбра, объявленные в паспорте, которых нет среди CREATE EDGE TYPE схемы, — с причиной.
     * ArcadeDB создаёт тип на первой записи, поэтому такие рёбра живут на проде без объявления.
     */
    static final Map<String, String> UNDECLARED_EDGES = Map.of();

    private static final Pattern CREATE_EDGE =
        Pattern.compile("(?i)CREATE\\s+EDGE\\s+TYPE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?`?(\\w+)`?");

    static Set<String> schemaEdges() {
        Set<String> out = new LinkedHashSet<>();
        List<String> sql = new ArrayList<>(LoreSchemaInitializer.DDL);
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) sql.addAll(s.sql());
        for (String q : sql) {
            Matcher m = CREATE_EDGE.matcher(q);
            while (m.find()) out.add(m.group(1));
        }
        return out;
    }

    static List<Fact> facts() {
        List<Fact> all = new ArrayList<>();
        for (LoreLinkTypes.Pair p : LoreLinkTypes.PAIRS)
            all.add(new Fact(p.fromType(), p.edgeType(), p.toType(), "LoreLinkTypes.PAIRS"));
        all.addAll(GRAPH);
        return all;
    }

    // ── 1. Ребро существует ──────────────────────────────────────────────────

    @Test
    void everyPassportEdgeIsDeclaredInSchemaOrCatalog() {
        Set<String> known = new LinkedHashSet<>(schemaEdges());
        for (Fact f : facts()) known.add(f.edge());
        known.addAll(UNDECLARED_EDGES.keySet());
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(t);
            for (LoreRecordRegistry.Relation r : d.relations())
                if (!known.contains(r.rel())) bad.add(t + ".relations." + r.key() + " → " + r.rel());
            for (LoreRecordRegistry.Field f : d.fields())
                if (f.rel() != null && !known.contains(f.rel())) bad.add(t + ".fields." + f.key() + " → " + f.rel());
            for (LoreRecordRegistry.Part p : d.parts())
                if (!known.contains(p.rel())) bad.add(t + ".parts." + p.key() + " → " + p.rel());
            for (LoreRecordRegistry.LinkTab lt : d.linkTabs())
                for (LoreRecordRegistry.TabRel tr : lt.rels())
                    if (!known.contains(tr.rel())) bad.add(t + ".link_tabs." + lt.key() + " → " + tr.rel());
        }
        assertEquals(List.of(), bad, "ребро паспорта, которого нет ни в схеме, ни в каталоге");
        for (String e : UNDECLARED_EDGES.keySet())
            assertFalse(schemaEdges().contains(e), e + ": уже объявлено схемой — исключение протухло");
    }

    // ── 2. Направление ───────────────────────────────────────────────────────

    @Test
    void relationDirectionMatchesHowTheEdgeIsWritten() {
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) {
            String self = entityOf(t);
            for (LoreRecordRegistry.Relation r : LoreRecordRegistry.get(t).relations()) {
                String other = entityOf(r.targetType());
                boolean fwd = false, back = false;
                for (Fact f : facts()) {
                    if (!f.edge().equals(r.rel())) continue;
                    if (f.from().equals(self) && f.to().equals(other)) fwd = true;
                    if (f.from().equals(other) && f.to().equals(self)) back = true;
                }
                if (!fwd && !back) continue;   // ребро вне каталога — не о чем судить
                if (fwd && back) continue;     // петля по типу (ADR ↔ ADR) — оба направления законны
                String expected = fwd ? "out" : "in";
                if (!expected.equals(r.dir()))
                    bad.add(t + "." + r.key() + ": " + r.rel() + " " + r.dir() + ", а пишется " + expected);
            }
        }
        assertEquals(List.of(), bad, "направление связи против пути записи");
    }

    // ── 3. Тип цели ──────────────────────────────────────────────────────────

    /** Поле-ссылка и связь с тем же ключом говорят об одном ребре и одной цели. */
    @Test
    void refFieldAndRelationAgreeOnEdgeAndTarget() {
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(t);
            for (LoreRecordRegistry.Field f : d.fields()) {
                if (f.refType() == null || f.rel() == null) continue;
                for (LoreRecordRegistry.Relation r : d.relations())
                    if (r.key().equals(f.key())
                        && !(r.rel().equals(f.rel()) && r.dir().equals(f.dir()) && r.targetType().equals(f.refType())))
                        bad.add(t + "." + f.key() + ": поле " + f.rel() + "/" + f.dir() + "/" + f.refType()
                            + " ≠ связь " + r.rel() + "/" + r.dir() + "/" + r.targetType());
            }
        }
        assertEquals(List.of(), bad);
    }

    /**
     * Каждая связь, которую отдаёт чтение (строка главного среза или отдельный срез), попадает
     * ровно в одну объявленную связь паспорта по (ребро, сторона, тип цели). Иначе вкладка либо
     * пуста при живом ребре, либо показывает чужое.
     */
    @Test
    void everyReadLinkLandsInExactlyOneDeclaredRelation() {
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) {
            List<String[]> emitted = new ArrayList<>();
            for (LoreRecordFrom.LinkFrom l : LoreRecordFrom.ROW_LINKS.getOrDefault(t, List.of())) {
                emitted.add(new String[]{l.rel(), l.dir(), l.type(), "row:" + l.column()});
                if (l.techByPrefix()) emitted.add(new String[]{l.rel(), l.dir(), "tech", "row:" + l.column() + "(SPEC-TECH-)"});
            }
            for (LoreRecordFrom.SliceLink s : LoreRecordFrom.SLICE_LINKS.getOrDefault(t, List.of()))
                emitted.add(new String[]{s.rel(), s.dir(), s.type(), "slice:" + s.slice()});
            for (String[] e : emitted) {
                long n = LoreRecordRegistry.get(t).relations().stream()
                    .filter(r -> r.rel().equals(e[0]) && r.dir().equals(e[1])
                        && (r.targetType().equals(e[2]) || "any".equals(r.targetType())))
                    .count();
                if (n != 1) bad.add(t + " " + e[3] + ": " + e[0] + "/" + e[1] + "/" + e[2] + " → связей " + n);
            }
        }
        assertEquals(List.of(), bad, "связь из чтения без своей (или с двумя) объявленной связью");
    }

    /**
     * Одно ребро в двух связях типа (у компонента BELONGS_TO:in — ADR, спринты, решения…) различимо
     * только типом цели. Поэтому у таких связей цель обязана быть конкретной, а не «any».
     */
    @Test
    void sharedEdgeRelationsHaveConcreteDistinctTargets() {
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, List<LoreRecordRegistry.Relation>> by = new java.util.LinkedHashMap<>();
            for (LoreRecordRegistry.Relation r : LoreRecordRegistry.get(t).relations())
                by.computeIfAbsent(r.rel() + ":" + r.dir(), k -> new ArrayList<>()).add(r);
            for (var e : by.entrySet()) {
                if (e.getValue().size() < 2) continue;
                Set<String> targets = new LinkedHashSet<>();
                for (LoreRecordRegistry.Relation r : e.getValue()) {
                    if ("any".equals(r.targetType())) bad.add(t + "." + r.key() + ": " + e.getKey() + " общее, а цель any");
                    else if (!targets.add(r.targetType()) && !"prop".equals(r.place()))
                        bad.add(t + "." + r.key() + ": " + e.getKey() + " — цель " + r.targetType() + " повторяется");
                }
            }
        }
        assertEquals(List.of(), bad);
    }

    // ── 4. Компонент и технология — с обеих сторон ───────────────────────────

    /** Объявлена ли связь: ребро, сторона и тип цели; цель «any» у связи покрывает любую. */
    private static boolean declares(String passportType, String edge, String dir, String target) {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(passportType);
        if (d == null) return false;
        for (LoreRecordRegistry.Relation r : d.relations())
            if (r.rel().equals(edge) && r.dir().equals(dir)
                && (r.targetType().equals(target) || "any".equals(r.targetType()))) return true;
        return false;
    }

    /**
     * Типы паспорта, которые стоят за сущностью графа. «Технология» в графе — тоже KnowSpec, но
     * факт spec ↔ … к паспорту tech не относится: у tech свои факты. «any» (REFERENCES) — каждый
     * тип паспорта, чья сущность есть в каталоге {@link LoreLinkTypes#ENTITIES} (и tech — это KnowSpec).
     */
    private static List<String> passportsOf(String entity) {
        List<String> out = new ArrayList<>();
        if ("tech".equals(entity)) return List.of("tech");
        for (String t : LoreRecordRegistry.TYPES) {
            if ("any".equals(entity)) {
                if (LoreLinkTypes.ENTITIES.containsKey(entityOf(t)) || "tech".equals(t)) out.add(t);
            } else if (entityOf(t).equals(entity)) out.add(t);
        }
        return out;
    }

    /** Исход факта на одном конце: a — объявлено, b — исключение, «нет паспорта» — причина сущности. */
    record EndOutcome(Fact fact, String side, String passport, String outcome, String note) {}

    static List<EndOutcome> endOutcomes(List<String> bad, Set<String> usedNotShown, Set<String> usedNoPassport) {
        List<EndOutcome> out = new ArrayList<>();
        for (Fact f : facts()) {
            if (SERVICE.containsKey(f.edge())) continue;
            for (String[] end : new String[][]{{f.from(), "out", f.to()}, {f.to(), "in", f.from()}}) {
                String side = end[0];
                String otherPassport = "use_case".equals(end[2]) ? "feature" : end[2];
                List<String> sides = passportsOf(side);
                String key = f.from() + "|" + f.edge() + "|" + side;
                if (sides.isEmpty()) {
                    if (NO_PASSPORT.containsKey(side)) {
                        usedNoPassport.add(side);
                        out.add(new EndOutcome(f, side, null, "no_passport", NO_PASSPORT.get(side)));
                    } else bad.add(key + ": у сущности " + side + " нет паспорта — нужна причина в NO_PASSPORT");
                    continue;
                }
                for (String p : sides) {
                    // Цель «сценарий» реестр пишет и как feature (паспорт), и как use_case (task.useCases,
                    // adr.useCases — тип ссылки из чтения): это одна вершина KnowUseCase.
                    if (declares(p, f.edge(), end[1], otherPassport)
                        || ("feature".equals(otherPassport) && declares(p, f.edge(), end[1], "use_case"))) {
                        out.add(new EndOutcome(f, side, p, "a", null));
                        continue;
                    }
                    if (NOT_SHOWN.containsKey(key)) {
                        usedNotShown.add(key);
                        out.add(new EndOutcome(f, side, p, "b", NOT_SHOWN.get(key)));
                        continue;
                    }
                    bad.add(p + ": не показывает " + f.edge() + "/" + end[1] + " → " + otherPassport + " (" + f.writtenBy() + ")");
                }
            }
        }
        return out;
    }

    /**
     * Каждое ребро графа (кроме служебных) показано паспортом на каждом конце, у которого паспорт
     * есть (исход а), либо пропуск назван в {@link #NOT_SHOWN} с причиной (исход б); конец без
     * паспорта — с причиной в {@link #NO_PASSPORT}. Раньше тест проверял только рёбра к компоненту
     * и технологии.
     */
    @Test
    void everyGraphEdgeIsShownOnBothEndsOrExplained() {
        List<String> bad = new ArrayList<>();
        Set<String> used = new LinkedHashSet<>();
        Set<String> usedNp = new LinkedHashSet<>();
        endOutcomes(bad, used, usedNp);
        assertEquals(List.of(), bad, "ребро есть в графе, а паспорт конца его не показывает и причины нет");
        assertEquals(new java.util.TreeSet<>(NOT_SHOWN.keySet()), new java.util.TreeSet<>(used), "исключение без случая — протухло");
        assertEquals(new java.util.TreeSet<>(NO_PASSPORT.keySet()), new java.util.TreeSet<>(usedNp), "причина «нет паспорта» без случая — протухла");
        for (String e : NO_PASSPORT.keySet())
            assertTrue(passportsOf(e).isEmpty(), e + ": паспорт появился — причина «нет паспорта» протухла");
    }

    // ── 4а. Полнота: каждое ребро схемы описано ─────────────────────────────

    /**
     * Каждый тип ребра схемы (DDL + миграции) описан: фактами с концами (исходы а/б) или в
     * {@link #SERVICE} с причиной (исход в). Новое ребро без описания роняет CI.
     */
    @Test
    void everySchemaEdgeIsDescribed() {
        Set<String> withFacts = new LinkedHashSet<>();
        for (Fact f : facts()) withFacts.add(f.edge());
        List<String> bad = new ArrayList<>();
        for (String e : schemaEdges())
            if (!withFacts.contains(e) && !SERVICE.containsKey(e))
                bad.add(e + ": в схеме есть, а концов (GRAPH/PAIRS) и причины «служебное» (SERVICE) нет");
        assertEquals(List.of(), bad, "ребро схемы не описано в модели паспорта");
        Set<String> known = new LinkedHashSet<>(schemaEdges());
        known.addAll(UNDECLARED_EDGES.keySet());
        for (String e : SERVICE.keySet()) assertTrue(known.contains(e), e + ": в SERVICE, но в схеме нет — протухло");
        for (String e : withFacts) assertTrue(known.contains(e), e + ": факт графа, а в схеме ребра нет");
        for (String r : SERVICE.values()) assertFalse(r.isBlank());
    }

    private static final Pattern CODE_CREATE_EDGE = Pattern.compile("CREATE\\s+EDGE\\s+([A-Z][A-Za-z_]+)\\b");
    private static final Pattern CODE_TRAVERSE =
        Pattern.compile("\\b(?:out|in|both|outE|inE|bothE)\\(\\s*((?:'[A-Za-z_]+'\\s*,?\\s*)+)\\)");
    private static final Pattern QUOTED = Pattern.compile("'([A-Za-z_]+)'");

    /**
     * Рёбра, которые код пакета lore пишет ({@code CREATE EDGE X}) или обходит
     * ({@code out('X')}, {@code inE('X')}…), есть в схеме. Иначе ребро живёт на проде без
     * объявления (ArcadeDB заводит тип на первой записи) — и мимо проверки полноты выше.
     */
    @Test
    void everyEdgeInCodeIsInSchema() throws java.io.IOException {
        java.nio.file.Path dir = java.nio.file.Paths.get("src/main/java/studio/seer/heimdall/lore");
        assertTrue(java.nio.file.Files.isDirectory(dir), "исходники пакета lore не найдены — проверка не выполнена: " + dir.toAbsolutePath());
        Set<String> known = new LinkedHashSet<>(schemaEdges());
        known.addAll(UNDECLARED_EDGES.keySet());
        Set<String> seen = new java.util.TreeSet<>();
        List<String> bad = new ArrayList<>();
        try (var files = java.nio.file.Files.list(dir)) {
            for (java.nio.file.Path p : files.filter(x -> x.toString().endsWith(".java")).sorted().toList()) {
                String src = java.nio.file.Files.readString(p);
                Matcher m = CODE_CREATE_EDGE.matcher(src);
                while (m.find()) {
                    String e = m.group(1);
                    if (Set.of("TYPE", "FROM").contains(e)) continue;
                    seen.add(e);
                    if (!known.contains(e)) bad.add(p.getFileName() + ": CREATE EDGE " + e);
                }
                Matcher t = CODE_TRAVERSE.matcher(src);
                while (t.find()) {
                    Matcher q = QUOTED.matcher(t.group(1));
                    while (q.find()) {
                        seen.add(q.group(1));
                        if (!known.contains(q.group(1))) bad.add(p.getFileName() + ": обход '" + q.group(1) + "'");
                    }
                }
            }
        }
        assertTrue(seen.size() > 30, "сканер нашёл подозрительно мало рёбер (" + seen.size() + ") — регулярка сломана?");
        assertEquals(List.of(), bad, "ребро в коде, которого нет в схеме (CREATE EDGE TYPE)");
    }

    /** Таблица исходов для отчёта: ребро → между чем → исход. Печатается в system-out теста. */
    @Test
    void printOutcomeTable() {
        List<String> bad = new ArrayList<>();
        List<EndOutcome> ends = endOutcomes(bad, new LinkedHashSet<>(), new LinkedHashSet<>());
        StringBuilder sb = new StringBuilder("EDGE-OUTCOMES\n");
        Map<String, List<String>> byEdge = new java.util.TreeMap<>();
        for (EndOutcome e : ends)
            byEdge.computeIfAbsent(e.fact().edge() + " " + e.fact().from() + "→" + e.fact().to(), k -> new ArrayList<>())
                .add(e.side() + (e.passport() != null && !e.passport().equals(e.side()) ? "(" + e.passport() + ")" : "")
                    + "=" + e.outcome());
        byEdge.forEach((k, v) -> sb.append(k).append(" | ").append(String.join(", ", v)).append('\n'));
        for (var s : new java.util.TreeMap<>(SERVICE).entrySet()) sb.append(s.getKey()).append(" | в: ").append(s.getValue()).append('\n');
        System.out.println(sb);
        assertTrue(byEdge.size() > 0);
    }

    @Test
    void componentAndTechEdgesAreShownOnBothEnds() {
        // Частный случай полной проверки выше — оставлен ради имени: компонент и технология.
        List<String> bad = new ArrayList<>();
        endOutcomes(bad, new LinkedHashSet<>(), new LinkedHashSet<>());
        bad.removeIf(s -> !(s.contains("component") || s.contains("tech")));
        assertEquals(List.of(), bad, "ребро «запись ↔ компонент/технология» есть в графе, а паспорт его не показывает");
    }

    // ── 5. Чипы проектов и компонентов ───────────────────────────────────────

    /**
     * Фасад кладёт в {@code values.projects}/{@code values.components} чипы у ВСЕХ типов (своё +
     * унаследованное, S4-29). kit показывает только объявленные поля — значение без поля невидимо.
     * Без поля — только с причиной.
     */
    static final Map<String, String> NO_CHIP_FIELD = Map.of(
        "spec|components", "компонент спеки один — поле component (syncSpecComponent ставит одно ребро)",
        "doc|components", "компонент документа один — поле component (одно ребро BELONGS_TO, S5-DOC-PASSPORT)",
        "tech|components", "компонент технологии один — поле component",
        "tech|projects", "у технологии проектов нет: ни ребра в tech_by_id, ни наследования",
        "component|components", "компонент — сам себе компонент; дерево — поля parent/children",
        "project|projects", "проект — сам себе проект",
        "project|components", "компоненты проекта — вкладкой components (срез project_components)");

    @Test
    void chipValuesHaveADeclaredField() {
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES)
            for (String k : List.of("projects", "components")) {
                boolean has = LoreRecordRegistry.get(t).field(k) != null;
                boolean excused = NO_CHIP_FIELD.containsKey(t + "|" + k);
                if (has == excused) bad.add(t + "." + k + (has ? ": поле есть, исключение протухло" : ": чипы есть, поля нет"));
            }
        assertEquals(List.of(), bad);
    }

    /** Поле-ссылка без ребра — только унаследованные чипы (своего ребра у типа нет). */
    @Test
    void refWithoutEdgeIsOnlyAnInheritedChip() {
        List<String> bad = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES)
            for (LoreRecordRegistry.Field f : LoreRecordRegistry.get(t).fields())
                if (f.refType() != null && f.rel() == null && !Set.of("projects", "components").contains(f.key()))
                    bad.add(t + "." + f.key());
        assertEquals(List.of(), bad);
    }

    // ── 6. Путь записи компонента у задачи ───────────────────────────────────

    /** Ребро «запись → компонент» по типу вершины — одно правило для всех путей записи. */
    @Test
    void componentEdgeOfVertexMatchesCatalog() {
        assertEquals("TAGGED_WITH", LoreLinkTypes.componentEdgeOf("KnowTask"),
            "задача → компонент — TAGGED_WITH (паспорт задачи, component_tasks); QG ставил BELONGS_TO");
        for (String v : List.of("KnowADR", "KnowDecision", "KnowDoc", "KnowSprint", "KnowQuestion",
            "KnowUseCase", "QualityGate", "KnowSpec"))
            assertEquals("BELONGS_TO", LoreLinkTypes.componentEdgeOf(v), v);
        for (LoreLinkTypes.Pair p : LoreLinkTypes.PAIRS)
            if ("component".equals(p.toType()))
                assertEquals(p.edgeType(), LoreLinkTypes.componentEdgeOf(LoreLinkTypes.entity(p.fromType()).vertexClass()),
                    p.fromType() + ": ребро к компоненту в каталоге и в пути записи одно");
    }
}
