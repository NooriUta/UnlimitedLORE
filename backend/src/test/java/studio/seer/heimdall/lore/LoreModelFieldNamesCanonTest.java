package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-10 · сторож имён полей модели (канон модели и схемы 1.18, слово владельца 25.11.2026:
 * «если это ломает канон — переименовать», «если мы не допривели в миграции поля в порядок, то лучше привести»).
 *
 * <p>Канон:
 * <ul>
 *   <li>имя свойства — snake_case;</li>
 *   <li>время — суффиксом: {@code <событие>_at} — момент, DATETIME; {@code <событие>_date} — календарная дата, DATE;
 *       префикс {@code date_*} запрещён;</li>
 *   <li>флаг — {@code is_*} / {@code has_*} (так названы все флаги схемы 1.18, кроме двух из карты перехода);</li>
 *   <li>момент создания один — {@code created_at}: прежние имена {@code date_created} и {@code created_date} в базе
 *       из модели не существуют (их переводил на лету ModelSchemaAdapter) и в модели не встречаются.</li>
 * </ul>
 *
 * <p>Нарушитель, у которого в базе есть данные, на месте не переименовывается: это неаддитивный шаг схемы
 * (ADR-LORE-062). Он записан в {@link #TRANSITION} — карта перехода model:1→2 с каноничным именем. Сторож следит,
 * чтобы список не протух: исправленное поле обязано из него уйти.
 */
class LoreModelFieldNamesCanonTest {

    /** Карта перехода model:1→2 — свойства с данными, нарушающие канон: свойство → каноничное имя и причина. */
    static final Map<String, String> TRANSITION = Map.ofEntries(
        Map.entry("KnowSprint.created_at", "created_at DATETIME (сейчас DATE) или created_date — момент создания хранится днём"),
        Map.entry("KnowUseCase.created_at", "created_at DATETIME (сейчас DATE) или created_date"),
        Map.entry("KnowPain.created_at", "created_at DATETIME (сейчас DATE) или created_date"),
        Map.entry("KnowGain.created_at", "created_at DATETIME (сейчас DATE) или created_date"),
        Map.entry("KnowJob.created_at", "created_at DATETIME (сейчас DATE) или created_date"),
        Map.entry("KnowRunbook.created_at", "created_at DATETIME (сейчас DATE) или created_date"),
        Map.entry("KnowUseCase.shipped_at", "shipped_date (DATE) — день поставки, не момент"),
        Map.entry("KnowSprint.no_release_required", "is_release_optional / has_no_release — флаг без is_/has_"),
        Map.entry("KnowSprint.unplanned_intentional", "is_unplanned_intentional — флаг без is_/has_"),
        Map.entry("KnowTask.bookkeeping", "is_bookkeeping — флаг без is_/has_ (параметр task_set bookkeeping)"),
        Map.entry("KnowADRHist.status_backfilled", "is_status_backfilled — флаг без is_/has_"),
        Map.entry("KnowDecisionHist.status_backfilled", "is_status_backfilled — флаг без is_/has_"),
        Map.entry("KnowSpecHist.status_backfilled", "is_status_backfilled — флаг без is_/has_"));

    /** Сомнительное — не ясно, нарушение ли (вопрос владельцу): свойство → почему под вопросом. */
    static final Map<String, String> DOUBT = Map.of(
        "KnowMilestone.date_display", "префикс date_, но это не время, а свободный текст срока («прогноз Q4 2026»)");

    static final Pattern SNAKE = Pattern.compile("^[a-z][a-z0-9]*(_[a-z0-9]+)*$");
    static final Pattern LEGACY_CREATED = Pattern.compile("(?<![\\w])(date_created|created_date)(?![\\w])");

    static JsonNode model() throws Exception {
        return new ObjectMapper().readTree(Path.of("src", "main", "resources", "lore-model", "lore-model.json").toFile());
    }

    static Map<String, Map<String, String>> schema() throws Exception {
        return LoreModelDateKindsMatchSchemaTest.schema();
    }

    /** Свойство поля модели в графе: псевдоним → поле записи → ключ (как LoreModelTypes.propertyOf, без схемы). */
    static String storageOf(JsonNode m, String type, JsonNode f) {
        JsonNode a = m.path("aliases").path(type).path(f.path("key").asText());
        if (a.isTextual()) return a.asText();
        if (f.path("write").path("field").isTextual()) return f.path("write").path("field").asText();
        return f.path("key").asText();
    }

    record Field(String type, String key, String kind, String storage, String vertex, String hist) {}

    static List<Field> fields(JsonNode m) {
        List<Field> out = new ArrayList<>();
        for (JsonNode t : m.path("types")) {
            String type = t.path("type").asText();
            JsonNode g = m.path("graph").path(type);
            for (JsonNode f : t.path("fields"))
                out.add(new Field(type, f.path("key").asText(), f.path("kind").asText(), storageOf(m, type, f),
                    g.path("vertex").asText(null), g.path("hist").asText(null)));
        }
        return out;
    }

    static String dbType(Map<String, Map<String, String>> s, Field f) {
        String v = f.vertex() == null ? null : s.getOrDefault(f.vertex(), Map.of()).get(f.storage());
        if (v == null && f.hist() != null) v = s.getOrDefault(f.hist(), Map.of()).get(f.storage());
        return v;
    }

    static String owner(Map<String, Map<String, String>> s, Field f) {
        if (f.vertex() != null && s.getOrDefault(f.vertex(), Map.of()).containsKey(f.storage())) return f.vertex();
        return f.hist();
    }

    // ── 1. прежние имена момента создания ──────────────────────────────────────────────────────────────

    @Test
    void modelHasNoLegacyCreationNames() throws Exception {
        String text = Files.readString(Path.of("src", "main", "resources", "lore-model", "lore-model.json"));
        List<String> hits = new ArrayList<>();
        var mt = LEGACY_CREATED.matcher(text);
        while (mt.find()) {
            int line = text.substring(0, mt.start()).split("\n", -1).length;
            hits.add(mt.group(1) + " @ строка " + line);
        }
        assertEquals(List.of(), hits, "в модели прежние имена момента создания — канон created_at");
    }

    @Test
    void adapterNoLongerRenamesCreationNames() {
        assertFalse(ModelSchemaAdapter.RENAMES.containsKey("date_created"), "код не пишет date_created — переходнику нечего переводить");
        assertFalse(ModelSchemaAdapter.RENAMES.containsKey("created_date"), "код не пишет created_date — переходнику нечего переводить");
    }

    // ── 2. поля-время модели ───────────────────────────────────────────────────────────────────────────

    @Test
    void timeFieldStorageHasCanonicalSuffix() throws Exception {
        List<String> bad = new ArrayList<>();
        for (Field f : fields(model())) {
            if (!"date".equals(f.kind())) continue;
            String p = f.storage();
            if (p.startsWith("date_") || !(p.endsWith("_at") || p.endsWith("_date")) || !SNAKE.matcher(p).matches())
                bad.add(f.type() + "." + f.key() + " → " + p);
        }
        assertEquals(List.of(), bad, "поле-время модели: свойство обязано оканчиваться на _at (DATETIME) или _date (DATE)");
    }

    @Test
    void suffixMatchesSchemaType() throws Exception {
        Map<String, Map<String, String>> s = schema();
        List<String> bad = new ArrayList<>();
        for (Field f : fields(model())) {
            if (!"date".equals(f.kind())) continue;
            String db = dbType(s, f);
            if (db == null) continue;
            String want = f.storage().endsWith("_at") ? "DATETIME" : f.storage().endsWith("_date") ? "DATE" : null;
            String id = owner(s, f) + "." + f.storage();
            if (want != null && !want.equals(db) && !TRANSITION.containsKey(id))
                bad.add(id + " (" + f.type() + "." + f.key() + "): " + db + ", по суффиксу нужно " + want);
        }
        assertEquals(List.of(), bad, "суффикс времени расходится с типом свойства в схеме 1.18");
    }

    @Test
    void timeSourcesHaveCanonicalNames() throws Exception {
        JsonNode m = model();
        List<String> bad = new ArrayList<>();
        m.path("time").fields().forEachRemaining(e -> {
            for (String side : List.of("created", "changed"))
                for (JsonNode src : e.getValue().path(side)) {
                    String p = src.path("source").asText();
                    if (p.startsWith("version.")) continue;
                    if (p.startsWith("date_") || !(p.endsWith("_at") || p.endsWith("_date")))
                        bad.add(e.getKey() + "." + side + " → " + p);
                }
        });
        assertEquals(List.of(), bad, "источник времени модели: _at или _date, без date_*");
    }

    // ── 3. флаги ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    void boolFieldsAreIsOrHas() throws Exception {
        Map<String, Map<String, String>> s = schema();
        List<String> bad = new ArrayList<>();
        for (Field f : fields(model())) {
            if (!"bool".equals(f.kind())) continue;
            String p = f.storage();
            String id = (owner(s, f) == null ? f.vertex() : owner(s, f)) + "." + p;
            if (!(p.startsWith("is_") || p.startsWith("has_")) && !TRANSITION.containsKey(id))
                bad.add(id + " (" + f.type() + "." + f.key() + ")");
        }
        assertEquals(List.of(), bad, "флаг модели: is_* / has_*");
    }

    // ── 4. схема 1.18 целиком ──────────────────────────────────────────────────────────────────────────

    @Test
    void schemaPropertiesFollowCanon() throws Exception {
        List<String> bad = new ArrayList<>();
        schema().forEach((vertex, props) -> props.forEach((p, db) -> {
            String id = vertex + "." + p;
            if (TRANSITION.containsKey(id) || DOUBT.containsKey(id)) return;
            if (!SNAKE.matcher(p).matches()) bad.add(id + ": не snake_case");
            else if (p.startsWith("date_")) bad.add(id + ": префикс date_");
            else if ("DATETIME".equals(db) && !p.endsWith("_at") && !p.equals("valid_from") && !p.equals("valid_to")
                     && !p.equals("status_known_from")) bad.add(id + ": DATETIME без _at");
            else if ("DATE".equals(db) && !p.endsWith("_date")) bad.add(id + ": DATE без _date");
            else if (p.endsWith("_at") && db != null && !"DATETIME".equals(db)) bad.add(id + ": _at, а тип " + db);
            else if (p.endsWith("_date") && db != null && !"DATE".equals(db)) bad.add(id + ": _date, а тип " + db);
            else if ("BOOLEAN".equals(db) && !(p.startsWith("is_") || p.startsWith("has_"))) bad.add(id + ": флаг без is_/has_");
        }));
        assertEquals(List.of(), bad, "свойство схемы 1.18 нарушает канон и не записано в карту перехода");
    }

    @Test
    void transitionMapIsNotStale() throws Exception {
        Map<String, Map<String, String>> s = schema();
        List<String> stale = new ArrayList<>();
        for (String id : TRANSITION.keySet()) {
            String[] vp = id.split("\\.", 2);
            String db = s.getOrDefault(vp[0], Map.of()).get(vp[1]);
            boolean violates = db == null
                || ("DATE".equals(db) && vp[1].endsWith("_at"))
                || ("BOOLEAN".equals(db) && !(vp[1].startsWith("is_") || vp[1].startsWith("has_")));
            if (!violates) stale.add(id);
        }
        assertEquals(List.of(), stale, "поле приведено к канону — убрать из карты перехода");
    }

    @Test
    void transitionMapHasData() {
        // Положительный контроль: карта не пуста — иначе «сторож зелёный» значил бы «ничего не проверено».
        assertTrue(TRANSITION.size() >= 9, "карта перехода model:1→2 записана");
        Map<String, String> byVertex = new HashMap<>();
        TRANSITION.forEach((k, v) -> byVertex.put(k.split("\\.")[0], v));
        assertTrue(byVertex.containsKey("KnowSprint"));
    }
}
