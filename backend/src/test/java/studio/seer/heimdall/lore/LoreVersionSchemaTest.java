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
