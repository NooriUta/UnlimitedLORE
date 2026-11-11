package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Модель для поверхностей UI — первый срез (ADR-LORE-048, черновик PROPOSED).
 *
 * <p>Что есть в этом срезе:
 * <ul>
 *   <li>статусные статьи по типам с {@code category} (ось D-2026-UXR-STATUS-AXIS,
 *       {@link LoreStatusCategory}) и {@code allow} (D-2026-LORE-MODEL-STATUS-ENTRIES);</li>
 *   <li>справочники внутри документа — kit не ходит за ними вторым запросом;</li>
 *   <li>версия внутри документа, а не только в ETag — у файлового источника
 *       заголовков нет (D-2026-LORE-MODEL-PLUGGABLE-SOURCE);</li>
 *   <li>честная неполнота: {@code partial} и {@code missing}.</li>
 * </ul>
 *
 * <p>{@code allow} — правило ТИПА: все статусы жизненного цикла, кроме текущего
 * ({@link LoreRecordPerms#lifecycle}). Графа переходов в LORE нет. Ограничения
 * конкретной записи (спринт с открытыми задачами нельзя закрыть) — в
 * {@code perms.status_next} ответа {@code /lore/record}. {@code allow: null} —
 * переходы для типа не заданы (неизвестно), а не «запрещено всё».
 *
 * <p><b>Контракт для потребителя</b> (сверено с kit-сессией 08.11):
 * <ul>
 *   <li>{@code statuses_known} — типы, чьи статусы описаны. Типа в этом списке нет —
 *       значит он <i>ещё не описан</i>, а не «у него нет статусов»; пока описаны
 *       не все типы, в {@code missing} стоит раздел {@code "statuses:*"}.</li>
 *   <li>Машиночитаемы только флаги статьи ({@code in_dictionary}, {@code in_lifecycle},
 *       {@code active}). {@code warnings} — текст для человека; разбирать его
 *       строками нельзя — формулировки меняются.</li>
 *   <li>Порядок — часть контракта: справочники по алфавиту {@code dict_type},
 *       статьи внутри — по {@code order}, затем по {@code code}; статусные статьи —
 *       в порядке жизненного цикла, затем статьи справочника вне цикла. По этому
 *       порядку строится меню выбора.</li>
 * </ul>
 *
 * <p>Чистая функция: вход — строки справочника, выход — документ. Без БД и сети.
 */
final class LoreModel {

    private LoreModel() {}

    /** Формат без имени LORE: словарь модели универсален, типы LORE — содержимое. */
    static final String FORMAT = "model/0";

    /** Тип записи → справочник его статусов. Порядок — порядок в документе. */
    static final Map<String, String> STATUS_DICTS = linked(
        "task", "task_status",
        "sprint", "sprint_status",
        "adr", "adr_status",
        "spec", "spec_status",
        "decision", "decision_status");

    /** Не перечни значений, а настройки приложения — в модель не едут. */
    static final Set<String> NOT_ENUM_DICTS = Set.of("app_setting");

    static Map<String, Object> build(List<Map<String, Object>> dictRows) {
        return build(dictRows, null);
    }

    /**
     * S4-MODEL-TYPES: со схемой графа (vertex type → свойства) в документ входит раздел
     * {@code types} ({@link LoreModelTypes}), и {@code missing} его больше не называет —
     * missing вычисляется из отсутствующих разделов, а не хранится списком.
     */
    static Map<String, Object> build(List<Map<String, Object>> dictRows, Map<String, List<String>> schema) {
        return build(dictRows, schema, Map.of());
    }

    /** declared — объявленные типы свойств схемы (vertex type → свойство → тип), см. LoreModelTypes. */
    static Map<String, Object> build(List<Map<String, Object>> dictRows, Map<String, List<String>> schema,
                                     Map<String, Map<String, String>> declared) {
        return build(dictRows, schema, declared, null);
    }

    /** MD-REQUIRED: mandatory — обязательные свойства схемы (block), см. LoreFieldRequirement; null — не читались. */
    static Map<String, Object> build(List<Map<String, Object>> dictRows, Map<String, List<String>> schema,
                                     Map<String, Map<String, String>> declared, Map<String, java.util.Set<String>> mandatory) {
        List<Map<String, Object>> rows = dictRows == null ? List.of() : dictRows;
        List<String> warnings = new ArrayList<>();

        Map<String, List<Map<String, Object>>> byType = new TreeMap<>();
        for (Map<String, Object> r : rows) {
            String dt = str(r.get("dict_type"));
            String code = str(r.get("code"));
            if (dt.isEmpty() || code.isEmpty()) continue;
            byType.computeIfAbsent(dt, k -> new ArrayList<>()).add(r);
        }
        byType.values().forEach(l -> l.sort(ORDER));

        Map<String, Object> dictionaries = new LinkedHashMap<>();
        for (Map.Entry<String, List<Map<String, Object>>> e : byType.entrySet()) {
            if (NOT_ENUM_DICTS.contains(e.getKey())) continue;
            List<Map<String, Object>> items = new ArrayList<>();
            for (Map<String, Object> r : e.getValue()) items.add(dictItem(r));
            dictionaries.put(e.getKey(), items);
        }

        Map<String, Object> statuses = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : STATUS_DICTS.entrySet()) {
            statuses.put(e.getKey(), statusBlock(e.getKey(), e.getValue(),
                byType.getOrDefault(e.getValue(), List.of()), warnings));
        }

        // Хеш версии считается по content, в котором format уже есть; в документ format
        // кладётся первым ради читаемости — это не второе значение, дублирования в хеше нет.
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("format", FORMAT);
        content.put("partial", true);
        List<String> missing = new ArrayList<>();
        if (schema == null) missing.add("types");
        // surfaces отдаётся частично: пока только passport (порядок разделов, LorePassportSurface).
        missing.add("surfaces:list");
        missing.add("statuses:*");
        content.put("missing", missing);
        content.put("statuses_known", List.copyOf(STATUS_DICTS.keySet()));
        content.put("statuses", statuses);
        if (schema != null) content.put("types", LoreModelTypes.build(schema, declared, mandatory));
        Map<String, Object> surfaces = new LinkedHashMap<>();
        surfaces.put("partial", true);
        surfaces.put("passport", LorePassportSurface.build());
        content.put("surfaces", surfaces);
        content.put("palettes", paletteBlock(byType.getOrDefault("palette", List.of()), warnings));
        content.put("dictionaries", dictionaries);
        content.put("warnings", warnings);

        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("format", FORMAT);
        doc.put("version", version(content));
        content.forEach((k, v) -> { if (!"format".equals(k)) doc.put(k, v); });
        return doc;
    }

    /**
     * kit 10.11 (K-14): палитра — прикладной словарь, её держит сервер, а не kit. Коды и
     * умолчание — из белого списка настройки {@code palette} ({@link LoreMePrefs#SETTINGS}):
     * один источник, иначе модель предложила бы палитру, которую сервер не даст сохранить.
     * Подписи — из справочника {@code palette}; кода без статьи не прячем: подпись = код,
     * {@code in_dictionary:false} и строка в warnings.
     */
    private static Map<String, Object> paletteBlock(List<Map<String, Object>> dictRows, List<String> warnings) {
        LoreMePrefs.SettingSpec spec = LoreMePrefs.SETTINGS.get("palette");
        Map<String, Map<String, Object>> byCode = new LinkedHashMap<>();
        for (Map<String, Object> r : dictRows) byCode.putIfAbsent(str(r.get("code")), r);
        List<Map<String, Object>> entries = new ArrayList<>();
        int order = 0;
        for (String code : spec.values()) {
            Map<String, Object> d = byCode.get(code);
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("code", code);
            String title = d == null ? "" : str(d.get("label_ru"));
            e.put("title", title.isEmpty() ? code : title);
            e.put("title_en", d == null ? null : nullIfEmpty(d.get("label_en")));
            e.put("order", d != null && d.get("sort_order") != null ? d.get("sort_order") : (order + 1) * 10);
            e.put("in_dictionary", d != null);
            entries.add(e);
            if (d == null)
                warnings.add("palette: палитра «" + code + "» без статьи в справочнике — подпись = код");
            order++;
        }
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("source", "settings:palette");
        block.put("default", spec.def());
        block.put("entries", entries);
        return block;
    }

    private static Map<String, Object> statusBlock(String type, String dictType,
                                                   List<Map<String, Object>> dictRows, List<String> warnings) {
        List<String> specCodes = null;
        if ("spec".equals(type)) {
            specCodes = new ArrayList<>();
            for (Map<String, Object> r : dictRows) if (active(r)) specCodes.add(str(r.get("code")));
        }
        List<String> cycle = LoreRecordPerms.lifecycle(type, specCodes);
        boolean cycleKnown = !cycle.isEmpty();

        // Справочник сопоставляется с циклом без учёта регистра (у ADR в справочнике
        // PROPOSED/ACCEPTED, в цикле proposed/accepted — ADR-LORE-047 «три набора»),
        // но расхождение регистра не прячется: оно уходит в warnings.
        Map<String, Map<String, Object>> dictByLower = new LinkedHashMap<>();
        for (Map<String, Object> r : dictRows) dictByLower.putIfAbsent(str(r.get("code")).toLowerCase(Locale.ROOT), r);

        List<Map<String, Object>> entries = new ArrayList<>();
        for (String code : cycle) {
            Map<String, Object> d = dictByLower.remove(code.toLowerCase(Locale.ROOT));
            if (d == null) {
                warnings.add(dictType + ": статус «" + code + "» есть в жизненном цикле " + type
                    + ", но его нет в справочнике — подпись = код, иконки и цвета нет");
            } else if (!code.equals(str(d.get("code")))) {
                warnings.add(dictType + ": код справочника «" + str(d.get("code")) + "» сопоставлен статусу цикла «"
                    + code + "» без учёта регистра — свести к одному написанию");
            }
            entries.add(statusEntry(type, code, d, true, cycleKnown ? without(cycle, code) : null));
            if (d != null) warnIfUndressed(dictType, code, d, warnings);
        }
        for (Map<String, Object> d : dictByLower.values()) {
            String code = str(d.get("code"));
            if (cycleKnown) {
                warnings.add(dictType + ": статус «" + code + "» есть в справочнике, но не входит в жизненный цикл "
                    + type + " — перейти в него нельзя");
            }
            entries.add(statusEntry(type, code, d, !cycleKnown, cycleKnown ? List.of() : null));
            if (!cycleKnown && active(d)) warnIfUndressed(dictType, code, d, warnings);
        }

        Map<String, Object> block = new LinkedHashMap<>();
        block.put("dict", dictType);
        block.put("allow_scope", "type");
        block.put("lifecycle_known", cycleKnown);
        block.put("entries", entries);
        return block;
    }

    /**
     * kit 09.11 (S4-STATUS-AXIS-CONFIG): иконка и цвет живого статуса — предметное знание
     * сервера, клиент их не выдумывает. Дыра в справочнике называется словами, а не
     * отдаётся молчаливым null, иначе клиент снова заводит свою таблицу «код → иконка».
     */
    private static void warnIfUndressed(String dictType, String code, Map<String, Object> d, List<String> warnings) {
        if (nullIfEmpty(d.get("icon")) == null)
            warnings.add(dictType + ": статус «" + code + "» без иконки — задать в справочнике");
        if (nullIfEmpty(d.get("color")) == null)
            warnings.add(dictType + ": статус «" + code + "» без цвета — задать в справочнике");
    }

    private static Map<String, Object> statusEntry(String type, String code, Map<String, Object> d,
                                                   boolean inLifecycle, List<String> allow) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("code", code);
        String title = d == null ? "" : str(d.get("label_ru"));
        e.put("title", title.isEmpty() ? code : title);
        e.put("title_en", d == null ? null : nullIfEmpty(d.get("label_en")));
        e.put("icon", d == null ? null : nullIfEmpty(d.get("icon")));
        e.put("color", d == null ? null : nullIfEmpty(d.get("color")));
        e.put("order", d == null ? null : d.get("sort_order"));
        e.put("category", LoreStatusCategory.of(type, code));
        e.put("allow", allow);
        e.put("in_dictionary", d != null);
        e.put("in_lifecycle", inLifecycle);
        if (d != null) e.put("active", active(d));
        return e;
    }

    private static Map<String, Object> dictItem(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", str(r.get("code")));
        String title = str(r.get("label_ru"));
        m.put("title", title.isEmpty() ? str(r.get("code")) : title);
        m.put("title_en", nullIfEmpty(r.get("label_en")));
        m.put("icon", nullIfEmpty(r.get("icon")));
        m.put("color", nullIfEmpty(r.get("color")));
        m.put("order", r.get("sort_order"));
        m.put("active", active(r));
        return m;
    }

    /** Версия = отпечаток содержимого: один и тот же вход — одна и та же версия. */
    static String version(Map<String, Object> content) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256")
                .digest(new JsonObject(content).encode().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(h).substring(0, 16);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 недоступен", e);
        }
    }

    private static final Comparator<Map<String, Object>> ORDER = Comparator
        .comparing((Map<String, Object> r) -> r.get("sort_order") instanceof Number n ? n.doubleValue() : Double.MAX_VALUE)
        .thenComparing(r -> str(r.get("code")));

    private static boolean active(Map<String, Object> r) {
        Object v = r.get("is_active");
        return v == null || Boolean.TRUE.equals(v) || "true".equalsIgnoreCase(String.valueOf(v));
    }

    private static List<String> without(List<String> list, String code) {
        List<String> out = new ArrayList<>(list);
        out.remove(code);
        return out;
    }

    private static Object nullIfEmpty(Object v) {
        return v == null || String.valueOf(v).isBlank() ? null : v;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v).strip();
    }

    private static Map<String, String> linked(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }
}
