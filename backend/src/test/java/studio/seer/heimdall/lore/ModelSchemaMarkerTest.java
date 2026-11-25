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
    void cdMigrateOnlyStepOnModelDatabaseSkipsVStepsAndRunsAdditive() {
        // 25.11.2026: шаги V по-прежнему не катятся, но схема ДОВОДИТСЯ до кода (LoreSchemaAdditive) — V94–V100 и
        // всё, что после 1.18, иначе до прода не доезжало.
        assertEquals(LoreSchemaMigrationRunner.ModelStart.ADDITIVE, LoreSchemaMigrationRunner.onModelSchema(true, true));
    }

    @Test
    void runtimeOnModelDatabase_additiveOnlyWithSchemaRights() {
        // рантайм под basic (установщик, стенды) доводит сам; под токеном без updateSchema (прод) — только сверяет и
        // громко говорит, что доводка не выполнена: DDL под токеном упал бы
        assertEquals(LoreSchemaMigrationRunner.Additive.APPLY, LoreSchemaMigrationRunner.additiveOnStart(true, true, "basic"));
        assertEquals(LoreSchemaMigrationRunner.Additive.APPLY, LoreSchemaMigrationRunner.additiveOnStart(false, false, "basic"));
        assertEquals(LoreSchemaMigrationRunner.Additive.CHECK, LoreSchemaMigrationRunner.additiveOnStart(false, false, "token"));
    }

    @Test
    void additiveLineIsWhatCdStepGrepsFor() {
        String line = LoreSchemaMigrationRunner.modelAdditiveLine(new LoreSchemaAdditive.Report(5, 21, 6, 18, List.of("know_skill")));
        // .github/scripts/migrate-schema.sh, lore-host-deploy.sh и migrate-live-check.sh ищут «доводка схемы кода»
        assertTrue(line.contains("lore.migrate.only=true"), line);
        assertTrue(line.contains("LoreModelSchema"), line);
        assertTrue(line.contains(LoreSchemaMigrationRunner.ADDITIVE_MARK), line);
        assertTrue(line.contains("типов +5") && line.contains("свойств +21") && line.contains("индексов +6") && line.contains("посеяно 18"), line);
        assertTrue(line.contains("v" + LoreSchemaAdditive.VERSION), line);
        assertFalse(line.contains("накатывать нечего"), "доводка — не «нечего»: " + line);
    }

    @Test
    void serverWithMigrateOnModelDatabaseIsStillRefused() {
        assertEquals(LoreSchemaMigrationRunner.ModelStart.REFUSE, LoreSchemaMigrationRunner.onModelSchema(true, false));
    }

    @Test
    void runtimeOnModelDatabaseEnablesReadAdapter() {
        assertEquals(LoreSchemaMigrationRunner.ModelStart.READ_ADAPTER, LoreSchemaMigrationRunner.onModelSchema(false, false));
    }
}
