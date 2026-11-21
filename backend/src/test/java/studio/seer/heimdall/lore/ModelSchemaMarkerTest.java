package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · Сервер на базе, схема которой собрана установщиком из модели (MIG-01,
 * «миграция без эволюции»). Находка 17.11.2026: сервер из migration/model-v2 не стартовал на перенесённой базе —
 * «схема НЕ накатана (нет ни одной строки LoreSchemaVersion)». У такой базы журнала шагов V нет по построению;
 * вместо него установщик пишет отметку LoreModelSchema (хэш модели, версия, время, источник).
 *
 * <p>Писать в журнал строки V1…Vn «как будто применены» нельзя — это неправда о базе. Поэтому три состояния
 * различаются явно, и отказ старта на пустой базе остаётся прежним.
 */
class ModelSchemaMarkerTest {

    @Test
    void ledgerWinsWhenPresent() {
        assertEquals(LoreSchemaMigrationRunner.SchemaSource.LEDGER, LoreSchemaMigrationRunner.schemaSource(93, List.of()));
        assertEquals(LoreSchemaMigrationRunner.SchemaSource.LEDGER,
            LoreSchemaMigrationRunner.schemaSource(93, List.of(Map.of("model_hash", "h", "source", "installer"))),
            "журнал шагов есть — база старой схемы, отметка не подменяет сверку шагов");
    }

    @Test
    void markerMeansSchemaFromModel() {
        assertEquals(LoreSchemaMigrationRunner.SchemaSource.MODEL,
            LoreSchemaMigrationRunner.schemaSource(0, List.of(Map.of("model_hash", "5ebf7cac4f12cde6", "source", "installer"))));
    }

    @Test
    void emptyDatabaseStaysEmpty() {
        assertEquals(LoreSchemaMigrationRunner.SchemaSource.EMPTY, LoreSchemaMigrationRunner.schemaSource(0, List.of()));
        assertEquals(LoreSchemaMigrationRunner.SchemaSource.EMPTY,
            LoreSchemaMigrationRunner.schemaSource(0, List.of(Map.of("source", "installer"))),
            "отметка без хэша модели — не отметка: по ней нельзя сказать, из какой модели схема");
    }

    /**
     * MIG-01 · выкатка 1.18 на препрод. Шаг CD «Migrate schema» идёт с lore.migrate=true + lore.migrate.only=true;
     * на базе из модели старт отказывал — CD краснел на каждой выкатке. Шаг накатки на такой базе ничего не пишет:
     * шаги V пропускаются, процесс выходит с 0 и говорит об этом своей строкой. Сервер (migrate без only) — отказ как был.
     */
    @Test
    void cdMigrateOnlyStepOnModelDatabaseSkipsVSteps() {
        assertEquals(LoreSchemaMigrationRunner.ModelStart.SKIP_V_STEPS, LoreSchemaMigrationRunner.onModelSchema(true, true));
    }

    @Test
    void serverWithMigrateOnModelDatabaseIsStillRefused() {
        assertEquals(LoreSchemaMigrationRunner.ModelStart.REFUSE, LoreSchemaMigrationRunner.onModelSchema(true, false));
    }

    @Test
    void runtimeOnModelDatabaseEnablesReadAdapter() {
        assertEquals(LoreSchemaMigrationRunner.ModelStart.READ_ADAPTER, LoreSchemaMigrationRunner.onModelSchema(false, false));
    }

    @Test
    void skipLineIsWhatCdStepGrepsFor() {
        // .github/scripts/migrate-schema.sh принимает ровно эту строку как «накатка не нужна, база из модели»
        assertTrue(LoreSchemaMigrationRunner.MODEL_SKIP_LINE.contains("шаги V пропущены"));
        assertTrue(LoreSchemaMigrationRunner.MODEL_SKIP_LINE.contains("LoreModelSchema"));
    }
}
