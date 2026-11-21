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
                if (!LoreModelConsistency.compatible(String.valueOf(f.get("kind")), Boolean.TRUE.equals(f.get("multi")), pt) && !KIND_EXEMPT.containsKey(id))
                    drift.add(id + " (" + f.get("kind") + " ← " + pt + ")");
            }
        assertEquals(List.of(), drift, "вид поля модели противоречит типу свойства схемы");
        for (String id : KIND_EXEMPT.keySet()) assertTrue(id.contains("."), "исключение без типа: " + id);
    }

    static boolean compatible(String kind, String schemaType) {
        return LoreModelConsistency.compatible(kind, schemaType);
    }

    /**
     * SPRINT_LORE_MODEL_AS_CONFIG/MC-08: флаги — вид bool, а не text; исключений вида не осталось.
     * Клиент v2 неизвестный вид читает как text (liveRecord.kindOf) — до kit-части флаг показывается как прежде.
     */
    @Test
    @SuppressWarnings("unchecked")
    void flagsAreBoolAndNoKindExemptionsLeft() {
        assertEquals(Map.of(), LoreModelConsistency.KIND_EXEMPT, "исключения вида закрыты видом bool");
        Map<String, Object> types = (Map<String, Object>) LoreModelGoldenTest.modelDoc().get("types");
        for (String id : List.of("sprint.no_release", "product.is_active")) {
            String[] p = id.split("\\.");
            Map<String, Object> f = ((List<Map<String, Object>>) ((Map<String, Object>) types.get(p[0])).get("fields"))
                .stream().filter(x -> p[1].equals(x.get("key"))).findFirst().orElseThrow();
            assertEquals("bool", f.get("kind"), id);
        }
        assertTrue(compatible("bool", "BOOLEAN"));
        assertFalse(compatible("bool", "STRING"));
    }

    /**
     * SPRINT_LORE_PRODUCT_BACKLOG/MINI-04-LIST-ROWS-CATEGORY-PROJECTS: срез, обещающий клиенту
     * {@code projects} всегда ({@link LoreProjectsField#GUARANTEED}), читает ось проекта в SQL — иначе
     * «всегда массив» значит «всегда пустой». И обратно: срез со статусом и осью проекта в SQL
     * в перечне есть — новый срез-список проектных записей не забыт.
     */
    @Test
    void projectListSlicesCarryTheProjectAxis() {
        List<String> bad = new ArrayList<>();
        for (String slice : LoreProjectsField.GUARANTEED) {
            LoreSlices.SliceDef def = LoreSlices.get(slice);
            if (def == null) bad.add(slice + ": среза нет");
            else if (!LoreProjectsField.readsProjectAxis(def.baseSql())) bad.add(slice + ": оси проекта в SQL нет");
        }
        for (String slice : LoreStatusCategory.SLICE_STATUS.keySet()) {
            LoreSlices.SliceDef def = LoreSlices.get(slice);
            if (def != null && LoreProjectsField.readsProjectAxis(def.baseSql())
                    && !LoreProjectsField.GUARANTEED.contains(slice))
                bad.add(slice + ": статус и ось проекта есть, а в GUARANTEED нет");
        }
        assertEquals(List.of(), bad, "срез-список проектных записей без гарантированного projects (MINI-04)");
    }

    /**
     * SPRINT_LORE_MODEL_AS_CONFIG/MC-09: контракт списка ({@code surfaces.list}) не обещает того, чего срез не
     * отдаёт. Срез есть; id_key, title_key и group_keys — колонки его внешнего SELECT (иначе клиент строит
     * пустые строки молча); доступ назван честно — {@code requires_role} ровно тогда, когда срез под гейтом
     * роли ({@link LoreSlices#ADMIN_ONLY}, иначе 403), {@code project_scoped} — ровно тогда, когда срез режется
     * проектным скоупом ({@link LoreSlices#PROJECT_SCOPED}: без проектов — 403 SCOPE_EMPTY).
     */
    @Test
    void listContractKeysAreColumnsOfItsSlice() {
        Map<String, LoreModelList.Spec> list = LoreModelFile.content().listSurface();
        assertFalse(list.isEmpty(), "положительный контроль: контракт списка заполнен");
        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, LoreModelList.Spec> e : list.entrySet()) {
            String t = e.getKey();
            LoreModelList.Spec s = e.getValue();
            LoreSlices.SliceDef def = LoreSlices.get(s.slice());
            if (def == null) { bad.add(t + ": среза " + s.slice() + " нет"); continue; }
            Set<String> cols = SliceOutputKeys.of(def.baseSql());
            List<String> need = new ArrayList<>(List.of(s.id_key(), s.title_key()));
            need.addAll(s.group_keys());
            for (String k : need) if (!cols.contains(k)) bad.add(t + ": " + s.slice() + " не отдаёт колонку " + k + " (есть " + cols + ")");
            if (!def.required().isEmpty()) bad.add(t + ": " + s.slice() + " требует параметры " + def.required() + " — список без них не построить");
            String role = LoreSlices.ADMIN_ONLY.contains(s.slice()) ? "admin" : null;
            if (!java.util.Objects.equals(role, s.requires_role())) bad.add(t + ": requires_role " + s.requires_role() + ", а гейт среза — " + role);
            boolean scoped = LoreSlices.PROJECT_SCOPED.containsKey(s.slice());
            if (scoped != s.project_scoped()) bad.add(t + ": project_scoped " + s.project_scoped() + ", а скоуп среза — " + scoped);
        }
        assertEquals(List.of(), bad, "контракт списка расходится со срезом (MC-09)");
        // Положительный контроль: колонки, которой у среза нет, проверка не находит (title_key «name» у людей — была бы пустая строка).
        assertFalse(SliceOutputKeys.of(LoreSlices.get("users").baseSql()).contains("status_raw"));
        assertFalse(SliceOutputKeys.of(LoreSlices.get("users").baseSql()).contains("name"));
        assertTrue(SliceOutputKeys.of(LoreSlices.get("users").baseSql()).contains("display_name"));
    }

    /** Колонки статуса строки среза: есть такая — у типа есть статус, и контракт обязан её назвать. */
    static final Set<String> STATUS_COLUMNS = Set.of("status", "status_raw");

    /**
     * MC-09, владелица 21.11.2026 («закрытые задачи тоже отдай…»): {@code status_key} — колонка каждого среза
     * типа (основного и всех сегментов) и назван у КАЖДОГО типа, в срезе которого статус есть; сегменты —
     * срезы есть, без параметров, с id_key/title_key/status_key, тем же доступом, ровно один по умолчанию.
     */
    @Test
    void listContractStatusAndSegmentsMatchSlices() {
        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, LoreModelList.Spec> e : LoreModelFile.content().listSurface().entrySet()) {
            String t = e.getKey();
            LoreModelList.Spec s = e.getValue();
            LoreSlices.SliceDef main = LoreSlices.get(s.slice());
            if (main == null) continue; // причина уже в listContractKeysAreColumnsOfItsSlice
            Set<String> mainCols = SliceOutputKeys.of(main.baseSql());
            boolean hasStatus = mainCols.stream().anyMatch(STATUS_COLUMNS::contains);
            if (hasStatus && s.status_key() == null) bad.add(t + ": в срезе " + s.slice() + " есть статус, а status_key не назван");
            if (s.status_key() != null && !mainCols.contains(s.status_key())) bad.add(t + ": status_key " + s.status_key() + " — не колонка " + s.slice());
            int defaults = 0;
            for (LoreModelList.Segment g : LoreModelList.segments(s)) {
                if (g.isDefault()) {
                    defaults++;
                    if (!g.slice().equals(s.slice())) bad.add(t + ": slice " + s.slice() + " ≠ срезу сегмента по умолчанию " + g.slice());
                }
                LoreSlices.SliceDef def = LoreSlices.get(g.slice());
                if (def == null) { bad.add(t + "." + g.key() + ": среза " + g.slice() + " нет"); continue; }
                if (!def.required().isEmpty()) bad.add(t + "." + g.key() + ": " + g.slice() + " требует параметры " + def.required());
                Set<String> cols = SliceOutputKeys.of(def.baseSql());
                for (String k : new String[] {s.id_key(), s.title_key(), s.status_key()})
                    if (k != null && !cols.contains(k)) bad.add(t + "." + g.key() + ": " + g.slice() + " не отдаёт колонку " + k);
                if (LoreSlices.PROJECT_SCOPED.containsKey(g.slice()) != s.project_scoped())
                    bad.add(t + "." + g.key() + ": скоуп " + g.slice() + " не совпадает с project_scoped");
                if (LoreSlices.ADMIN_ONLY.contains(g.slice()) != (s.requires_role() != null))
                    bad.add(t + "." + g.key() + ": гейт роли " + g.slice() + " не совпадает с requires_role");
            }
            if (!LoreModelList.segments(s).isEmpty() && defaults != 1) bad.add(t + ": сегментов по умолчанию " + defaults + ", нужен ровно один");
        }
        assertEquals(List.of(), bad, "статус и сегменты контракта списка расходятся со срезами (MC-09)");
        // Положительный контроль: у задач в срезе статус есть — правило «статус есть, а status_key нет» срабатывает на нём.
        assertTrue(SliceOutputKeys.of(LoreSlices.get("open_tasks").baseSql()).contains("status_raw"));
        assertTrue(SliceOutputKeys.of(LoreSlices.get("closed_tasks").baseSql()).contains("task_uid"));
    }

    static JsonObject listFacets() throws IOException {
        Path p = Path.of("..", "shared", "model", "list-facets.json");
        return new JsonObject(Files.readString(p, StandardCharsets.UTF_8));
    }
}
