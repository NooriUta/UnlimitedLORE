package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK · spec:SPEC-LORE-MD-INLINE-REF §7.
 *
 * <p>Чистая часть автосвязей по упоминаниям: разбор {@code [[тип:ID]]} /
 * {@code [[ID]]} по правилам фронта ({@code kit/src/content/markdownWiki.ts} +
 * {@code web-next/src/record/loreRefForms.ts}) и решение «ставить / не ставить».
 * Запись в граф — в resource-слое (его проверяет live-DB CI).
 */
class LoreMentionAutoLinkTest {

    // ── разбор: та же форма, что у фронта ─────────────────────────────────

    @Test
    void typedAndUntypedRefsAreParsedLikeTheFront() {
        List<LoreMentionAutoLink.Ref> refs = LoreMentionAutoLink.parse(
            "см. [[component:OMILORE]], [[ADR-LORE-050]] и [[ SPEC:SPEC-LORE-MD-INLINE-REF ]]");
        assertEquals(3, refs.size(), refs.toString());
        assertEquals("component", refs.get(0).type());
        assertEquals("OMILORE", refs.get(0).id());
        assertEquals("adr", refs.get(1).type(), "без типа — тип по форме ID (typeByForm)");
        assertEquals("ADR-LORE-050", refs.get(1).id());
        assertEquals("spec", refs.get(2).type(), "тип — в нижний регистр, пробелы внутри [[ ]] срезаются");
        assertEquals("SPEC-LORE-MD-INLINE-REF", refs.get(2).id());
    }

    @Test
    void formsByIdMatchTypeByForm() {
        assertEquals("adr", LoreMentionAutoLink.typeByForm("ADR-MIDGARD-010"));
        assertEquals("spec", LoreMentionAutoLink.typeByForm("SPEC-X"));
        assertEquals("decision", LoreMentionAutoLink.typeByForm("D-2026-LORE-MD-REF-PASTE-CHECK"));
        assertEquals("task", LoreMentionAutoLink.typeByForm("SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK"));
        assertNull(LoreMentionAutoLink.typeByForm("OMILORE"), "компонент без типа по форме не узнаётся");
        assertNull(LoreMentionAutoLink.typeByForm("ADR-"), "форма требует буквы/цифры в конце");
        assertNull(LoreMentionAutoLink.typeByForm("D-26-X"));
    }

    @Test
    void codeIsNeverParsed() {
        String md = "`[[component:A]]` текст ``x [[component:B]] y``\n"
            + "```\n[[component:C]]\n```\n"
            + "~~~md\n[[component:D]]\n~~~\n"
            + "после [[component:E]]";
        List<LoreMentionAutoLink.Ref> refs = LoreMentionAutoLink.parse(md);
        assertEquals(List.of("E"), refs.stream().map(LoreMentionAutoLink.Ref::id).toList(),
            "внутри кода (inline и блоки) ссылка не считается");
    }

    @Test
    void duplicatesCollapseAndNullOrNestedAreSafe() {
        assertTrue(LoreMentionAutoLink.parse(null).isEmpty());
        assertEquals(1, LoreMentionAutoLink.parse("[[component:X]] и снова [[component:X]]").size());
        assertTrue(LoreMentionAutoLink.parse("[[a\nb]] [[]] [[x[y]]").stream()
            .noneMatch(r -> r.id().contains("\n")), "перевод строки и скобки внутри — не ссылка");
    }

    @Test
    void severalBodiesAreMergedWithoutDuplicates() {
        List<LoreMentionAutoLink.Ref> refs = LoreMentionAutoLink.parse(
            "[[component:X]]", null, "[[component:X]] [[component:Y]]");
        assertEquals(List.of("X", "Y"), refs.stream().map(LoreMentionAutoLink.Ref::id).toList());
    }

    // ── решение: ставить только однозначное и помеченное как авто ─────────

    @Test
    void adrMentioningComponentGetsBelongsTo() {
        LoreMentionAutoLink.Decision d = LoreMentionAutoLink.decide("adr", "ADR-X",
            new LoreMentionAutoLink.Ref("[[component:OMILORE]]", "component", "OMILORE"));
        LoreMentionAutoLink.Plan p = assertInstanceOf(LoreMentionAutoLink.Plan.class, d);
        assertEquals("BELONGS_TO", p.option().edgeType());
        assertEquals("adr", p.fromType());
        assertEquals("ADR-X", p.fromId());
        assertEquals("component", p.toType());
        assertEquals("OMILORE", p.toId());
    }

    @Test
    void componentPairsForDecisionDocSprintAndReversedSpec() {
        for (String t : List.of("decision", "doc", "sprint")) {
            LoreMentionAutoLink.Plan p = assertInstanceOf(LoreMentionAutoLink.Plan.class,
                LoreMentionAutoLink.decide(t, "ID-1", new LoreMentionAutoLink.Ref("r", "component", "C")), t);
            assertEquals("BELONGS_TO", p.option().edgeType());
            assertEquals(t, p.fromType());
        }
        // компонент упоминает ADR — ребро всё равно ADR → компонент (развёрнутый вариант)
        LoreMentionAutoLink.Plan p = assertInstanceOf(LoreMentionAutoLink.Plan.class,
            LoreMentionAutoLink.decide("component", "C", new LoreMentionAutoLink.Ref("r", "adr", "ADR-X")));
        assertEquals("BELONGS_TO", p.option().edgeType());
        assertEquals("adr", p.fromType());
        assertEquals("ADR-X", p.fromId());
        assertEquals("component", p.toType());
        assertEquals("C", p.toId());
    }

    /**
     * У спеки компонент ОДИН по замыслу (syncSpecComponent: «снимаем все и ставим один»,
     * чтение берёт [0]). Второе ребро по упоминанию сделало бы компонент спеки зависящим
     * от порядка вставки — поэтому спека → компонент сама не ставится.
     */
    @Test
    void specMentioningComponentIsNotAutoLinked() {
        LoreMentionAutoLink.Skip s = assertInstanceOf(LoreMentionAutoLink.Skip.class,
            LoreMentionAutoLink.decide("spec", "SPEC-X", new LoreMentionAutoLink.Ref("r", "component", "C")));
        assertEquals("references_only", s.reason());
    }

    @Test
    void autoLinkUsesOriginMentionAuto() {
        assertEquals("mention-auto", LoreMentionAutoLink.ORIGIN);
        assertFalse(LoreMentionAutoLink.ORIGIN.equals(LoreLinkResource.ORIGIN_MENTION),
            "авто-ребро отличимо от поставленного руками из «Связать»");
    }

    @Test
    void referencesOnlyIsNotPlaced() {
        LoreMentionAutoLink.Skip s = assertInstanceOf(LoreMentionAutoLink.Skip.class,
            LoreMentionAutoLink.decide("adr", "ADR-X", new LoreMentionAutoLink.Ref("r", "pain", "P-1")));
        assertEquals("references_only", s.reason());
    }

    @Test
    void ambiguousPairIsNotPlaced() {
        // сценарий ↔ боль: ADDRESSES и RELIEVES — человек выбирает сам
        LoreMentionAutoLink.Skip s = assertInstanceOf(LoreMentionAutoLink.Skip.class,
            LoreMentionAutoLink.decide("use_case", "UC-1", new LoreMentionAutoLink.Ref("r", "pain", "P-1")));
        assertEquals("ambiguous_pair", s.reason());
    }

    @Test
    void singleTypedEdgeNotMarkedAutoIsLeftToTheHuman() {
        // решение упоминает чужой ADR: единственный типизированный DECIDED_IN, но второе
        // «решено в» было бы ложью — такие пары без отметки владелицы не ставятся сами
        LoreMentionAutoLink.Skip s = assertInstanceOf(LoreMentionAutoLink.Skip.class,
            LoreMentionAutoLink.decide("decision", "D-2026-X", new LoreMentionAutoLink.Ref("r", "adr", "ADR-Y")));
        assertEquals("not_auto_pair", s.reason());
    }

    @Test
    void unknownTypeFormSelfAndBadIdAreSkippedWithReason() {
        assertEquals("unknown_type", ((LoreMentionAutoLink.Skip) LoreMentionAutoLink.decide("adr", "A",
            new LoreMentionAutoLink.Ref("r", "bogus", "X"))).reason());
        assertEquals("unknown_form", ((LoreMentionAutoLink.Skip) LoreMentionAutoLink.decide("adr", "A",
            new LoreMentionAutoLink.Ref("r", null, "OMILORE"))).reason());
        assertEquals("self", ((LoreMentionAutoLink.Skip) LoreMentionAutoLink.decide("adr", "ADR-A",
            new LoreMentionAutoLink.Ref("r", "adr", "ADR-A"))).reason());
        assertEquals("bad_id", ((LoreMentionAutoLink.Skip) LoreMentionAutoLink.decide("adr", "A",
            new LoreMentionAutoLink.Ref("r", "component", "a b'c"))).reason());
    }

    @Test
    void ucAliasMapsToUseCase() {
        List<LoreMentionAutoLink.Ref> refs = LoreMentionAutoLink.parse("[[uc:UC-1]]");
        assertEquals("use_case", refs.get(0).type(), "uc — как WORDS в loreMdRefs.tsx");
    }

    @Test
    void planOverBodiesKeepsOrderAndReasons() {
        List<LoreMentionAutoLink.Decision> ds = LoreMentionAutoLink.plan("adr", "ADR-X",
            "[[component:OMILORE]] [[pain:P-1]] `[[component:NO]]`");
        assertEquals(2, ds.size());
        assertInstanceOf(LoreMentionAutoLink.Plan.class, ds.get(0));
        assertEquals("references_only", ((LoreMentionAutoLink.Skip) ds.get(1)).reason());
        assertEquals("[[pain:P-1]]", ds.get(1).ref().raw());
    }

    // ── задача → компонент (слова владелицы 11.11: «компоненты привязываются и к задаче») ──

    @Test
    void taskMentioningComponentPlansTaggedWith() {
        LoreMentionAutoLink.Plan p = assertInstanceOf(LoreMentionAutoLink.Plan.class,
            LoreMentionAutoLink.decide("task", "SPRINT_X/T-1",
                new LoreMentionAutoLink.Ref("[[component:OMILORE]]", "component", "OMILORE")));
        assertEquals("TAGGED_WITH", p.option().edgeType());
        assertEquals("task", p.fromType());
        assertEquals("SPRINT_X/T-1", p.fromId());
        assertEquals("component", p.toType());
        assertEquals("OMILORE", p.toId());
        // компонент упоминает задачу — ребро всё равно задача → компонент
        LoreMentionAutoLink.Plan r = assertInstanceOf(LoreMentionAutoLink.Plan.class,
            LoreMentionAutoLink.decide("component", "C",
                new LoreMentionAutoLink.Ref("r", "task", "SPRINT_X/T-1")));
        assertEquals("TAGGED_WITH", r.option().edgeType());
        assertEquals("task", r.fromType());
        assertEquals("SPRINT_X/T-1", r.fromId());
    }

    @Test
    void taskNoteMentionTextIsOnlyAppendedPartOnAppend() {
        assertEquals("дописка [[component:B]]",
            LoreSprintTaskResource.taskNoteMentionText(null, "дописка [[component:B]]"),
            "note_append — разбирается только добавленный текст");
        assertEquals("целиком [[component:A]]",
            LoreSprintTaskResource.taskNoteMentionText("целиком [[component:A]]", null));
        assertNull(LoreSprintTaskResource.taskNoteMentionText(null, null), "заметку не трогали — разбирать нечего");
    }

    @Test
    void backfillCoversTasks() {
        assertTrue(LoreLinkResource.BACKFILL_BODIES.containsKey("task"), "сухой бэкфилл обязан учитывать задачи");
        assertTrue(LoreLinkResource.BACKFILL_BODIES.get("task").contains("note_md"));
    }
}
