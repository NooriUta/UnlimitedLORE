package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 · сторож «вид поля в модели = тип свойства в схеме из модели».
 *
 * <p>Перенос 1.18 (MIG-01) хранит даты и моменты настоящими типами: DATE и DATETIME (решение владелицы
 * 15.11.2026: «настоящий тип», «унификация через миграцию базы»). Модель описывает поле-дату видом
 * {@code date} и точностью {@code precision}: {@code date} — день без времени и зоны, {@code datetime} —
 * момент с зоной (UTC). Сторож сверяет их со снимком схемы, собранной переносом
 * ({@code model-v2-schema/schema-types.json}): поле-дата модели → свойство в графе тем же сопоставлением,
 * что у паспорта ({@link LoreModelTypes#propertyOf}), с переименованиями новой схемы
 * ({@link ModelSchemaAdapter#RENAMES}: date_created / created_date → created_at).
 *
 * <ul>
 *   <li>DATE ⇔ precision date, DATETIME ⇔ precision datetime;</li>
 *   <li>поле-дата, которое в схеме осталось строкой, обязано нести формат — сейчас таких нет;</li>
 *   <li>обратное: поле модели любого вида, чьё свойство в схеме DATE/DATETIME, обязано быть видом date;</li>
 *   <li>поле-дата без свойства в схеме — только из явного списка с причиной.</li>
 * </ul>
 */
class LoreModelDateKindsMatchSchemaTest {

    /** Поля-даты модели, у которых в схеме переноса нет свойства, — с причиной. Новое такое поле — ошибка. */
    static final Map<String, String> ABSENT = Map.of(
        "tech.checked_at", "у KnowSpec поля проверки технологии нет: в снимке прода нет данных, перенос его не заводит",
        "quality_gate.date", "QualityGate без даты заведения: тип QG ведёт своя сессия (исключение из заморозки схемы, ADR-LORE-053)",
        "quality_gate.retired_at", "QualityGate без даты снятия: то же исключение QG",
        // MD-05: тип pr заведён в graph после снятия снимка (19.11): KnowPR в снимке нет. В схеме установщика
        // KnowPR.merged_at — DATETIME (scripts/model-migration/schema/all-objects.json), модель — precision datetime.
        "pr.merged_at", "KnowPR нет в снимке схемы (тип pr в graph с MD-05); у установщика merged_at — DATETIME",
        // AP-MACHINE-PASSPORT: тип machine заведён в graph после снятия снимка; KnowMachine (V79) — свойства STRING ISO-время.
        "machine.last_seen_at", "KnowMachine нет в снимке схемы (тип machine с AP-MACHINE-PASSPORT); V79 — STRING ISO-время",
        "machine.first_seen_at", "KnowMachine нет в снимке схемы (тип machine с AP-MACHINE-PASSPORT); V79 — STRING ISO-время");

    /**
     * Поля, у которых вид в модели и тип в схеме переноса расходятся сознательно, — с причиной.
     * Исправляется установщиком, не моделью: тогда поле уходит из списка (сторож напомнит).
     */
    static final Map<String, String> SCHEMA_DIFFERS = Map.of();
    // Было: feature.shipped_at (DATETIME по окончанию _at). Владелица 19.11.2026 «даты переводи»: shipped_at — DATE,
    // поправлено правилом установщика (propose-map-all.mjs, DAY_AT) — модель и схема сошлись.

    static Map<String, Map<String, String>> schema() throws Exception {
        try (InputStream in = LoreModelDateKindsMatchSchemaTest.class.getResourceAsStream("/model-v2-schema/schema-types.json")) {
            assertNotNull(in, "снимок схемы model-v2-schema/schema-types.json на месте");
            JsonNode types = new ObjectMapper().readTree(in).get("types");
            Map<String, Map<String, String>> out = new TreeMap<>();
            types.fields().forEachRemaining(e -> {
                Map<String, String> props = new LinkedHashMap<>();
                if (e.getValue() != null && e.getValue().isObject())
                    e.getValue().fields().forEachRemaining(p -> props.put(p.getKey(), p.getValue().asText()));
                out.put(e.getKey(), props);
            });
            return out;
        }
    }

    /** Свойства вершины и версии с прежними именами для новых (сервер читает старые имена через переходник). */
    static Map<String, String> propsOf(Map<String, Map<String, String>> schema, LoreModelTypes.Graph g) {
        Map<String, String> p = new HashMap<>(schema.getOrDefault(g.vertex(), Map.of()));
        if (g.hist() != null) schema.getOrDefault(g.hist(), Map.of()).forEach(p::putIfAbsent);
        ModelSchemaAdapter.RENAMES.forEach((old, now) -> { if (p.containsKey(now)) p.putIfAbsent(old, p.get(now)); });
        return p;
    }

    record Hit(String id, String kind, String precision, String property, String dbType) {}

    static List<Hit> hits() throws Exception {
        Map<String, Map<String, String>> schema = schema();
        List<Hit> out = new ArrayList<>();
        for (Map.Entry<String, LoreModelTypes.Graph> e : LoreModelTypes.GRAPH.entrySet()) {
            String t = e.getKey();
            LoreRecordRegistry.TypeDef def = LoreRecordRegistry.get(t);
            if (def == null) def = LoreRecordRegistry.childDef(t);
            if (def == null) continue;
            Map<String, String> props = propsOf(schema, e.getValue());
            for (LoreRecordRegistry.Field f : def.fields()) {
                Map<String, Object> fm = new HashMap<>();
                fm.put("key", f.key());
                if (f.write() != null && f.write().field() != null) fm.put("write", Map.of("field", f.write().field()));
                String prop = LoreModelTypes.propertyOf(t, fm, props.keySet());
                out.add(new Hit(t + "." + f.key(), f.kind(), LoreModelTypes.PRECISION.get(t + "." + f.key()),
                    prop, prop == null ? null : props.get(prop)));
            }
        }
        return out;
    }

    @Test
    void dateFieldPrecisionMatchesSchemaType() throws Exception {
        List<String> bad = new ArrayList<>();
        for (Hit h : hits()) {
            if (!"date".equals(h.kind()) || h.dbType() == null) continue;
            String want = switch (h.dbType()) {
                case "DATE" -> "date";
                case "DATETIME" -> "datetime";
                default -> null;
            };
            if (want == null) bad.add(h.id() + ": в схеме " + h.property() + " " + h.dbType() + " — поле-дата строкой без формата");
            else if (want.equals(h.precision()) && SCHEMA_DIFFERS.containsKey(h.id()))
                bad.add(h.id() + ": модель и схема сошлись — убрать из SCHEMA_DIFFERS");
            else if (!want.equals(h.precision()) && !SCHEMA_DIFFERS.containsKey(h.id()))
                bad.add(h.id() + ": модель precision=" + h.precision() + ", схема " + h.property() + " " + h.dbType() + " → нужно " + want);
        }
        assertTrue(bad.isEmpty(), "вид поля-даты расходится со схемой из модели:\n  " + String.join("\n  ", bad));
    }

    @Test
    void schemaDatePropertyIsModelDateField() throws Exception {
        List<String> bad = new ArrayList<>();
        for (Hit h : hits())
            if (("DATE".equals(h.dbType()) || "DATETIME".equals(h.dbType())) && !"date".equals(h.kind()))
                bad.add(h.id() + ": свойство " + h.property() + " " + h.dbType() + ", а вид поля в модели — " + h.kind());
        assertTrue(bad.isEmpty(), "дата в схеме, но не дата в модели:\n  " + String.join("\n  ", bad));
    }

    @Test
    void dateFieldWithoutPropertyIsListedWithReason() throws Exception {
        List<String> absent = new ArrayList<>();
        for (Hit h : hits()) if ("date".equals(h.kind()) && h.property() == null) absent.add(h.id());
        List<String> unlisted = absent.stream().filter(id -> !ABSENT.containsKey(id)).toList();
        List<String> stale = ABSENT.keySet().stream().filter(id -> !absent.contains(id)).sorted().toList();
        assertTrue(unlisted.isEmpty(), "поле-дата без свойства в схеме переноса и без причины: " + unlisted);
        assertTrue(stale.isEmpty(), "у поля появилось свойство в схеме — убрать из списка ABSENT: " + stale);
    }

    /**
     * Снимок не отстаёт от схемы установщика: свойство, которое есть и в снимке, и в
     * {@code scripts/model-migration/schema/*.json}, — одного типа. Правило установщика поменяли, а снимок нет —
     * сторож выше сверял бы модель с прошлой схемой.
     */
    @Test
    void snapshotAgreesWithInstallerSchema() throws Exception {
        Map<String, Map<String, String>> snap = schema();
        ObjectMapper m = new ObjectMapper();
        List<String> bad = new ArrayList<>();
        int compared = 0;
        for (String file : List.of("sprint-phase-task.json", "all-objects.json")) {
            JsonNode types = m.readTree(java.nio.file.Path.of("..", "scripts", "model-migration", "schema", file).toFile()).get("types");
            for (var t = types.fields(); t.hasNext(); ) {
                var e = t.next();
                Map<String, String> props = snap.get(e.getKey());
                if (props == null) continue;
                for (var f = e.getValue().get("fields").fields(); f.hasNext(); ) {
                    var p = f.next();
                    String had = props.get(p.getKey());
                    if (had == null) continue;
                    compared++;
                    String now = p.getValue().get("db_type").asText();
                    if (!now.equals(had)) bad.add(e.getKey() + "." + p.getKey() + ": снимок " + had + ", установщик " + now);
                }
            }
        }
        assertTrue(compared > 300, "сверено свойств: " + compared);
        assertTrue(bad.isEmpty(), "снимок схемы отстал от установщика — переснять:\n  " + String.join("\n  ", bad));
    }

    @Test
    void everyDateFieldHasPrecision() throws Exception {
        List<String> none = hits().stream().filter(h -> "date".equals(h.kind()) && h.precision() == null).map(Hit::id).toList();
        assertTrue(none.isEmpty(), "у поля-даты не названа точность (раздел precision модели): " + none);
    }
}
