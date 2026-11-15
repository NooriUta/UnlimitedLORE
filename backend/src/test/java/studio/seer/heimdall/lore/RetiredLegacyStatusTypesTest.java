package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE (решение владелицы 14.11.2026 «да, а+б+в»):
 * легаси-словари статусов Status* ×6, TrackType и рёбра к ним (HAS_STATUS, OF_TYPE) сняты шагом V89.
 * Статусы живут в универсальном справочнике KnowDictEntry и в status_raw строки истории.
 *
 * <p>Сторож от возврата: снятый тип не должен снова объявляться ни бутстрапом (LoreSchemaInitializer —
 * им ставится чистая установка и инсталлятор), ни снимками схемы (create-schema.sql, schema-metadata.json),
 * ни шагом миграции. Объявленный, но никем не читаемый и не пишущийся тип — ровно то, из-за чего
 * они пережили переезд на справочник.
 */
class RetiredLegacyStatusTypesTest {

    /** Список прибит здесь, а не взят из кода: правка константы в main не должна тихо ослабить сторож. */
    static final List<String> RETIRED = List.of(
        "HAS_STATUS", "OF_TYPE",
        "StatusAdr", "StatusDecision", "StatusMilestone", "StatusPhase", "StatusSprint", "StatusTask",
        "TrackType");

    private static Pattern declares(String type) {
        return Pattern.compile("(?i)CREATE\\s+(?:VERTEX|EDGE|DOCUMENT)\\s+TYPE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?`?"
            + type + "`?\\b");
    }

    private static List<String> declaredIn(Iterable<String> statements) {
        List<String> hits = new ArrayList<>();
        for (String sql : statements)
            for (String t : RETIRED)
                if (declares(t).matcher(sql).find() || sql.matches("(?is).*\\b" + t + "\\.\\w+.*")) hits.add(t + ": " + sql);
        return hits;
    }

    @Test
    void patternCatchesDeclarationPositiveControl() {
        assertFalse(declaredIn(List.of("CREATE VERTEX TYPE StatusSprint     IF NOT EXISTS EXTENDS V")).isEmpty());
        assertFalse(declaredIn(List.of("CREATE EDGE TYPE HAS_STATUS IF NOT EXISTS EXTENDS E")).isEmpty());
        assertFalse(declaredIn(List.of("CREATE PROPERTY TrackType.type_id IF NOT EXISTS STRING")).isEmpty());
        assertTrue(declaredIn(List.of("CREATE VERTEX TYPE StatusSprintX IF NOT EXISTS")).isEmpty(),
            "чужое имя с тем же префиксом — не снятый тип");
    }

    @Test
    void initializerDoesNotDeclareRetiredTypes() {
        assertEquals(List.of(), declaredIn(LoreSchemaInitializer.DDL),
            "снятый V89 тип снова объявлен в LoreSchemaInitializer — чистая установка его создаст");
    }

    @Test
    void schemaSnapshotsDoNotDeclareRetiredTypes() throws IOException {
        String sql = Files.readString(Path.of("db-schema/create-schema.sql"), StandardCharsets.UTF_8);
        assertEquals(List.of(), declaredIn(sql.lines().toList()), "create-schema.sql");
        String meta = Files.readString(Path.of("db-schema/schema-metadata.json"), StandardCharsets.UTF_8);
        for (String t : RETIRED)
            assertFalse(meta.contains("\"name\": \"" + t + "\""), "schema-metadata.json объявляет " + t);
    }

    @Test
    void noMigrationStepCreatesRetiredTypes() {
        List<String> all = new ArrayList<>();
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) all.addAll(s.sql());
        assertEquals(List.of(), declaredIn(all), "шаг миграции заводит снятый тип");
    }

    @Test
    void v89IsRegisteredAsReviewedJavaStep() {
        LoreSchemaMigrations.Step v89 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 89).findFirst().orElse(null);
        assertNotNull(v89, "шаг V89 в реестре");
        assertEquals(LoreSchemaMigrations.RETIRE_LEGACY_STATUS_STEP, v89.name());
        assertTrue(V1SchemaSafetyChecklist.JAVA_STEPS_REVIEWED.containsKey(v89.name()),
            "Java-шаг после базиса v1 — только с разбором (JAVA_STEPS_REVIEWED)");
        assertEquals(RETIRED, LoreSchemaMigrations.RETIRED_LEGACY_STATUS_TYPES,
            "V89 снимает ровно эти типы, рёбра — раньше вершин");
    }

    /** Перенос: значение status_raw читается тем же классификатором, что и паспорт/слайсы. */
    @Test
    void legacyStatusTransfersToReadableStatusRaw() {
        assertEquals("⬜ TODO", LoreSchemaMigrations.legacyStatusRaw("KnowTaskHist", "todo"));
        assertEquals("✅ DONE", LoreSchemaMigrations.legacyStatusRaw("KnowTaskHist", "done"));
        assertEquals("📋 PLANNED", LoreSchemaMigrations.legacyStatusRaw("KnowPhaseHist", "planned"),
            "как пишет phase_new");
        assertEquals("done", LoreStatusVocabulary.classify(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "closed")));
        assertEquals("deferred", LoreStatusVocabulary.classify(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "paused")));
        assertEquals("in_progress", LoreStatusVocabulary.classify(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "in_progress")));
        assertEquals("design", LoreStatusVocabulary.classify(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "research")));
        assertEquals("backlog", LoreStatusVocabulary.classify(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "backlog")));
        assertEquals("todo", LoreStatusResource.rawToToken(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "todo")));
        assertEquals("upcoming", LoreSchemaMigrations.legacyStatusRaw("KnowMilestoneHist", "upcoming"),
            "веха: код словаря milestone_status как есть");
        assertEquals("fixed", LoreSchemaMigrations.legacyStatusRaw("KnowDecisionHist", "fixed"),
            "решение: код decision_status как есть");
        assertNull(LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "unknown"),
            "«unknown» — не статус: не придумываем todo (ADR-LORE-039), поле остаётся пустым");
        assertThrows(IllegalArgumentException.class,
            () -> LoreSchemaMigrations.legacyStatusRaw("KnowSprintHist", "never-seen"),
            "незнакомый код — шаг падает до удаления, а не теряет статус");
    }

    @Test
    void planTracksReadsAreaNotTrackType() {
        String sql = LoreSlices.get("plan_tracks").baseSql();
        assertFalse(sql.contains("OF_TYPE"), "plan_tracks не ходит в снятый TrackType: " + sql);
        assertTrue(sql.contains("area AS type"), "тип трека — код справочника area: " + sql);
    }

    @Test
    void milestonePassportReadsStatusFromHistory() {
        String sql = LoreSlices.get("milestone_by_id").baseSql();
        assertTrue(sql.contains("status_raw[0] AS status"), "статус вехи — из открытой строки истории: " + sql);
    }

    /** Основание записи в JAVA_STEPS_REVIEWED: v1 (папка src/) снятых типов не знает. */
    @Test
    void v1FolderDoesNotReferenceRetiredTypes() throws IOException {
        Path v1 = Path.of("..", "src");
        assertTrue(Files.isDirectory(v1), "папка v1 найдена: " + v1.toAbsolutePath());
        List<String> hits = new ArrayList<>();
        try (Stream<Path> files = Files.walk(v1)) {
            for (Path p : files.filter(Files::isRegularFile)
                    .filter(f -> f.toString().matches(".*\\.(ts|tsx|js|jsx)$")).toList()) {
                String body = Files.readString(p, StandardCharsets.UTF_8);
                for (String t : RETIRED) if (body.matches("(?s).*\\b" + t + "\\b.*")) hits.add(p + ": " + t);
            }
        }
        assertEquals(List.of(), hits);
    }
}
