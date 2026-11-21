package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MIG-01 («схема и база собираются заново из нормализованной модели»): на базе, собранной из модели (отметка
 * LoreModelSchema), /lore/version показывает версию модели, а не номер последнего шага V кода (93) — шаги V на такой
 * базе не катились, и «93» было бы неправдой о базе. Эмуляция установщика на ryzenai 21.11.2026.
 */
class LoreVersionSchemaTest {

    @Test
    void базаИзМодели_версияМодели() {
        Map<String, Object> s = LoreVersionResource.schemaOf(93, List.of(Map.of("model_hash", "abc123def4567890", "source", "installer")));
        assertEquals("model:abc123def4567890", s.get("schema_version"));
        assertEquals("model", s.get("schema_source"));
    }

    /** Патч 1.18.1, владелица: «версию модели после миграции начни с 1». Номер — из отметки, хэш — отдельным полем. */
    @Test
    void базаИзМодели_номерМодели_хэшОтдельно() {
        Map<String, Object> s = LoreVersionResource.schemaOf(93, List.of(Map.of("model_hash", "d7e16a827891d5e0", "model_version", 1, "source", "installer")));
        assertEquals("model:1", s.get("schema_version"));
        assertEquals("d7e16a827891d5e0", s.get("model_hash"));
        assertEquals("model", s.get("schema_source"));
    }

    @Test
    void модельВФайле_номер1_отметкаБезНомера_дописываетсяИдемпотентно() {
        assertEquals(1, LoreModelFile.content().modelVersion(), "модель 1.18 — версия 1");
        String sql = LoreSchemaMigrationRunner.modelVersionBackfillSql();
        assertTrue(sql.startsWith("UPDATE LoreModelSchema SET model_version = 1"), sql);
        assertTrue(sql.contains("WHERE model_version IS NULL"), "только если номера нет — повтор ничего не меняет: " + sql);
    }

    @Test
    void базаШагов_номерШага() {
        Map<String, Object> s = LoreVersionResource.schemaOf(93, List.of());
        assertEquals(93, s.get("schema_version"));
        assertEquals("steps", s.get("schema_source"));
    }

    @Test
    void отметкаБезХэша_неОтметка() {
        assertEquals(93, LoreVersionResource.schemaOf(93, List.of(Map.of("source", "x"))).get("schema_version"));
    }
}
