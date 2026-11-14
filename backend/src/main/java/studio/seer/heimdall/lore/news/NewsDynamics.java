package studio.seer.heimdall.lore.news;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.IsoFields;
import java.time.temporal.TemporalAdjusters;
import java.util.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-11: блок «Динамика» новостей — объёмные метрики по периодам
 * «неделя к неделе» и «месяц к месяцу» (слово владелицы 14.11.2026).
 *
 * <p>Чистая функция: факты (элемент метрики и его момент) → ряды по ISO-неделям
 * (последние {@value #WEEKS}) или календарным месяцам (последние {@value #MONTHS}),
 * у каждой метрики — значение текущего периода, прошлого, Δ и %. Ни БД, ни часов:
 * «сейчас» приходит параметром. Факты собирает {@code LoreNewsDynamicsCollector}.
 *
 * <p>Правила (решения владелицы):
 * <ul>
 *   <li>считает сервер (S7A-09) — веб и miniLORE только рисуют;</li>
 *   <li>границы периодов — UTC (CI-TZ-UTC-DAY): неделя с понедельника 00:00 UTC, месяц с 1-го числа;</li>
 *   <li>прошлый период равен 0 — процента нет, только Δ ({@code pct = null});</li>
 *   <li>исключённое (bookkeeping, «рождена закрытой», момент неизвестен) в ряд не входит,
 *       но называется числом — молча выкинутое неотличимо от «такого не было»;</li>
 *   <li>источник не прочитан — метрика «не смогли посчитать» с причиной, а не ноль;</li>
 *   <li>фильтры и скоуп — те же оси и то же правило, что у ленты ({@link NewsV2Engine#matches}).</li>
 * </ul>
 */
public final class NewsDynamics {

    private NewsDynamics() {}

    /** Версия формы ответа GET /lore/news/v2/dynamics. */
    public static final String FORM_VERSION = "news-dynamics/1.0";

    public static final int WEEKS = 12, MONTHS = 6;

    /** Метрики в порядке владелицы: закрыто задач, заведено задач, закрыто спринтов, релизы, принято ADR и решений. */
    public static final List<String> METRICS =
        List.of("tasks_closed", "tasks_created", "sprints_closed", "releases", "accepted");

    /** Типы записей метрики — для фильтра «Тип записи», как в ленте. */
    public static final Map<String, Set<String>> METRIC_TYPES = Map.of(
        "tasks_closed", Set.of("task"),
        "tasks_created", Set.of("task"),
        "sprints_closed", Set.of("sprint"),
        "releases", Set.of("release"),
        "accepted", Set.of("adr", "decision"));

    /**
     * Источники сборщика, без которых метрика не считается. Спринты нужны задачам:
     * проекты, компоненты и вехи задачи — через её спринт, как в ленте.
     */
    public static final Map<String, Set<String>> METRIC_SOURCES = Map.of(
        "tasks_closed", Set.of("sprints", "tasks", "task_backfill"),
        "tasks_created", Set.of("sprints", "tasks", "task_backfill"),
        "sprints_closed", Set.of("sprints"),
        "releases", Set.of("releases"),
        "accepted", Set.of("adrs", "adr_backfill", "decisions", "decision_backfill"));

    /** Почему факт не вошёл в ряд. */
    public static final String EX_BOOKKEEPING = "bookkeeping", EX_BORN_DONE = "born_done", EX_MOMENT_UNKNOWN = "moment_unknown";

    public enum Period {
        WEEK, MONTH;

        /** null → неделя (по умолчанию); неизвестное значение → null (400). */
        public static Period parse(String s) {
            if (s == null) return WEEK;
            return switch (s.strip().toLowerCase(Locale.ROOT)) {
                case "week" -> WEEK;
                case "month" -> MONTH;
                default -> null;
            };
        }

        public String key() { return name().toLowerCase(Locale.ROOT); }
    }

    /**
     * Факт метрики: элемент {@code type:id} попал в метрику в момент {@code at} (UTC).
     * {@code excluded} — причина исключения (null — считается); у «момент неизвестен» {@code at = null}.
     * Принадлежности — те же, что у события ленты.
     */
    public record Fact(String metric, String type, String id, Instant at, List<String> projects,
                       List<String> components, String sprint, List<String> milestones, String excluded) {}

    /** Вход: факты, провалы источников, скоуп проектов вызывающего (null — без ограничения). */
    public record Input(List<Fact> facts, List<NewsV2.SourceError> errors, Set<String> scope) {}

    /** Фильтры ленты, применимые к динамике (оси записи). Пусто/null — без фильтра. */
    public record Filter(Set<String> types, Set<String> projects, Set<String> components,
                         Set<String> sprints, Set<String> milestones) {
        public static final Filter NONE = new Filter(null, null, null, null, null);
    }

    /** Период ряда [from, to). */
    public record Bucket(String key, String label, Instant from, Instant to) {}

    // ═════════════════════════ периоды ═════════════════════════

    /** Периоды ряда, последний — текущий (содержит {@code now}). */
    public static List<Bucket> buckets(Period p, Instant now) {
        LocalDate today = now.atZone(ZoneOffset.UTC).toLocalDate();
        List<Bucket> out = new ArrayList<>();
        if (p == Period.MONTH) {
            LocalDate cur = today.withDayOfMonth(1);
            for (int i = MONTHS - 1; i >= 0; i--) {
                LocalDate s = cur.minusMonths(i);
                out.add(new Bucket(String.format("%04d-%02d", s.getYear(), s.getMonthValue()),
                    String.format("%02d.%02d", s.getMonthValue(), s.getYear() % 100),
                    utc(s), utc(s.plusMonths(1))));
            }
        } else {
            LocalDate cur = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            for (int i = WEEKS - 1; i >= 0; i--) {
                LocalDate s = cur.minusWeeks(i);
                int w = s.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
                out.add(new Bucket(String.format("%04d-W%02d", s.get(IsoFields.WEEK_BASED_YEAR), w),
                    String.format("W%02d", w), utc(s), utc(s.plusWeeks(1))));
            }
        }
        return out;
    }

    private static Instant utc(LocalDate d) { return d.atStartOfDay(ZoneOffset.UTC).toInstant(); }

    // ═════════════════════════ фильтры и скоуп ═════════════════════════

    /** Проекты факта под скоупом (§3 ленты): только разрешённые. */
    static List<String> scoped(List<String> projects, Set<String> scope) {
        List<String> p = projects == null ? List.of() : projects;
        return scope == null ? p : p.stream().filter(scope::contains).toList();
    }

    static List<String> orNone(List<String> v, String none) {
        return v == null || v.isEmpty() ? List.of(none) : v;
    }

    /** Факт виден и проходит фильтры — те же оси и то же правило «хоть одно значение», что у ленты. */
    static boolean visible(Fact f, Filter q, Set<String> scope) {
        List<String> projects = scoped(f.projects(), scope);
        if (scope != null && projects.isEmpty()) return false;
        if (!NewsV2Engine.hit(q.types(), List.of(f.type()))) return false;
        if (!NewsV2Engine.hit(q.projects(), orNone(projects, NewsV2Engine.NOPROJ))) return false;
        if (!NewsV2Engine.hit(q.components(), orNone(f.components(), NewsV2Engine.NOCOMP))) return false;
        if (!NewsV2Engine.hit(q.sprints(), List.of(f.sprint() == null ? NewsV2Engine.NOSPR : f.sprint()))) return false;
        return NewsV2Engine.hit(q.milestones(), orNone(f.milestones(), NewsV2Engine.NOMS));
    }

    /** Статус ADR/решения «принято» — тот же словарь, что у очереди знаний §7.3. */
    public static boolean accepted(String status) {
        return NewsV2Engine.m(NewsV2Engine.ACC, status);
    }

    // ═════════════════════════ расчёт ═════════════════════════

    public static Map<String, Object> compute(Input in, Filter filter, Period period, Instant now) {
        Filter q = filter == null ? Filter.NONE : filter;
        List<Bucket> B = buckets(period, now);
        Instant w0 = B.get(0).from(), w1 = B.get(B.size() - 1).to();
        int K = B.size();

        List<NewsV2.SourceError> errors = in.errors() == null ? List.of() : in.errors();
        List<Map<String, Object>> metrics = new ArrayList<>();
        boolean partial = false;
        for (String id : METRICS) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            List<NewsV2.SourceError> failed = errors.stream()
                .filter(e -> METRIC_SOURCES.get(id).contains(e.source())).toList();
            Set<String> types = new TreeSet<>(METRIC_TYPES.get(id));
            if (q.types() != null && !q.types().isEmpty()) types.retainAll(q.types());
            if (!failed.isEmpty()) {
                partial = true;
                m.put("state", "unavailable");
                m.put("reason", String.join("; ", failed.stream().map(e -> e.source() + ": " + e.error()).toList()));
                m.put("forbidden", failed.stream().anyMatch(NewsV2.SourceError::forbidden));
                m.put("value", null);
                m.put("series", null);
                metrics.add(m);
                continue;
            }
            if (types.isEmpty()) {
                m.put("state", "filtered_out");
                m.put("value", null);
                m.put("series", null);
                metrics.add(m);
                continue;
            }
            int[] series = new int[K];
            Map<String, int[]> byType = new TreeMap<>();
            for (String t : types) byType.put(t, new int[K]);
            Map<String, Integer> excluded = new TreeMap<>();
            Set<String> seen = new HashSet<>();
            for (Fact f : in.facts()) {
                if (!id.equals(f.metric()) || !visible(f, q, in.scope())) continue;
                // Один элемент — один факт метрики (последний статус): дубли строк источника не удваивают.
                if (!seen.add(f.type() + ":" + f.id())) continue;
                if (f.excluded() != null) {
                    // «Момент неизвестен» — без даты, он вне любого окна: называется всегда.
                    boolean inWindow = f.at() == null || (!f.at().isBefore(w0) && f.at().isBefore(w1));
                    if (inWindow) excluded.merge(f.excluded(), 1, Integer::sum);
                    continue;
                }
                if (f.at() == null || f.at().isBefore(w0) || !f.at().isBefore(w1)) continue;
                for (int k = 0; k < K; k++) {
                    Bucket b = B.get(k);
                    if (!f.at().isBefore(b.from()) && f.at().isBefore(b.to())) {
                        series[k]++;
                        byType.get(f.type())[k]++;
                        break;
                    }
                }
            }
            int cur = series[K - 1], prev = series[K - 2];
            m.put("state", "ok");
            m.put("value", cur);
            m.put("previous", prev);
            m.put("delta", cur - prev);
            m.put("pct", pct(cur, prev));
            m.put("series", Arrays.stream(series).boxed().toList());
            if (byType.size() > 1 || METRIC_TYPES.get(id).size() > 1) {
                Map<String, Object> bt = new LinkedHashMap<>();
                for (var e : byType.entrySet()) bt.put(e.getKey(), Arrays.stream(e.getValue()).boxed().toList());
                m.put("by_type", bt);
            }
            m.put("excluded", excluded);
            metrics.add(m);
        }

        List<Map<String, Object>> buckets = new ArrayList<>();
        for (int k = 0; k < K; k++) {
            Bucket b = B.get(k);
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("key", b.key());
            x.put("label", b.label());
            x.put("from", b.from().toString());
            x.put("to", b.to().toString());
            x.put("current", k == K - 1);
            // Текущий период ещё идёт: сравнение с полным прошлым — честно помечено.
            x.put("partial", k == K - 1 && now.isBefore(b.to()));
            buckets.add(x);
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("form_version", FORM_VERSION);
        meta.put("generated_at", now.toString());
        meta.put("period", period.key());
        meta.put("compare", period == Period.MONTH ? "month_over_month" : "week_over_week");
        meta.put("tz", "UTC");
        meta.put("state", partial ? "partial" : "ok");
        List<Map<String, Object>> errs = new ArrayList<>();
        for (NewsV2.SourceError e : errors)
            errs.add(NewsV2Engine.mapOf("source", e.source(), "error", e.error(), "critical", e.critical(), "forbidden", e.forbidden()));
        meta.put("errors", errs);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("buckets", buckets);
        out.put("metrics", metrics);
        out.put("meta", meta);
        return out;
    }

    /** Δ в процентах к прошлому периоду, одна цифра после запятой; прошлый 0 — null. */
    static Double pct(int cur, int prev) {
        return prev == 0 ? null : Math.round((cur - prev) * 1000.0 / prev) / 10.0;
    }
}
