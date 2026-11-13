package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Строки существующих срезов → {@code values}, {@code parts[].items}, {@code links}
 * паспорта {@code lore.record/1}. Чистые функции, без БД.
 *
 * <p>Ключи значений — те же, что у эмуляции фасада в web-next
 * ({@code passportAdapters.ts}: {@code effort}, {@code actual}, {@code prs},
 * {@code planned_start}, {@code created}, …): переход с клиентской эмуляции на
 * сервер не должен менять потребителя. Тело записи дополнительно идёт под
 * {@code body_md} (так его читает {@code fromLoreRecord}), а разделы — под своими
 * ключами ({@code context_md}, {@code outcome_md}, {@code note_md}, …).
 */
final class LoreRecordValues {

    private LoreRecordValues() {}

    static String str(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v);
        return s.isBlank() ? null : s;
    }

    static List<String> arr(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> l) for (Object o : l) { String s = str(o); if (s != null) out.add(s); }
        else { String s = str(v); if (s != null) out.add(s); }
        return out;
    }

    /**
     * Токен плана из свободного {@code status_raw} («✅ DONE — …» → done). Канон
     * QG-13 зовёт «в работе» {@code in_progress}, а словарь записи — {@code active}:
     * наружу идёт словарь записи, чтобы status_next и статус говорили одним языком.
     */
    static String planToken(String raw) {
        String c = LoreStatusVocabulary.classify(raw);
        if (LoreStatusVocabulary.NONE.equals(c)) return null;
        return "in_progress".equals(c) ? "active" : c;
    }

    /** Статус ADR/спеки: строчный код словаря («ACCEPTED» → accepted). */
    static String docToken(Object raw) {
        String s = str(raw);
        return s == null ? null : s.trim().toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}_ ]", "").trim().replace(' ', '_');
    }

    // ── Точки входа фасада (S4-MODEL-RECORD: сверка снимков держится за них) ──

    /** {@code values} записи по строке главного среза — вместе со статусом записи. */
    static Map<String, Object> values(String type, Map<String, Object> r) {
        // S4-MODEL-RECORD: все типы — общим сборщиком по описаниям from; неизвестный тип — как спека (как раньше).
        List<LoreRecordFrom.Val> d = LoreRecordFrom.VALUES.get(type);
        return LoreRecordFrom.assemble(d != null ? d : LoreRecordFrom.VALUES.get("spec"), r);
    }

    /** Строка ребёнка → item части (кроме фазы: её «x/y» считается по задачам, {@link #phaseItem}). */
    static Map<String, Object> partItem(String childType, Map<String, Object> r) {
        LoreRecordFrom.ItemDef d = LoreRecordFrom.ITEMS.get(childType);
        return LoreRecordFrom.item(d != null ? d : LoreRecordFrom.ITEMS.get("task"), r);   // прочие — как задача (как раньше)
    }

    /** Строка отдельного среза вкладки ({@link #READ_BY_SLICE}) → связь {@code links[]}. */
    static Map<String, Object> sliceLink(String type, String key, Map<String, Object> r) {
        LoreRecordFrom.SliceLink d = LoreRecordFrom.sliceLinkDef(type, key);
        if (d == null) throw new IllegalArgumentException("связь " + type + "." + key + " не читается отдельным срезом");
        return LoreRecordFrom.sliceLink(d, r);
    }

    /** Умолчания пустого паспорта ({@code _new}) — как у путей создания. */
    static Map<String, Object> defaults(String type) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", "");
        switch (type) {
            case "sprint" -> v.put("status", "todo");        // sprint/create: status по умолчанию todo
            case "task" -> { v.put("status", "planned"); v.put("task_type", "dev"); } // task: 📋 PLANNED, dev
            case "adr" -> v.put("status", "proposed");
            case "spec" -> v.put("status", "proposed");
            default -> { }
        }
        return v;
    }

    // ── parts: строки детей → items ───────────────────────────────────────

    /** Строка фазы (phases_of_sprint) → item; «x/y» считается по задачам спринта. */
    static Map<String, Object> phaseItem(Map<String, Object> r, List<Map<String, Object>> taskItems) {
        String uid = str(r.get("phase_uid"));
        int total = 0, done = 0;
        for (Map<String, Object> t : taskItems) {
            @SuppressWarnings("unchecked") Map<String, Object> tv = (Map<String, Object>) t.get("values");
            if (uid != null && uid.equals(tv.get("phase_uid"))) {
                total++;
                if ("done".equals(tv.get("status"))) done++;
            }
        }
        String title = str(r.get("title")) != null ? str(r.get("title")) : str(r.get("phase_id"));
        String status = total > 0 && done == total ? "done" : done > 0 ? "partial" : null;
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("status", status);
        vals.put("title", title);
        vals.put("progress", done + "/" + total);
        vals.put("valid_from", str(r.get("valid_from")));
        vals.put("summary_md", str(r.get("summary_md")));
        return item(uid, title, status, vals);
    }

    /** Kit 09.11: счётчик в форме вычисляемого поля {value, known, of} — у счёта known = of. */
    static Map<String, Object> countOf(int n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("value", n);
        m.put("known", n);
        m.put("of", n);
        return m;
    }

    private static int intOf(Object v) {
        if (v instanceof Number n) return n.intValue();
        try { return v == null ? 0 : Integer.parseInt(String.valueOf(v)); } catch (NumberFormatException e) { return 0; }
    }

    /**
     * Вычисляемые итоги записи по строке её среза — отдельно от values (S7A-12 09.11: объект
     * {value, known, of} в values клиент рисует строкой, то есть мусором). Итоги спринта
     * считаются по задачам в фасаде (LoreSprintTotals), здесь — вехи и релиза.
     */
    static Map<String, Object> computed(String type, Map<String, Object> r) {
        Map<String, Object> c = new LinkedHashMap<>();
        switch (type == null ? "" : type) {
            case "milestone" -> c.put("sprints_total", countOf(arr(r.get("direct_sprint_ids")).size()));
            case "release" -> {
                c.put("sprints_total", countOf(intOf(r.get("sprint_count"))));
                c.put("prs_total", countOf(intOf(r.get("pr_count"))));
            }
            default -> { }
        }
        return c;
    }

    private static Map<String, Object> item(String id, String title, String status, Map<String, Object> vals) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title != null ? title : id);
        m.put("status", status);
        m.put("values", vals);
        return m;
    }

    /**
     * Вид обоих концов в каждой связи — {@code fromKind}/{@code toKind} (замечание kit-сессии 11.11):
     * клиент отбирает связь по виду цели, и угадывать вид по загруженным записям нельзя — запись,
     * которой среди них нет, пропадала бы молча. Ключи только добавляются; {@code type} прежний.
     */
    static List<Map<String, Object>> withKinds(String ownType, List<Map<String, Object>> links) {
        for (Map<String, Object> l : links) {
            Object other = l.get("type");
            boolean out = "out".equals(l.get("dir"));
            l.put("fromKind", out ? ownType : other);
            l.put("toKind", out ? other : ownType);
        }
        return links;
    }

    /** Связь {@code links[]}: {rel, dir, id, type, title, status} (+ свойства ребра). */
    static Map<String, Object> link(String rel, String dir, String id, String type, String title, String status) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("rel", rel);
        m.put("dir", dir);
        m.put("id", id);
        m.put("type", type);
        m.put("title", title != null ? title : id);
        m.put("status", status != null ? status : "");
        return m;
    }

    /**
     * Вкладки связей, которые фасад наполняет ОТДЕЛЬНЫМ срезом (не из строки основного):
     * ключ связи → срез. Состояние каждого чтения уходит в {@code meta.data_state}.
     */
    static final Map<String, Map<String, String>> READ_BY_SLICE = readBySlice();

    /** S4-MODEL-RECORD: выводится из описаний {@link LoreRecordFrom#SLICE_LINKS} — один источник. */
    private static Map<String, Map<String, String>> readBySlice() {
        Map<String, Map<String, String>> out = new LinkedHashMap<>();
        LoreRecordFrom.SLICE_LINKS.forEach((type, defs) -> {
            Map<String, String> m = new LinkedHashMap<>();
            for (LoreRecordFrom.SliceLink d : defs) m.put(d.key(), d.slice());
            out.put(type, java.util.Collections.unmodifiableMap(m));
        });
        return java.util.Collections.unmodifiableMap(out);
    }

    /**
     * SPRINT_LORE_MODEL_AS_CONFIG/MC-04 (SPRINT_UXR_POLISH_UAT_1113/PU-02): вкладки связей без своего
     * среза — фасад читает их прямо по ребру из модели ({@link LoreRecordEdgeLinks}). Раньше это был
     * список «не читается — среза нет», и паспорт любой записи навсегда показывал «Часть сведений не
     * загрузилась». Вкладка здесь — ровно одним способом из трёх (сверка — LoreRecordRowLinksTest).
     */
    static final Map<String, java.util.Set<String>> READ_BY_EDGE = Map.of(
        "task", java.util.Set.of("qgRecs", "insights", "refsOut", "refsIn", "publications"),
        "adr", java.util.Set.of("runbooks", "refsOut", "refsIn", "insights"),
        "spec", java.util.Set.of("refsOut", "refsIn"),
        // 11.11 (полнота модели рёбер): «упоминает» и публикации BRAGI объявлены у всех концов,
        // а срезов под них нет — вкладка честно говорит «не проверено», а не «0».
        "sprint", java.util.Set.of("refsOut", "refsIn", "publications"),
        "release", java.util.Set.of("refsOut", "refsIn", "publications"),
        "decision", java.util.Set.of("refsOut", "refsIn"),
        "question", java.util.Set.of("refsOut", "refsIn"),
        "component", java.util.Set.of("refsOut", "refsIn"),
        "tech", java.util.Set.of("refsOut", "refsIn"),
        "feature", java.util.Set.of("refsOut", "refsIn"));

    /**
     * Вкладки связей, которые фасад НЕ читает ничем. Без этого списка такая вкладка показала бы
     * «0 — пусто (проверено)», не проверив ничего; по каждой фасад пишет в {@code meta.data_state}
     * {@code state: error} с причиной. Должен быть пуст: сторож ModelServerConsistencyGuardTest (MC-03)
     * краснеет на любой записи — вкладку надо читать (срез или ребро) либо снять с паспорта.
     */
    static final Map<String, java.util.Set<String>> UNREAD_LINK_TABS = Map.of();

    /** Строки {@code meta.data_state} для вкладок без среза — форма та же, что у прочитанных источников. */
    static List<Map<String, Object>> unreadState(String type) {
        List<Map<String, Object>> out = new ArrayList<>();
        java.util.Set<String> keys = UNREAD_LINK_TABS.getOrDefault(type, java.util.Set.of());
        for (String k : new java.util.TreeSet<>(keys)) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("source", "relation:" + k);
            e.put("part", k);
            e.put("state", "error");
            e.put("reason", "связь не читается фасадом: среза нет — «0» здесь не проверен");
            out.add(e);
        }
        return out;
    }

    /** Префикс ключа паспорта технологии: технология — спека SPEC-TECH-&lt;КОМПОНЕНТ&gt;-&lt;ТЕХ&gt;. */
    static final String TECH_SPEC_PREFIX = "SPEC-TECH-";

    /**
     * Связи {@code links[]}, которые читаются из строки основного среза записи (без отдельных
     * запросов). Пустой список здесь — «проверено, связей нет»: основной срез прочитан.
     * S4-29 v3: вкладки связей решения, вопроса, вехи, компонента, фичи и «блокирует» у ADR.
     */
    static List<Map<String, Object>> rowLinks(String type, Map<String, Object> row) {
        return LoreRecordFrom.rowLinks(type, row);   // S4-MODEL-RECORD: по описаниям LoreRecordFrom.ROW_LINKS
    }
}
