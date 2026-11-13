package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-03 — сторож «модель ↔ схема ↔ срезы»: модель не обещает того,
 * чего сервер не отдаёт. Один класс дефекта приёмки 13.11:
 * <ul>
 *   <li>SPRINT_UXR_POLISH_UAT_1113/PU-02 — связь объявлена вкладкой паспорта, а читать её нечем
 *       (среза нет) → «Часть сведений не загрузилась» на каждой записи;</li>
 *   <li>SPRINT_UXR_POLISH_UAT_1113/PU-01 — экран просит счётчики по оси, которой нет в его срезе
 *       → 400 BAD_PARAMS на весь запрос /facets.</li>
 * </ul>
 * Исключение — только явной строкой в {@link #KIND_EXEMPT} с причиной.
 */
class ModelServerConsistencyGuardTest {

    /** Вкладка связи паспорта обязана читаться: из строки основного среза или отдельным чтением. */
    @Test
    void everyLinkTabRelationHasAReader() {
        List<String> unread = new ArrayList<>();
        for (String type : LoreRecordRegistry.TYPES)
            for (String key : new java.util.TreeSet<>(LoreRecordValues.UNREAD_LINK_TABS.getOrDefault(type, Set.of())))
                unread.add(type + "." + key);
        assertEquals(List.of(), unread,
            "связи объявлены вкладками паспорта, но читать их нечем — паспорт навсегда «не загрузился» (PU-02)");
    }

    /** Каждая ось из shared/model/list-facets.json — колонка своего среза (то же правило, что у /facets). */
    @Test
    void everyListFacetAxisIsAColumnOfItsSlice() throws IOException {
        JsonObject slices = listFacets().getJsonObject("slices");
        List<String> bad = new ArrayList<>();
        for (String slice : slices.fieldNames()) {
            assertNotNull(LoreSlices.get(slice), "list-facets.json: среза " + slice + " нет");
            for (String axis : slices.getJsonObject(slice).fieldNames()) {
                try {
                    LoreListFacets.axes(slice, axis);
                } catch (IllegalArgumentException e) {
                    bad.add(slice + "." + axis);
                }
            }
        }
        assertEquals(List.of(), bad, "экран просит счётчики по оси, которой в срезе нет — /facets ответит 400 BAD_PARAMS (PU-01)");
    }

    /**
     * Вид поля модели не противоречит объявленному типу свойства схемы. Ключ — тип.поле, значение —
     * причина, по которой расхождение принято (исключение видно, а не спрятано).
     */
    /** Одно правило с сервером: перечень исключений — LoreModelConsistency.KIND_EXEMPT (MC-05). */
    static final Map<String, String> KIND_EXEMPT = LoreModelConsistency.KIND_EXEMPT;

    @Test
    @SuppressWarnings("unchecked")
    void fieldKindDoesNotDriftFromSchemaType() {
        Map<String, Object> types = (Map<String, Object>) LoreModelGoldenTest.modelDoc().get("types");
        List<String> drift = new ArrayList<>();
        for (Map.Entry<String, Object> t : types.entrySet())
            for (Map<String, Object> f : (List<Map<String, Object>>) ((Map<String, Object>) t.getValue()).get("fields")) {
                String pt = (String) f.get("property_type");
                if (pt == null) continue;
                String id = t.getKey() + "." + f.get("key");
                if (!compatible(String.valueOf(f.get("kind")), pt) && !KIND_EXEMPT.containsKey(id))
                    drift.add(id + " (" + f.get("kind") + " ← " + pt + ")");
            }
        assertEquals(List.of(), drift, "вид поля модели противоречит типу свойства схемы");
        for (String id : KIND_EXEMPT.keySet()) assertTrue(id.contains("."), "исключение без типа: " + id);
    }

    static boolean compatible(String kind, String schemaType) {
        return LoreModelConsistency.compatible(kind, schemaType);
    }

    static JsonObject listFacets() throws IOException {
        Path p = Path.of("..", "shared", "model", "list-facets.json");
        return new JsonObject(Files.readString(p, StandardCharsets.UTF_8));
    }
}
