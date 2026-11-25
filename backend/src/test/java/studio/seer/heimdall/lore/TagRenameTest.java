package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-05 — супертеги: геоид {@code tag:<slug>} и сторож
 * переименования (чистая часть, без БД; эндпоинт — {@link TagRenameLiveDbTest}).
 *
 * <p>Токен привязки в телах документов — {@code [[GEOID#тег]]} (прототип
 * docs/prototypes/supertags-spike.html). Переименование = batch-перепись тел:
 * переписываются ТОЛЬКО токены, чей геоид резолвится в живую запись; всё остальное
 * (битый геоид, токен без геоида, голое «#тег») — в отчёт «несопоставленные»,
 * автоматом не трогается. Бывшее имя — в {@code synonyms} вершины.
 */
class TagRenameTest {

    private static final TagRename.Geoids ALL = g -> true;
    private static final TagRename.Geoids NONE = g -> false;

    // ── геоид ────────────────────────────────────────────────────────────────

    @Test
    void geoidPrefixesSlugWithTagNamespace() {
        assertEquals("tag:security-review", TagRename.geoid("security-review"));
        assertEquals("tag:безопасность", TagRename.geoid("безопасность"), "кириллица — легальная");
        // уже геоид — не дублируем префикс
        assertEquals("tag:security-review", TagRename.geoid("tag:security-review"));
    }

    @Test
    void slugStripsGeoidPrefix() {
        assertEquals("security-review", TagRename.slugOf("tag:security-review"));
        assertEquals("security-review", TagRename.slugOf("security-review"), "легаси-токен — как есть");
    }

    // ── перепись тела ────────────────────────────────────────────────────────

    @Test
    void rewriteReplacesOnlyResolvedTokens() {
        String body = "Разбор: [[ADR-LORE-050#sec-review]] и ещё [[doc_x#sec-review]] тут.\n";
        TagRename.BodyResult r = TagRename.rewriteBody(body, "sec-review", "security-review", ALL);
        assertEquals("Разбор: [[ADR-LORE-050#security-review]] и ещё [[doc_x#security-review]] тут.\n",
            r.body());
        assertEquals(2, r.places());
        assertTrue(r.unmatched().isEmpty(), "все токены сопоставились: " + r.unmatched());
    }

    @Test
    void rewriteLeavesOtherTagsAlone() {
        String body = "[[A#sec-review]] и [[A#secrets]] и #sec-review-ручной";
        TagRename.BodyResult r = TagRename.rewriteBody(body, "sec-review", "security-review", ALL);
        assertEquals("[[A#security-review]] и [[A#secrets]] и #sec-review-ручной", r.body());
        assertEquals(1, r.places());
        assertTrue(r.unmatched().isEmpty(), "прочие теги и похожие имена не тронуты");
    }

    @Test
    void brokenGeoidIsReportedNotRewritten() {
        String body = "См. [[GHOST-1#sec-review]] здесь.";
        TagRename.BodyResult r = TagRename.rewriteBody(body, "sec-review", "security-review", NONE);
        assertEquals(0, r.places(), "битый геоид не переписывается");
        assertEquals(body, r.body());
        assertEquals(1, r.unmatched().size());
        assertTrue(r.unmatched().get(0).fragment().contains("GHOST-1"), r.unmatched().toString());
        assertTrue(r.unmatched().get(0).reason().contains("геоид"), "причина — битый геоид: " + r.unmatched());
    }

    @Test
    void tokenWithoutGeoidIsReported() {
        String body = "Упоминание [[#sec-review]] без хозяина.";
        TagRename.BodyResult r = TagRename.rewriteBody(body, "sec-review", "security-review", ALL);
        assertEquals(0, r.places());
        assertEquals(1, r.unmatched().size());
        assertTrue(r.unmatched().get(0).reason().contains("геоид"), r.unmatched().toString());
    }

    @Test
    void plainMentionIsReportedNotRewritten() {
        String body = "Голый хештег #sec-review в тексте.";
        TagRename.BodyResult r = TagRename.rewriteBody(body, "sec-review", "security-review", ALL);
        assertEquals(0, r.places(), "голое упоминание не переписывается");
        assertEquals(body, r.body());
        assertEquals(1, r.unmatched().size());
        assertTrue(r.unmatched().get(0).reason().contains("[[GEOID#"), r.unmatched().toString());
    }

    @Test
    void longTagDoesNotMatchLongerSiblingName() {
        // «#sec» не должен лезть в «#sec-review»: граница токена — не буква/цифра/._-
        String body = "[[A#sec]] плюс [[B#sec-review]]";
        TagRename.BodyResult r = TagRename.rewriteBody(body, "sec", "sec2", ALL);
        assertEquals("[[A#sec2]] плюс [[B#sec-review]]", r.body());
        assertEquals(1, r.places());
    }

    // ── вершина: бывшее имя в synonyms ───────────────────────────────────────

    @Test
    void renameVertexCarriesFormerNameIntoSynonyms() {
        TagRename.VertexPatch p = TagRename.renameVertex("sec-review", "security-review", "sec-review", List.of());
        assertEquals("tag:security-review", p.tagId(), "ключ вершины — геоид нового слага");
        assertEquals("security-review", p.name());
        assertEquals(List.of("sec-review"), p.synonyms(), "бывшее имя — в synonyms");
        assertEquals("security-review", p.title(), "title по умолчанию = имя");
    }

    @Test
    void synonymsAppendWithoutDuplicates() {
        assertEquals(List.of("a"), TagRename.synonymsWith(null, "a"));
        assertEquals(List.of("a", "b"), TagRename.synonymsWith(List.of("a"), "b"));
        assertEquals(List.of("a", "b"), TagRename.synonymsWith(List.of("a", "b"), "b"), "дубль не плодится");
    }

    @Test
    void customTitleSurvivesRename() {
        TagRename.VertexPatch p = TagRename.renameVertex("sec", "security", "Разбор безопасности", List.of());
        assertEquals("Разбор безопасности", p.title(), "своя подпись не затирается");
        TagRename.VertexPatch def = TagRename.renameVertex("sec", "security", "", List.of());
        assertEquals("security", def.title(), "пустой title обновляется до нового имени");
    }

    // ── приёмка зонтика KNOW_REGISTRY ────────────────────────────────────────

    /**
     * 062 §8 «batch-перезапись по ВСЕМ телам»: корпус переписи — не только KnowDoc. ADR, спеки, решения,
     * вопросы, скиллы, сценарии, ранбуки, спринты, задачи — и у типов с SCD2 только ОТКРЫТАЯ строка истории
     * (закрытые *Hist — неизменяемый слепок).
     */
    @Test
    void rewriteCorpusCoversAllBodiesAndOnlyOpenHistory() {
        Set<String> types = new TreeSet<>();
        for (TagBodies b : TagBodies.ALL) types.add(b.type());
        assertTrue(types.containsAll(List.of("doc", "adr", "spec", "decision", "question", "skill", "feature",
            "runbook", "sprint", "task")), types.toString());
        TagBodies adr = TagBodies.ALL.stream().filter(b -> b.type().equals("adr")).findFirst().orElseThrow();
        assertEquals(List.of("context_md", "decision_md", "consequences_md"), adr.fields());
        for (TagBodies b : TagBodies.ALL) {
            if (b.from().endsWith("Hist")) {
                assertTrue(b.openHist() && b.selectSql().contains("valid_to IS NULL"), b.from() + ": только открытая версия");
                assertEquals(3, b.stamp().length, b.from() + ": content_hash открытой строки пересчитывается");
            }
            assertTrue(b.selectSql().contains("LIKE :p"), b.selectSql());
        }
    }

    /** 062 §7: rename с несопоставленными — outcome partial_failure (ok остаётся true — вызов дошёл, ADR-LORE-043). */
    @Test
    void renameOutcomeIsPartialFailureWhenUnmatched() {
        assertEquals("updated", TagRename.outcome(List.of()));
        assertEquals("partial_failure", TagRename.outcome(List.of(Map.of("fragment", "[[GHOST#a]]"))));
    }

    /** 061 §5: занятое имя — IDENTITY_CONFLICT; прежний код — в legacy_code (переходный, для старых клиентов). */
    @Test
    void takenNameIsIdentityConflict() {
        Map<String, Object> e = TagRename.identityConflict("security", "#12:3");
        assertEquals("IDENTITY_CONFLICT", e.get("error"));
        assertEquals("TAG_TAKEN", e.get("legacy_code"));
        assertTrue(String.valueOf(e.get("detail")).contains("security"));
        assertFalse(String.valueOf(e.get("hint")).isBlank());
    }

    /** 062 §4: source тега — словарь seed/agent/human; агент или человек — по типу вызывающего. */
    @Test
    void tagSourceFollowsCallerKind() {
        assertEquals("agent", TagRename.sourceOf("developer"));
        assertEquals("human", TagRename.sourceOf(null));
        assertTrue(SkillRules.SOURCES.contains(TagRename.sourceOf("full")));
    }
}
