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
        new Fact("component", "USES", "tech_ref", "LoreTechnology по tech_id (стек компонента)"));

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
    static final Map<String, String> NOT_SHOWN = Map.of(
        "doc|BELONGS_TO|doc", "у документа нет паспорта v2 (TYPES) — показывает только сторона компонента",
        "qg|BELONGS_TO|qg", "у гейта качества нет паспорта v2 — показывает только сторона компонента",
        "component|USES|tech_ref", "LoreTechnology — метка стека (tech_id), не паспорт; у компонента — полем «Технологии»",
        "spec|BELONGS_TO|component", LorePassportLinksContractTest.ALIAS,
        "tech|BELONGS_TO|component", LorePassportLinksContractTest.ALIAS);

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

    private static boolean declares(String passportType, String edge, String dir, String target) {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(passportType);
        if (d == null) return false;
        for (LoreRecordRegistry.Relation r : d.relations())
            if (r.rel().equals(edge) && r.dir().equals(dir) && r.targetType().equals(target)) return true;
        return false;
    }

    /** Типы паспорта, которые стоят за сущностью графа. */
    private static List<String> passportsOf(String entity) {
        List<String> out = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES) if (entityOf(t).equals(entity)) out.add(t);
        return out;
    }

    @Test
    void componentAndTechEdgesAreShownOnBothEnds() {
        List<String> bad = new ArrayList<>();
        Set<String> used = new LinkedHashSet<>();
        for (Fact f : facts()) {
            boolean touches = Set.of("component", "tech", "tech_ref").contains(f.from())
                || Set.of("component", "tech", "tech_ref").contains(f.to());
            if (!touches) continue;
            // «Технология» в графе — тоже KnowSpec: факт spec ↔ component не относится к паспорту tech.
            for (String[] end : new String[][]{{f.from(), "out", f.to()}, {f.to(), "in", f.from()}}) {
                String side = end[0];
                String otherPassport = "use_case".equals(end[2]) ? "feature" : end[2];
                List<String> sides = "tech".equals(side) ? List.of("tech") : passportsOf(side);
                String key = f.from() + "|" + f.edge() + "|" + side;
                if (sides.isEmpty()) {
                    if (NOT_SHOWN.containsKey(key)) used.add(key);
                    else bad.add(key + ": у сущности " + side + " нет паспорта — нужно исключение с причиной");
                    continue;
                }
                for (String p : sides) {
                    if (declares(p, f.edge(), end[1], otherPassport)) continue;
                    if (NOT_SHOWN.containsKey(key)) { used.add(key); continue; }
                    bad.add(p + ": не показывает " + f.edge() + "/" + end[1] + " → " + otherPassport + " (" + f.writtenBy() + ")");
                }
            }
        }
        assertEquals(List.of(), bad, "ребро «запись ↔ компонент/технология» есть в графе, а паспорт его не показывает");
        assertEquals(NOT_SHOWN.keySet(), used, "исключение без случая — протухло");
    }

    // ── 5. Чипы проектов и компонентов ───────────────────────────────────────

    /**
     * Фасад кладёт в {@code values.projects}/{@code values.components} чипы у ВСЕХ типов (своё +
     * унаследованное, S4-29). kit показывает только объявленные поля — значение без поля невидимо.
     * Без поля — только с причиной.
     */
    static final Map<String, String> NO_CHIP_FIELD = Map.of(
        "spec|components", "компонент спеки один — поле component (syncSpecComponent ставит одно ребро)",
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
