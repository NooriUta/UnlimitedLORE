package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 · сверка значения записи с видом поля из модели.
 *
 * <p>Ответ владелицы 15.11.2026: проверка типа при записи — «предупреждение». Запись НЕ отклоняется:
 * значение не того вида возвращается в ответе ({@code warnings[]}, форма как у
 * {@code WORK_CLASS_MISSING}) и пишется в журнал ({@link LoreWriteKindsFilter}).
 *
 * <p>Какие поля у пути записи — решает модель, а не таблица в коде:
 * <ul>
 *   <li>тип записи — первый сегмент пути после {@code /lore/} ({@code /lore/task/edit} → task), если такой тип
 *       есть в модели, и типы полей, у которых этот путь объявлен в {@code write.endpoint};</li>
 *   <li>имя поля в теле — то же сопоставление, что у паспорта: синоним из {@code aliases}, {@code write.field},
 *       ключ поля;</li>
 *   <li>вид — {@code kind} поля; у даты — точность из раздела {@code precision}: {@code date} — ГГГГ-ММ-ДД,
 *       {@code datetime} — момент ISO-8601 (без зоны — UTC; дата без времени — полночь UTC: то же правило,
 *       что у переноса, {@code scripts/model-migration/apply-map.mjs toDateTime}).</li>
 * </ul>
 * Перечисления, ссылки и связи здесь не проверяются: у них свои проверки (справочник, существование цели).
 * Имя, которое у пути ведёт к полям разного вида, не проверяется — вид неоднозначен.
 */
final class LoreWriteKinds {

    private LoreWriteKinds() {}

    static final String CODE = "FIELD_KIND_MISMATCH";

    /** Виды, которые сверяются. */
    private static final Set<String> CHECKED = Set.of("number", "bool", "date", "text", "md");

    record Expect(String type, String key, String kind, String precision) {}

    private static final Map<String, Map<String, Expect>> CACHE = new java.util.concurrent.ConcurrentHashMap<>();

    /** Путь без ведущей косой черты и без хвоста — одинаков для «/lore/x» и «lore/x/». */
    static String norm(String path) {
        if (path == null) return "";
        String p = path.startsWith("/") ? path : "/" + path;
        while (p.length() > 1 && p.endsWith("/")) p = p.substring(0, p.length() - 1);
        return p;
    }

    /** Поля тела, которые знает модель у этого пути: имя в теле → ожидаемый вид. */
    static Map<String, Expect> fieldsFor(String path) {
        String p = norm(path);
        return CACHE.computeIfAbsent(p, LoreWriteKinds::build);
    }

    private static LoreRecordRegistry.TypeDef def(String t) {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(t);
        return d != null ? d : LoreRecordRegistry.childDef(t);
    }

    private static Map<String, Expect> build(String p) {
        if (!p.startsWith("/lore/")) return Map.of();
        String seg = p.substring("/lore/".length()).split("/")[0];
        Map<String, Expect> out = new HashMap<>();
        Set<String> ambiguous = new java.util.HashSet<>();
        for (String t : LoreModelTypes.GRAPH.keySet()) {
            LoreRecordRegistry.TypeDef d = def(t);
            if (d == null) continue;
            boolean typeOfPath = t.equals(seg);
            Map<String, String> aliases = LoreModelTypes.ALIASES.getOrDefault(t, Map.of());
            for (LoreRecordRegistry.Field f : d.fields()) {
                boolean declared = f.write() != null && p.equals(norm(f.write().endpoint()));
                if (!typeOfPath && !declared) continue;
                if (f.kind() == null || !CHECKED.contains(f.kind()) || f.multi()) continue;
                Expect e = new Expect(t, f.key(), f.kind(), "date".equals(f.kind()) ? LoreModelTypes.PRECISION.get(t + "." + f.key()) : null);
                List<String> names = new ArrayList<>();
                if (aliases.containsKey(f.key())) names.add(aliases.get(f.key()));
                if (f.write() != null && f.write().field() != null) names.add(f.write().field());
                names.add(f.key());
                for (String n : names) {
                    Expect was = out.putIfAbsent(n, e);
                    if (was != null && !(was.kind().equals(e.kind()) && java.util.Objects.equals(was.precision(), e.precision())))
                        ambiguous.add(n);
                }
            }
        }
        ambiguous.forEach(out::remove);
        return Map.copyOf(out);
    }

    /** Предупреждения о значениях не того вида. Пустой список — всё сошлось или путь модели не знаком. */
    static List<Map<String, Object>> check(String path, JsonNode body) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (body == null || !body.isObject()) return out;
        Map<String, Expect> fields = fieldsFor(path);
        if (fields.isEmpty()) return out;
        checkObject(fields, body, "", out);
        // пакет: список объектов на верхнем уровне ({tasks:[{…}, …]}) — каждый элемент тем же правилом
        body.fields().forEachRemaining(e -> {
            if (!e.getValue().isArray() || fields.containsKey(e.getKey())) return;
            for (int i = 0; i < e.getValue().size(); i++)
                if (e.getValue().get(i).isObject()) checkObject(fields, e.getValue().get(i), e.getKey() + "[" + i + "].", out);
        });
        return out;
    }

    private static void checkObject(Map<String, Expect> fields, JsonNode obj, String prefix, List<Map<String, Object>> out) {
        obj.fields().forEachRemaining(e -> {
            Expect x = fields.get(e.getKey());
            if (x == null) return;
            String why = mismatch(x, e.getValue());
            if (why != null) out.add(warning(prefix + e.getKey(), x, e.getValue(), why));
        });
    }

    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern MOMENT = Pattern.compile(
        "(\\d{4}-\\d{2}-\\d{2})[T ](\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,9})?)?)(Z|[+-]\\d{2}:?\\d{2})?");

    /** Почему значение не того вида; null — вид верный (null и пустая строка даты — очистка, не значение). */
    static String mismatch(Expect x, JsonNode v) {
        if (v == null || v.isNull()) return null;
        switch (x.kind()) {
            case "number":
                return v.isNumber() ? null : v.isTextual() ? "строка вместо числа" : "не число";
            case "bool":
                return v.isBoolean() ? null : "не да/нет (true/false)";
            case "text":
            case "md":
                return v.isTextual() ? null : "не текст";
            case "date": {
                if (!v.isTextual()) return "дата не строкой";
                String s = v.asText().trim();
                if (s.isEmpty()) return null;
                boolean moment = "datetime".equals(x.precision());
                if (isDate(s)) return null;
                if (moment && isMoment(s)) return null;
                return moment ? "не момент ISO-8601 и не дата ГГГГ-ММ-ДД" : "дата не по формату ГГГГ-ММ-ДД";
            }
            default:
                return null;
        }
    }

    static boolean isDate(String s) {
        if (!DATE.matcher(s).matches()) return false;
        try { LocalDate.parse(s); return true; } catch (DateTimeParseException e) { return false; }
    }

    static boolean isMoment(String s) {
        Matcher m = MOMENT.matcher(s);
        if (!m.matches() || !isDate(m.group(1))) return false;
        String time = m.group(2).length() == 5 ? m.group(2) + ":00" : m.group(2);
        String zone = m.group(3) == null ? "Z" : m.group(3).length() == 5 ? m.group(3).substring(0, 3) + ":" + m.group(3).substring(3) : m.group(3);
        try { OffsetDateTime.parse(m.group(1) + "T" + time + zone); return true; } catch (DateTimeParseException e) { return false; }
    }

    private static Map<String, Object> warning(String field, Expect x, JsonNode v, String why) {
        Map<String, Object> w = new LinkedHashMap<>();
        w.put("code", CODE);
        w.put("field", field);
        w.put("model_field", x.type() + "." + x.key());
        w.put("kind", x.kind());
        if (x.precision() != null) w.put("precision", x.precision());
        String expected = expected(x);
        if (expected != null) w.put("expected", expected);
        String shown = v.isTextual() ? v.asText() : v.toString();
        w.put("value", shown.length() > 120 ? shown.substring(0, 120) + "…" : shown);
        w.put("detail", why + " — записано как есть, запись не отклонена; поправьте значение следующей записью");
        return w;
    }

    private static String expected(Expect x) {
        return switch (x.kind()) {
            case "number" -> "число";
            case "bool" -> "true | false";
            case "text", "md" -> "строка";
            case "date" -> "datetime".equals(x.precision()) ? "ГГГГ-ММ-ДДTчч:мм:ссZ" : "ГГГГ-ММ-ДД";
            default -> null;
        };
    }

    /**
     * Ответ записи с предупреждениями: тело-объект → то же тело и {@code warnings[]} (у тела уже есть список —
     * дописываются в его конец). Тело не объект (строка, список, поток) — возвращается как есть.
     */
    static Object withWarnings(Object entity, List<Map<String, Object>> warnings, ObjectMapper mapper) {
        if (warnings == null || warnings.isEmpty() || entity == null) return entity;
        if (entity instanceof CharSequence || entity instanceof Collection<?> || entity instanceof byte[]
                || entity instanceof java.io.InputStream) return entity;
        JsonNode tree;
        try { tree = entity instanceof JsonNode n ? n.deepCopy() : mapper.valueToTree(entity); }
        catch (IllegalArgumentException e) { return entity; }
        if (!(tree instanceof ObjectNode o)) return entity;
        JsonNode had = o.get("warnings");
        ArrayNode list = had instanceof ArrayNode a ? a : o.arrayNode();
        if (had != null && !(had instanceof ArrayNode)) list.add(had);
        for (Map<String, Object> w : warnings) list.add(mapper.valueToTree(w));
        o.set("warnings", list);
        return o;
    }
}
