package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-05 (SPEC-SKILLS-TAGS-062 §4, SPEC-MODEL-EXPORT-064 §3a):
 * вершина KnowTag из свободного токена становится записью класса.
 *
 * <p>Миграция V95 «knowtag_supertag_fields» объявляет поля вершины: обязательные
 * {@code name}/{@code title}/{@code source}, {@code field_schema} — MAP-подсказка
 * класса (НЕ DDL полей: значения по-прежнему живут на ребре TAGGED_WITH), {@code synonyms} —
 * LIST бывших имён (переименование), {@code owner} — ref на kc_sub, необязателен.
 * Типы контейнеров — MAP/LIST: EMBEDDED*-имён в Type enum ArcadeDB 26.10 нет
 * (замерено падением старта на «No enum constant Type.EMBEDDEDMAP»).
 * Геоид — {@code tag:<slug>} (созидание пишет геоид-форму, см. {@link TagRenameTest}).
 */
class KnowTagSupertagFieldsTest {

    private static LoreSchemaMigrations.Step step(int version) {
        return LoreSchemaMigrations.STEPS.stream().filter(s -> s.version() == version)
            .findFirst().orElseThrow(() -> new AssertionError("нет шага V" + version));
    }

    @Test
    void v95AddsKnowTagVertexFields() {
        LoreSchemaMigrations.Step s = step(95);
        assertEquals("knowtag_supertag_fields", s.name());
        // аддитивный шаг: ось совместимости не сдвигается (см. LoreSchemaMigrationsTest)
        assertEquals(17, s.compatMajor(), "аддитивно — делит major 17 с предыдущими шагами");
        assertTrue(s.sql().size() >= 6, "шесть полей вершины: " + s.sql());
        assertTrue(s.sql().contains(
            "CREATE PROPERTY KnowTag.name         IF NOT EXISTS STRING"), "name обязателен: " + s.sql());
        assertTrue(s.sql().contains(
            "CREATE PROPERTY KnowTag.title        IF NOT EXISTS STRING"), "title обязателен: " + s.sql());
        assertTrue(s.sql().contains(
            "CREATE PROPERTY KnowTag.source       IF NOT EXISTS STRING"), "source обязателен: " + s.sql());
        assertTrue(s.sql().contains(
            "CREATE PROPERTY KnowTag.field_schema IF NOT EXISTS MAP"),
            "field_schema — MAP-подсказка класса, не DDL полей: " + s.sql());
        assertTrue(s.sql().contains(
            "CREATE PROPERTY KnowTag.synonyms     IF NOT EXISTS LIST OF STRING"),
            "synonyms — LIST строк: " + s.sql());
        assertTrue(s.sql().contains(
            "CREATE PROPERTY KnowTag.owner        IF NOT EXISTS STRING"), "owner — ref → kc_sub: " + s.sql());
    }

    @Test
    void v95IsRegistered() {
        // Зонтик KNOW_REGISTRY (25.11.2026): после V95 идут V96/V97 (KnowSkill, SKILL-01..03) — «последний»
        // больше не про V95. Смысл теста — шаг V95 есть в реестре и код не ниже него.
        assertTrue(LoreSchemaMigrations.STEPS.stream().anyMatch(st -> st.version() == 95 && "knowtag_supertag_fields".equals(st.name())), "V95 knowtag_supertag_fields есть в реестре");
        assertTrue(LoreSchemaMigrations.codeVersion() >= 95, "код не ниже V95");
    }
}
