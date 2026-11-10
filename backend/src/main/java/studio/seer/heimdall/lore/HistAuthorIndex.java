package studio.seer.heimdall.lore;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.BiFunction;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-12 — автор версии по (тип, id, момент) для читателей
 * истории, которым нужен «кто» у события: лента новостей v2 (§1 «Кто», §7.4 доля
 * агентов, §6 свёртка серий), откат «правок агента».
 *
 * <p>Источник — поля {@code changed_by}/{@code changed_by_kind} версий (их пишет
 * каждая вставка Hist, см. {@link ChangeAuthor}). Таблица «тип → цепочка → поле id»
 * не заводится заново: берётся {@link LoreSlices#HIST_PARENT} (RM-P8).
 *
 * <p>Подключение к новостям (ветка feature/s7a-news-server-prep) — одной строкой в
 * {@code LoreNewsV2Resource}, где уже есть функция запроса:
 * <pre>{@code
 * HistAuthorIndex idx = HistAuthorIndex.load((sql, p) -> ingestService.queryPublic(sql, p));
 * new NewsV2Engine(input, (t, id, at) -> idx.authorOf(t, id, at, AuthorResolver.Author::new), ...)
 * }</pre>
 * Тип {@code AuthorResolver.Author(String who, Boolean agent)} совпадает с
 * {@link #authorOf(String, String, Instant, BiFunction)} по форме: {@code agent=null} —
 * неизвестно (не «человек»).
 *
 * <p>Версия события — версия сущности, открытая В ЭТОТ момент: {@code |valid_from − at|}
 * не больше секунды (разница форм записи момента), ближайшая. «Последняя до момента»
 * намеренно не берётся: событие старой версии без автора получило бы автора более
 * ранней — выдуманная атрибуция хуже честного «неизвестно».
 */
final class HistAuthorIndex {

    /** Автор: {@code agent == null} — неизвестно. */
    record Who(String by, Boolean agent) {
        static final Who UNKNOWN = new Who(null, null);
    }

    /** Допуск сопоставления момента события и valid_from (формы ISO с/без миллисекунд). */
    static final long TOLERANCE_MS = 1_000;

    private record Version(long at, Who who) {}

    /** type → id → версии по возрастанию valid_from. */
    private final Map<String, Map<String, List<Version>>> byType;
    private final List<String> errors;

    private HistAuthorIndex(Map<String, Map<String, List<Version>>> byType, List<String> errors) {
        this.byType = byType;
        this.errors = errors;
    }

    /** SQL версий с автором одной цепочки: ref_id, valid_from, changed_by, changed_by_kind. */
    static String sql(String histType) {
        LoreSlices.HistParent parent = LoreSlices.HIST_PARENT.get(histType);
        if (parent == null) throw new IllegalArgumentException("unknown hist chain: " + histType);
        String idExpr = "dict_entry".equals(parent.entityType()) ? "code" : "in('HAS_STATE')." + parent.idField() + "[0]";
        return "SELECT " + idExpr + " AS ref_id, valid_from, changed_by, changed_by_kind FROM " + histType
            + " WHERE changed_by_kind IS NOT NULL AND valid_from IS NOT NULL";
    }

    /**
     * Прочитать все цепочки. Сбой одной цепочки не роняет индекс — попадает в
     * {@link #errors()} («источник недоступен» ≠ «автора нет»).
     */
    static HistAuthorIndex load(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query) {
        Map<String, List<Map<String, Object>>> rows = new TreeMap<>();
        List<String> errors = new ArrayList<>();
        for (Map.Entry<String, LoreSlices.HistParent> e : new TreeMap<>(LoreSlices.HIST_PARENT).entrySet()) {
            try {
                List<Map<String, Object>> r = query.apply(sql(e.getKey()), Map.of());
                rows.put(e.getValue().entityType(), r == null ? List.of() : r);
            } catch (RuntimeException ex) {
                errors.add(e.getKey() + ": " + ex.getMessage());
            }
        }
        return of(rows, errors);
    }

    /**
     * S7A-09: только цепочки типов {@code types} и только версии с {@code valid_from} в
     * [from − допуск, to + допуск]. Автор ищется у версии, начавшейся в момент события
     * (± {@link #TOLERANCE_MS}), поэтому версии вне окна ни одному событию окна не
     * подходят — их чтение было работой впустую. Цепочка вне {@code types} не читается.
     */
    static HistAuthorIndex load(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query,
                                java.util.Set<String> types, Instant from, Instant to) {
        Map<String, List<Map<String, Object>>> rows = new TreeMap<>();
        List<String> errors = new ArrayList<>();
        Map<String, Object> window = Map.of(
            "from", from.minusMillis(TOLERANCE_MS).toString(), "to", to.plusMillis(TOLERANCE_MS).toString());
        for (Map.Entry<String, LoreSlices.HistParent> e : new TreeMap<>(LoreSlices.HIST_PARENT).entrySet()) {
            if (types != null && !types.contains(e.getValue().entityType())) continue;
            try {
                List<Map<String, Object>> r = query.apply(
                    sql(e.getKey()) + " AND valid_from >= date(:from) AND valid_from <= date(:to)", window);
                rows.put(e.getValue().entityType(), r == null ? List.of() : r);
            } catch (RuntimeException ex) {
                errors.add(e.getKey() + ": " + ex.getMessage());
            }
        }
        return of(rows, errors);
    }

    /** Индекс из готовых строк (тип сущности → строки {@link #sql}) — для тестов без БД. */
    static HistAuthorIndex of(Map<String, List<Map<String, Object>>> rowsByType, List<String> errors) {
        Map<String, Map<String, List<Version>>> idx = new HashMap<>();
        for (Map.Entry<String, List<Map<String, Object>>> e : rowsByType.entrySet()) {
            Map<String, List<Version>> perId = idx.computeIfAbsent(e.getKey(), k -> new HashMap<>());
            for (Map<String, Object> r : e.getValue()) {
                Object id = r.get("ref_id");
                Long at = LoreEntityHistory.epochMillis(r.get("valid_from"));
                if (id == null || at == null) continue;
                perId.computeIfAbsent(id.toString(), k -> new ArrayList<>())
                    .add(new Version(at, who(r.get("changed_by"), r.get("changed_by_kind"))));
            }
            perId.values().forEach(l -> l.sort(Comparator.comparingLong(Version::at)));
        }
        return new HistAuthorIndex(idx, List.copyOf(errors));
    }

    private static Who who(Object by, Object kind) {
        if (by == null) return Who.UNKNOWN;
        if (ChangeAuthor.KIND_AGENT.equals(kind)) return new Who(by.toString(), Boolean.TRUE);
        if (ChangeAuthor.KIND_HUMAN.equals(kind)) return new Who(by.toString(), Boolean.FALSE);
        return Who.UNKNOWN;
    }

    /** Автор версии, открытой в момент {@code at} (± {@link #TOLERANCE_MS}). */
    Who authorOf(String type, String id, Instant at) {
        if (type == null || id == null || at == null) return Who.UNKNOWN;
        List<Version> vs = byType.getOrDefault(type, Map.of()).get(id);
        if (vs == null || vs.isEmpty()) return Who.UNKNOWN;
        long t = at.toEpochMilli();
        Who found = Who.UNKNOWN;
        long best = Long.MAX_VALUE;
        for (Version v : vs) {
            long d = Math.abs(v.at() - t);
            if (d <= TOLERANCE_MS && d < best) { best = d; found = v.who(); }
        }
        return found;
    }

    /** То же в форме вызывающего: {@code make(who, agent)} — например {@code AuthorResolver.Author::new}. */
    <A> A authorOf(String type, String id, Instant at, BiFunction<String, Boolean, A> make) {
        Who w = authorOf(type, id, at);
        return make.apply(w.by(), w.agent());
    }

    /** Цепочки, которые не прочитались. */
    List<String> errors() { return errors; }
}
