package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/FIT-04 · сравнение сегментов СОСТАВОМ, а не счётчиком — ЧИСТАЯ логика,
 * без БД и HTTP.
 *
 * <p><b>Зачем.</b> Канва отвечала «сегментов два», но не отвечала «стоит ли делить фичу»: для этого
 * нужно видеть, КАКИЕ боли/выгоды/работы общие для выбранных ролей, а какие принадлежат одной. Логика
 * жила только во фронте v1 ({@code sharedValues}, PR #1404), а v1 заморожен — v2 и MCP пересечения не
 * видели вовсе. Здесь она один раз на сервере, поверх сырых строк среза {@code segment_values}
 * (тот же контракт «сырые факты из БД, агрегация выше», что у {@link VpFitGaps}).
 *
 * <p><b>Пометки.</b> Для каждой ценности, у которой есть хотя бы одна из выбранных ролей:
 * {@code shared} — у всех выбранных; {@code only} — ровно у одной ({@code only_of}); {@code partial} —
 * у нескольких, но не у всех (возможно только при трёх и более ролях). Роли ценности вне выборки
 * отдаются отдельно ({@code other_actors}): «только у агента среди выбранных» и «только у агента
 * вообще» — разные ответы.
 *
 * <p><b>Честные пустые состояния.</b> Неизвестная роль ({@code unknown_segments}) ≠ роль без ценностей
 * ({@code segments_without_values}); меньше двух известных ролей — {@code comparable=false} и пустой
 * состав, а не «всё только у одного». Ценности без роли вовсе — списком {@code unassigned}: их
 * нельзя отнести ни к общим, ни к чьим-то, и молча выкинуть значило бы спрятать дыру разметки.
 */
public final class VpSegmentCompare {

    private VpSegmentCompare() {}

    public record Segment(String actor_id, String name) {}

    public record Value(String value_type, String value_id, String title, String membership,
                        String only_of, List<String> in_segments, List<String> other_actors) {}

    public record Result(boolean comparable, List<Segment> segments, List<String> unknown_segments,
                         List<String> segments_without_values, List<Value> values, List<Value> unassigned) {}

    /** Порядок осей на канве: боли, выгоды, работы. */
    private static final List<String> TYPE_ORDER = List.of("pain", "gain", "job");
    private static final List<String> MEMBERSHIP_ORDER = List.of("shared", "partial", "only");

    /** Параметр {@code segments=A,B,C}: через запятую, пустые и повторы схлопываются, значение — белым списком срезов. */
    public static List<String> parseSegments(String raw) {
        if (raw == null) return List.of();
        Set<String> out = new LinkedHashSet<>();
        for (String s : raw.split(",")) {
            String v = s.trim();
            if (v.isEmpty()) continue;
            if (!LoreSlices.VALUE_RE.matcher(v).matches())
                throw new IllegalArgumentException("bad segment id: " + v);
            out.add(v);
        }
        return List.copyOf(out);
    }

    /**
     * @param rows      строки среза {@code segment_values}: value_type, value_id, title, actor_ids
     * @param requested выбранные роли (порядок выбора — порядок в ответе)
     * @param known     известные роли: actor_id → имя
     */
    public static Result compare(List<Map<String, Object>> rows, List<String> requested, Map<String, String> known) {
        Set<String> picked = new LinkedHashSet<>();
        for (String s : requested) if (s != null && !s.isBlank()) picked.add(s.trim());
        List<Segment> segments = new ArrayList<>();
        List<String> unknown = new ArrayList<>();
        for (String s : picked) {
            if (known.containsKey(s)) segments.add(new Segment(s, known.get(s)));
            else unknown.add(s);
        }
        List<String> segIds = segments.stream().map(Segment::actor_id).toList();

        List<Value> values = new ArrayList<>();
        List<Value> unassigned = new ArrayList<>();
        Set<String> withValues = new LinkedHashSet<>();
        for (Map<String, Object> r : rows) {
            List<String> actors = actorsOf(r.get("actor_ids"));
            String type = str(r.get("value_type")), id = str(r.get("value_id")), title = str(r.get("title"));
            if (actors.isEmpty()) {
                unassigned.add(new Value(type, id, title, "unassigned", null, List.of(), List.of()));
                continue;
            }
            List<String> in = segIds.stream().filter(actors::contains).toList();
            if (in.isEmpty()) continue;
            withValues.addAll(in);
            List<String> others = actors.stream().filter(a -> !segIds.contains(a)).toList();
            String membership = in.size() == segIds.size() ? "shared" : in.size() == 1 ? "only" : "partial";
            values.add(new Value(type, id, title, membership, "only".equals(membership) ? in.get(0) : null, in, others));
        }

        boolean comparable = segIds.size() >= 2;
        if (!comparable) values.clear();
        values.sort(Comparator
            .comparingInt((Value v) -> MEMBERSHIP_ORDER.indexOf(v.membership()))
            .thenComparingInt(v -> v.only_of() == null ? -1 : segIds.indexOf(v.only_of()))
            .thenComparingInt(v -> rank(v.value_type()))
            .thenComparing(v -> v.value_id() == null ? "" : v.value_id()));
        unassigned.sort(Comparator.comparingInt((Value v) -> rank(v.value_type()))
            .thenComparing(v -> v.value_id() == null ? "" : v.value_id()));
        List<String> empty = segIds.stream().filter(s -> !withValues.contains(s)).toList();
        return new Result(comparable, segments, unknown, empty, values, unassigned);
    }

    private static int rank(String type) {
        int i = TYPE_ORDER.indexOf(type);
        return i < 0 ? TYPE_ORDER.size() : i;
    }

    private static List<String> actorsOf(Object raw) {
        Set<String> out = new LinkedHashSet<>();
        if (raw instanceof Collection<?> c) {
            for (Object o : c) if (o != null && !String.valueOf(o).isBlank()) out.add(String.valueOf(o));
        } else if (raw != null && !String.valueOf(raw).isBlank()) {
            out.add(String.valueOf(raw));
        }
        return List.copyOf(out);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
