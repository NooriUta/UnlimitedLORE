package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-01: DDL-миграция V94 — рантайм-реестр видов
 * KnowKind и его SCD2-история KnowKindHist (SPEC-MODEL-EXPORT-064 §5, ADR-LORE-057).
 *
 * <p>Канон формы — из спеки: атрибуты KnowKind в DDL, стабильные, с индексами
 * (слово владелицы 24.11.2026), не schemaless-JSON. UNIQUE на kind — гард
 * двойников: две записи одного вида — дефект входов, импорт обязан упасть
 * с отчётом, а не молча смержить. Индексы на source (прогоны импорта по
 * происхождению) и replaces (поиск «кто заменил этот вид»; replaces —
 * строковая ссылка внутри записи, не графовое ребро).
 *
 * <p>Проверки — ЧТЕНИЕМ из настоящей схемы (schema:types / schema:indexes),
 * как в HistValidTimeDatetimeLiveDbTest: тест ловит и «шаг не накатился», и
 * «свойство объявлено не тем типом», и «индекс не тот по уникальности».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class KnowKindSchemaLiveDbTest {

    @Inject
    LoreIngestService ingest;

    @Test
    void knowKindTypeExistsWithSpecFields() {
        Map<String, String> want = new LinkedHashMap<>(Map.ofEntries(
            Map.entry("kind",      "STRING"),
            Map.entry("id_field",  "STRING"),
            Map.entry("title",     "STRING"),
            Map.entry("fields",    "LIST"),
            Map.entry("links",     "LIST"),
            Map.entry("guards",    "LIST"),
            Map.entry("roles",     "LIST"),
            Map.entry("replaces",  "LIST"),
            Map.entry("source",    "STRING"),
            Map.entry("lifecycle", "MAP")));
        assertEquals(want, declaredProperties("KnowKind"),
            "KnowKind не сошёлся с каноном SPEC-MODEL-EXPORT-064 §5");
    }

    @Test
    void knowKindHistIsScd2() {
        Map<String, String> got = declaredProperties("KnowKindHist");
        Map<String, String> want = Map.of(
            "valid_from",   "DATETIME",
            "valid_to",     "DATETIME",
            "content_hash", "STRING");
        for (Map.Entry<String, String> e : want.entrySet()) {
            assertEquals(e.getValue(), got.get(e.getKey()),
                "KnowKindHist." + e.getKey() + " обязан быть " + e.getValue()
                + " (SCD2 по образцу прочих *Hist): " + got);
        }
    }

    @Test
    void kindIndexIsUniqueAndSourceReplacesAreIndexed() {
        List<Map<String, Object>> kindIdx = indexesOn("KnowKind", "kind");
        assertFalse(kindIdx.isEmpty(), "уникальный индекс на KnowKind.kind не создан");
        assertTrue(kindIdx.stream().allMatch(r -> Boolean.TRUE.equals(r.get("unique"))),
            "индекс на KnowKind.kind обязан быть UNIQUE (гард двойников): " + kindIdx);
        assertFalse(indexesOn("KnowKind", "source").isEmpty(),
            "индекс на KnowKind.source не создан (прогоны импорта по происхождению)");
        assertFalse(indexesOn("KnowKind", "replaces").isEmpty(),
            "индекс на KnowKind.replaces не создан (поиск «кто заменил этот вид»)");
    }

    /** Поле → объявленный тип свойства, прямым чтением schema:types. */
    private Map<String, String> declaredProperties(String type) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT properties FROM schema:types WHERE name = :n", Map.of("n", type));
        assertEquals(1, rows.size(), "тип " + type + " не объявлен в схеме");
        Object props = rows.get(0).get("properties");
        assertTrue(props instanceof Iterable<?>, type + ": schema:types не отдал properties: " + rows);
        Map<String, String> out = new LinkedHashMap<>();
        for (Object p : (Iterable<?>) props) {
            assertTrue(p instanceof Map<?, ?>, type + ": свойство пришло не картой: " + p);
            Map<?, ?> m = (Map<?, ?>) p;
            out.put(String.valueOf(m.get("name")), String.valueOf(m.get("type")));
        }
        return out;
    }

    /** Однополевые индексы типа на поле — со строками schema:indexes, как у раннера. */
    private List<Map<String, Object>> indexesOn(String type, String field) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : ingest.queryPublic("SELECT FROM schema:indexes", Map.of())) {
            if (!type.equals(String.valueOf(r.get("typeName")))) continue;
            // schema:indexes отдаёт properties вложенным списком [["kind"]].
            List<String> names = new ArrayList<>();
            Object props = r.get("properties");
            if (props instanceof Iterable<?> it) {
                for (Object p : it) {
                    if (p instanceof Iterable<?> inner) for (Object x : inner) names.add(String.valueOf(x));
                    else names.add(String.valueOf(p));
                }
            }
            if (names.equals(List.of(field))) out.add(r);
        }
        return out;
    }
}
