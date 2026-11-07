package studio.seer.heimdall.lore.news;

import studio.seer.heimdall.lore.news.NewsV2.Cat;
import studio.seer.heimdall.lore.news.NewsV2.Event;
import studio.seer.heimdall.lore.news.NewsV2.Input;
import studio.seer.heimdall.lore.news.NewsV2.Knowledge;
import studio.seer.heimdall.lore.news.NewsV2.Query;
import studio.seer.heimdall.lore.news.NewsV2.Release;
import studio.seer.heimdall.lore.news.NewsV2.Sprint;
import studio.seer.heimdall.lore.news.NewsV2.TaskRecord;
import studio.seer.heimdall.lore.news.NewsV2.Version;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-09 (+S7A-01/02/03/07): единый вычислитель новостей v2.
 *
 * <p>Порт эталонной реализации на реальных данных
 * ({@code docs/prototypes/news-proof/page.tpl.html}, {@code js_v2_model.js},
 * {@code build.cjs}) по SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0. Имена методов
 * повторяют JS ({@code prepare}, {@code groupCount}, {@code rollup},
 * {@code shipModel}, {@code evalAt}, {@code shippedBy}, {@code matrix},
 * {@code knowledge}, {@code validate}) — чтобы сверка «JS ↔ Java» шла
 * построчно. §7.2b (своё/общее) и §7.2c (реактивация) в прототипе не
 * реализованы — сделаны по формулам спеки.
 *
 * <p>Чистая функция от {@link Input}: ни БД, ни Quarkus, ни часов (момент «сейчас»
 * приходит во входе). Повторный вызов на тех же данных даёт тот же ответ —
 * все обходы по отсортированным коллекциям.
 */
public final class NewsV2Engine {

    public static final String NOPROJ = "(no-project)";
    public static final String NOCOMP = "(no-component)";
    public static final String NOSPR  = "(no-sprint)";
    public static final String NOMS   = "(no-milestone)";
    public static final String AUTHOR_AGENT = "agent", AUTHOR_HUMAN = "human", AUTHOR_UNKNOWN = "unknown";

    /** Оси группировки и фильтра (S7A-02). */
    public static final List<String> AXES =
        List.of("project", "component", "type", "kind", "sprint", "milestone", "author", "day");
    /** Оси, по которым элемент принадлежит группе (а не событие): для них считается ×N. */
    static final Set<String> ELEMENT_AXES = Set.of("project", "component", "type", "sprint", "milestone");
    /** Оси задач для сгорания по группам (§7.2, §7.2b). */
    static final List<String> TASK_AXES = List.of("project", "sprint", "component", "milestone");

    static final Duration ROLLUP_WINDOW = Duration.ofMinutes(30);   // §6
    static final int EXAMPLES = 10;

    private final Input in;
    private final AuthorResolver authors;
    private final KnowledgeStatusHistory kstatus;
    private final LocalDate d0, d1;

    public NewsV2Engine(Input in, AuthorResolver authors, KnowledgeStatusHistory kstatus) {
        this.in = in;
        this.authors = authors == null ? AuthorResolver.UNKNOWN : authors;
        this.kstatus = kstatus == null ? KnowledgeStatusHistory.NONE : kstatus;
        this.d0 = localDay(in.t0());
        this.d1 = localDay(in.t1().minusMillis(1));
    }

    // ═════════════════════════ категории статуса ═════════════════════════

    private static final Pattern CLOSED_WORD = Pattern.compile("^(DONE|CLOSED|MERGED|ЗАВЕРШ|ЗАКРЫТ)");
    private static final Pattern CANCEL_WORD = Pattern.compile("^(CANCEL|ОТМЕН)");
    private static final Pattern READY_WORD  = Pattern.compile("READY FOR DEPLOY", Pattern.CASE_INSENSITIVE);

    /** JS {@code cat3}: closed = done | cancelled; ready = 🚀 / READY FOR DEPLOY; иначе open. null → null. */
    public static Cat cat3(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        String u = s.toUpperCase(Locale.ROOT);
        if (u.startsWith("✅") || CLOSED_WORD.matcher(u).find() || u.startsWith("🚫") || CANCEL_WORD.matcher(u).find())
            return Cat.CLOSED;
        if (s.startsWith("🚀") || READY_WORD.matcher(s).find()) return Cat.READY;
        return Cat.OPEN;
    }

    static boolean isCancel(String raw) {
        if (raw == null) return false;
        String s = raw.trim();
        return s.startsWith("🚫") || CANCEL_WORD.matcher(s.toUpperCase(Locale.ROOT)).find();
    }

    // ═════════════════════════ время (§4) ═════════════════════════

    LocalDate localDay(Instant t) { return t.atZone(in.zone()).toLocalDate(); }

    LocalDate dayOf(Event e) { return e.at() != null ? localDay(e.at()) : e.day(); }

    boolean inPeriod(Event e) {
        if (e.at() != null) return !e.at().isBefore(in.t0()) && e.at().isBefore(in.t1());
        return e.day() != null && !e.day().isBefore(d0) && !e.day().isAfter(d1);
    }

    /**
     * Ключ порядка: момент UTC; запись «только дата» — конец своего местного дня
     * (§4: «релиз с одной датой — конец своего местного дня»). Полночь не
     * подставляется: она сделала бы запись старше событий того же дня.
     */
    Instant sortKey(Event e) {
        if (e.at() != null) return e.at();
        return e.day().plusDays(1).atStartOfDay(in.zone()).toInstant().minusMillis(1);
    }

    // ═════════════════════════ §1 события задач ═════════════════════════

    /** Задача → её проекты (проекты спринта), компоненты, вехи. */
    List<String> taskProjects(TaskRecord t) {
        Sprint s = t.sprintId() == null ? null : in.sprints().get(t.sprintId());
        return s == null || s.projects().isEmpty() ? List.of() : s.projects();
    }

    List<String> taskComponents(TaskRecord t) {
        if (t.componentId() != null) return List.of(t.componentId());
        Sprint s = t.sprintId() == null ? null : in.sprints().get(t.sprintId());
        return s == null ? List.of() : s.components();
    }

    List<String> taskMilestones(TaskRecord t) {
        Sprint s = t.sprintId() == null ? null : in.sprints().get(t.sprintId());
        return s == null || s.milestones() == null ? List.of() : s.milestones();
    }

    /**
     * Вид события версии по переходу категории (§1): заведена · готова к
     * выкатке · закрыта · снята · реактивирована · сменила статус · изменена.
     * Реактивация — переход «сделано» (готова/закрыта) → открыта (§7.2c).
     */
    static String kindOf(Version prev, Version cur) {
        if (prev == null) return "created";
        Cat pc = cat3(prev.status()), nc = cat3(cur.status());
        if (nc == Cat.CLOSED && pc != Cat.CLOSED) return isCancel(cur.status()) ? "cancelled" : "closed";
        if (nc == Cat.READY && pc == Cat.OPEN) return "ready";
        if (nc == Cat.OPEN && (pc == Cat.READY || pc == Cat.CLOSED)) return "reactivated";
        if (!Objects.equals(prev.status() == null ? "" : prev.status(), cur.status() == null ? "" : cur.status()))
            return "status";
        return "changed";
    }

    /** Датированные версии задачи по возрастанию момента (дубли момента — первая). */
    static List<Version> chain(TaskRecord t) {
        List<Version> v = new ArrayList<>();
        Set<Instant> seen = new HashSet<>();
        for (Version x : t.versions()) if (x.at() != null && seen.add(x.at())) v.add(x);
        v.sort(Comparator.comparing(Version::at));
        return v;
    }

    List<Event> taskEvents() {
        List<Event> out = new ArrayList<>();
        for (TaskRecord t : in.tasks()) {
            Version prev = null;
            for (Version v : chain(t)) {
                if (!v.at().isBefore(in.t1())) break;
                if (!v.at().isBefore(in.t0())) {
                    String kind = kindOf(prev, v);
                    out.add(new Event("task", t.uid(), kind, v.at(), null, null, null,
                        taskProjects(t), taskComponents(t), t.sprintId(), taskMilestones(t),
                        t.sprintId(), prev == null ? null : prev.status(), v.status(), t.title(), "task_history"));
                }
                prev = v;
            }
        }
        return out;
    }

    /** Все события периода: задачи + прочие, с автором и скоупом (§3). */
    List<Event> periodEvents() {
        List<Event> all = new ArrayList<>(taskEvents());
        for (Event e : in.otherEvents()) if (inPeriod(e)) all.add(e);
        List<Event> out = new ArrayList<>();
        for (Event e : all) {
            Event x = e;
            if (x.who() == null && x.agent() == null && x.at() != null) {
                AuthorResolver.Author a = authors.authorOf(x.type(), x.el(), x.at());
                if (a != null && (a.who() != null || a.agent() != null)) x = x.withAuthor(a.who(), a.agent());
            }
            x = scoped(x);
            if (x != null) out.add(x);
        }
        out.sort(Comparator.comparing(this::sortKey).thenComparing(Event::el).thenComparing(Event::kind));
        return out;
    }

    /** §3: элемент виден, если разрешён хоть один его проект; в группах — только разрешённые. */
    Event scoped(Event e) {
        Set<String> scope = in.scope();
        if (scope == null) return e;
        List<String> p = e.projects() == null ? List.of() : e.projects().stream().filter(scope::contains).toList();
        return p.isEmpty() ? null : e.withProjects(p);
    }

    // ═════════════════════════ §5 подготовка набора E ═════════════════════════

    public record Row(String key, Event first, List<Event> events) {
        public int mult() { return events.size(); }
    }

    public record Prepared(List<Event> E, List<Event> dropped, List<Row> rows) {}

    /** JS {@code prepare}: «изменено» в день создания отбрасывается; дедуп «элемент : вид : день». */
    Prepared prepare(List<Event> raw) {
        Map<String, LocalDate> createdDay = new HashMap<>();
        for (Event e : raw) if ("created".equals(e.kind())) createdDay.put(e.elKey(), dayOf(e));
        List<Event> dropped = new ArrayList<>(), E = new ArrayList<>();
        for (Event e : raw) {
            if ("changed".equals(e.kind()) && Objects.equals(createdDay.get(e.elKey()), dayOf(e))) { dropped.add(e); continue; }
            E.add(e);
        }
        Map<String, Row> rows = new LinkedHashMap<>();
        for (Event e : E) {
            String k = e.elKey() + "|" + e.kind() + "|" + dayOf(e);
            rows.computeIfAbsent(k, kk -> new Row(kk, e, new ArrayList<>())).events().add(e);
        }
        return new Prepared(E, dropped, new ArrayList<>(rows.values()));
    }

    // ═════════════════════════ §2/§7.1 группировки ═════════════════════════

    static String authorClass(Event e) {
        return Boolean.TRUE.equals(e.agent()) ? AUTHOR_AGENT : Boolean.FALSE.equals(e.agent()) ? AUTHOR_HUMAN : AUTHOR_UNKNOWN;
    }

    List<String> axisValues(String axis, Event e) {
        return switch (axis) {
            case "project"   -> e.projects() == null || e.projects().isEmpty() ? List.of(NOPROJ) : e.projects();
            case "component" -> e.components() == null || e.components().isEmpty() ? List.of(NOCOMP) : e.components();
            case "type"      -> List.of(e.type());
            case "kind"      -> List.of(e.kind());
            case "sprint"    -> List.of(e.sprint() == null ? NOSPR : e.sprint());
            case "milestone" -> e.milestones() == null || e.milestones().isEmpty() ? List.of(NOMS) : e.milestones();
            case "author"    -> List.of(authorClass(e));
            case "day"       -> List.of(String.valueOf(dayOf(e)));
            default -> throw new IllegalArgumentException("unknown axis: " + axis);
        };
    }

    public record Group(String g, int ev, int el, int multi, int agEv, int agEl, List<Event> events) {}

    public record GroupCount(List<Group> list, int totEv, int totEl, int M, int extra,
                             int agEvT, int agElT, Map<String, Set<String>> gx) {}

    /** JS {@code groupCount}: полный счёт в группе, объединение в итоге, M и Σ(|G(x)|−1). */
    GroupCount groupCount(List<Event> E, String axis) {
        return groupCount(E, e -> axisValues(axis, e));
    }

    GroupCount groupCount(List<Event> E, Function<Event, List<String>> gfn) {
        Map<String, int[]> evs = new LinkedHashMap<>();
        Map<String, Set<String>> els = new HashMap<>(), agEls = new HashMap<>();
        Map<String, List<Event>> gEvents = new HashMap<>();
        Map<String, Set<String>> gx = new LinkedHashMap<>();
        Set<String> all = new HashSet<>();
        int agEvT = 0; Set<String> agElT = new HashSet<>();
        for (Event e : E) {
            String k = e.elKey(); all.add(k);
            boolean ag = Boolean.TRUE.equals(e.agent());
            if (ag) { agEvT++; agElT.add(k); }
            Set<String> gs = new LinkedHashSet<>(gfn.apply(e));
            gx.computeIfAbsent(k, kk -> new TreeSet<>());
            for (String g : gs) {
                gx.get(k).add(g);
                int[] c = evs.computeIfAbsent(g, gg -> new int[2]);
                c[0]++;
                if (ag) c[1]++;
                els.computeIfAbsent(g, gg -> new HashSet<>()).add(k);
                if (ag) agEls.computeIfAbsent(g, gg -> new HashSet<>()).add(k);
                gEvents.computeIfAbsent(g, gg -> new ArrayList<>()).add(e);
            }
        }
        List<Group> list = new ArrayList<>();
        for (Map.Entry<String, int[]> en : evs.entrySet()) {
            String g = en.getKey();
            int multi = 0;
            for (String k : els.get(g)) if (gx.get(k).size() >= 2) multi++;
            list.add(new Group(g, en.getValue()[0], els.get(g).size(), multi, en.getValue()[1],
                agEls.getOrDefault(g, Set.of()).size(), gEvents.get(g)));
        }
        list.sort(Comparator.comparingInt(Group::ev).reversed().thenComparing(Group::g));
        int M = 0, extra = 0;
        for (Set<String> s : gx.values()) { if (s.size() >= 2) M++; extra += s.size() - 1; }
        return new GroupCount(list, E.size(), all.size(), M, extra, agEvT, agElT.size(), gx);
    }

    // ═════════════════════════ §6 свёртка серий ═════════════════════════

    public record Series(String key, List<Event> items) {}

    static String parentOf(Event e) {
        return switch (e.type()) {
            case "task" -> "sprint:" + e.sprint();
            case "decision" -> "adr:" + (e.parent() == null ? "-" : e.parent());
            default -> "type:" + e.type();
        };
    }

    /** JS {@code rollup}: один вид, один автор, один родитель, окно 30 минут. Меняет вид, не счёт. */
    List<Series> rollup(List<Event> E) {
        List<Event> timed = new ArrayList<>(E.stream().filter(e -> e.at() != null).toList());
        timed.sort(Comparator.comparing(Event::at).thenComparing(Event::el).thenComparing(Event::kind));
        Map<String, Series> open = new HashMap<>(); Map<String, Instant> last = new HashMap<>();
        List<Series> series = new ArrayList<>();
        for (Event e : timed) {
            String key = e.kind() + "|" + (e.who() == null ? "unknown" : e.who()) + "|" + parentOf(e);
            Series s = open.get(key);
            if (s != null && Duration.between(last.get(key), e.at()).compareTo(ROLLUP_WINDOW) <= 0) {
                s.items().add(e); last.put(key, e.at());
            } else {
                Series ns = new Series(key, new ArrayList<>(List.of(e)));
                open.put(key, ns); last.put(key, e.at()); series.add(ns);
            }
        }
        for (Event e : E) if (e.at() == null) series.add(new Series(e.kind() + "|day|" + e.day(), new ArrayList<>(List.of(e))));
        return series;
    }

    // ═════════════════════════ §7.2 / §7.2a готово к выкатке ═════════════════════════

    record Ep(Instant start, Instant end) {}

    record Eval(Cat c, boolean absent, int oldOpen, int newOpen, int y, int yUnk, Instant rs, String ship, Release r) {
        static final Eval ABSENT = new Eval(null, true, 0, 0, 0, 0, null, null, null);
    }

    /** Цепочка задачи до t1 (JS: timelines фильтруются vf &lt; T1). */
    final class Rec {
        final TaskRecord t; final List<Version> tl; final List<Ep> eps;
        Rec(TaskRecord t) {
            this.t = t;
            this.tl = chain(t).stream().filter(v -> v.at().isBefore(in.t1())).toList();
            this.eps = episodes(tl);
        }
        Sprint sprint() { return t.sprintId() == null ? null : in.sprints().get(t.sprintId()); }
        List<Release> releases() {
            Sprint s = sprint();
            if (s == null || s.releases() == null) return List.of();
            List<Release> r = new ArrayList<>(s.releases().stream().filter(x -> x.date() != null).toList());
            r.sort(Comparator.comparing(Release::date).thenComparing(Release::uid));
            return r;
        }
    }

    static List<Ep> episodes(List<Version> tl) {
        List<Ep> eps = new ArrayList<>();
        Instant start = null;
        for (Version v : tl) {
            Cat c = cat3(v.status());
            if (c == Cat.READY) { if (start == null) start = v.at(); }
            else if (start != null) { eps.add(new Ep(start, v.at())); start = null; }
        }
        if (start != null) eps.add(new Ep(start, null));
        return eps;
    }

    /** Релиз известен только датой: к моменту t засчитывается, если его день раньше дня t; к t1 — если ≤ дня t1. */
    boolean countedBy(LocalDate relDate, Instant t) {
        return t.equals(in.t1()) ? !relDate.isAfter(d1) : relDate.isBefore(localDay(t));
    }

    Release firstQual(Rec rec, Instant epStart) {
        LocalDate dr = localDay(epStart);
        for (Release r : rec.releases()) if (!r.date().isBefore(dr)) return r;
        return null;
    }

    /** JS {@code linkInfo}: у спринта нет ни одной связи с релизом — «выкатка не определена». */
    static String linkKind(Rec rec) { return rec.releases().isEmpty() ? "nolink" : "ok"; }

    Eval evalAt(Rec rec, Instant t) {
        Version row = null;
        for (Version v : rec.tl) { if (v.at().isBefore(t)) row = v; else break; }
        if (row == null) return Eval.ABSENT;
        Cat c = cat3(row.status());
        if (c != Cat.READY) {
            int o = c == Cat.OPEN ? 1 : 0;
            return new Eval(c, false, o, o, 0, 0, null, null, null);
        }
        Ep ep = null;
        for (Ep e : rec.eps) if (e.start().isBefore(t)) ep = e;
        Release r = firstQual(rec, ep.start());
        if (r != null && countedBy(r.date(), t)) return new Eval(c, false, 1, 0, 0, 0, ep.start(), "shipped", r);
        int unk = (!"ok".equals(linkKind(rec)) && r == null) ? 1 : 0;
        return new Eval(c, false, 1, 1, 1, unk, ep.start(), unk == 1 ? "unknown" : "wait", r);
    }

    record Shipped(Ep ep, Release r) {}

    Shipped shippedBy(Rec rec, Instant t) {
        for (Ep ep : rec.eps) {
            if (!(ep.end() == null || ep.end().isAfter(in.t0())) || !ep.start().isBefore(t)) continue;
            Release r = firstQual(rec, ep.start());
            if (r != null && countedBy(r.date(), t)) return new Shipped(ep, r);
        }
        return null;
    }

    /** Была ли задача выпущена к моменту t (любой эпизод «готова», начавшийся раньше t). */
    boolean everShippedAt(Rec rec, Instant t) {
        for (Ep ep : rec.eps) {
            if (!ep.start().isBefore(t)) continue;
            Release r = firstQual(rec, ep.start());
            if (r != null && r.date().isBefore(localDay(t))) return true;
        }
        return false;
    }

    /** JS {@code dayBounds}: t0, местные полуночи внутри (t0, t1), t1. */
    List<Instant> dayBounds() {
        List<Instant> b = new ArrayList<>();
        b.add(in.t0());
        LocalDate d = localDay(in.t0()).plusDays(1);
        while (true) {
            Instant m = d.atStartOfDay(in.zone()).toInstant();
            if (!m.isBefore(in.t1())) break;
            if (m.isAfter(in.t0())) b.add(m);
            d = d.plusDays(1);
        }
        b.add(in.t1());
        return b;
    }

    /** Аккумулятор метрик задач по состоянию на t0/t1 (§7.2, 7.2a, 7.2c). */
    public static final class Part {
        public int n, unk;
        public int oO0, oO1, nO0, nO1, Y0, Y1, Yu1, S, C, A, oC, oA, W;
        public int reactEv, reactEl, aReact, doneEver;
        public int reactFromReady, reactFromClosed, reactAfterRelease;
        public final List<String> exS = new ArrayList<>(), exY = new ArrayList<>(), exA = new ArrayList<>(),
            exC = new ArrayList<>(), exReact = new ArrayList<>(), els = new ArrayList<>();
        public int burn() { return nO0 - nO1; }
        public int burnDict() { return oO0 - oO1; }
        public int z0() { return oO0 - nO0; }
        public int z1() { return oO1 - nO1; }
        public int dShip() { return burn() - burnDict(); }
        public int aNew() { return A - aReact; }

        void add(TaskState s) {
            n++;
            if (s.unknown) { unk++; return; }
            els.add("task:" + s.uid);
            oO0 += s.e0.oldOpen(); oO1 += s.e1.oldOpen(); nO0 += s.e0.newOpen(); nO1 += s.e1.newOpen();
            Y0 += s.e0.y(); Y1 += s.e1.y(); Yu1 += s.e1.yUnk();
            if (s.S) { S++; ex(exS, s.uid); }
            if (s.e1.y() == 1) ex(exY, s.uid);
            if (s.C) { C++; ex(exC, s.uid); }
            if (s.A) { A++; ex(exA, s.uid); }
            if (s.oC) oC++;
            if (s.oA) oA++;
            if (s.W) W++;
            if (s.reactEv > 0) { reactEv += s.reactEv; reactEl++; ex(exReact, s.uid); }
            reactFromReady += s.reactFromReady; reactFromClosed += s.reactFromClosed; reactAfterRelease += s.reactAfterRelease;
            if (s.A && s.reactEv > 0) aReact++;
            if (s.doneEver) doneEver++;
        }

        private static void ex(List<String> l, String uid) { if (l.size() < EXAMPLES) l.add(uid); }

        public Double reactRate() { return doneEver == 0 ? null : (double) reactEl / doneEver; }
    }

    /** Состояние одной задачи на всех границах дня. */
    static final class TaskState {
        String uid; boolean unknown;
        Eval e0, e1; Eval[] st; boolean[] sb;
        boolean C, A, oC, oA, S, W, doneEver;
        int reactEv, reactFromReady, reactFromClosed, reactAfterRelease;
        Shipped shippedAtT1;
    }

    /** Группа задач: итог, своё и общее (§7.2b), дневные ряды (только у «all»). */
    public static final class TaskGroup {
        public final String key;
        public final Part total = new Part(), own = new Part(), shared = new Part();
        public int[] dayNO, dayOO, dayY, dayYu, dayS;
        TaskGroup(String key) { this.key = key; }
    }

    public record Wait(String uid, String sprint, LocalDate ready, String release, LocalDate relDate, long days, Cat now) {}

    public record Oldest(String uid, String sprint, Instant since, double ageDays, String ship, String link) {}

    public static final class ShipModel {
        public List<Instant> bounds;
        public TaskGroup all;
        public final Map<String, Map<String, TaskGroup>> byAxis = new LinkedHashMap<>();
        /** Объединение общих задач по оси — для Burn^Σ = Σ own + Burn^{sh,∪} (§7.2b). */
        public final Map<String, Part> sharedUnion = new LinkedHashMap<>();
        public final List<Wait> waits = new ArrayList<>();
        public final List<Oldest> oldest = new ArrayList<>();
        public Double median;
        public int enteredReady, readyToClosedNoRel, nRecs;
        final List<TaskState> states = new ArrayList<>();
    }

    List<String> taskAxisValues(String axis, TaskRecord t) {
        return switch (axis) {
            case "project" -> { List<String> p = scopedProjects(taskProjects(t)); yield p.isEmpty() ? List.of(NOPROJ) : p; }
            case "sprint" -> List.of(t.sprintId() == null ? NOSPR : t.sprintId());
            case "component" -> { List<String> c = taskComponents(t); yield c.isEmpty() ? List.of(NOCOMP) : c; }
            case "milestone" -> { List<String> m = taskMilestones(t); yield m.isEmpty() ? List.of(NOMS) : m; }
            default -> throw new IllegalArgumentException(axis);
        };
    }

    List<String> scopedProjects(List<String> p) {
        if (in.scope() == null) return p;
        return p.stream().filter(in.scope()::contains).toList();
    }

    /** Задача проходит скоуп и фильтры осей задач (тип/автор/вид к состоянию не применимы). */
    boolean taskVisible(TaskRecord t, Query q) {
        if (in.scope() != null && scopedProjects(taskProjects(t)).isEmpty()) return false;
        if (!hit(q.projects(), taskAxisValues("project", t))) return false;
        if (!hit(q.sprints(), taskAxisValues("sprint", t))) return false;
        if (!hit(q.components(), taskAxisValues("component", t))) return false;
        if (!hit(q.milestones(), taskAxisValues("milestone", t))) return false;
        return q.els() == null || q.els().isEmpty() || q.els().contains("task:" + t.uid());
    }

    static boolean hit(Set<String> filter, List<String> values) {
        if (filter == null || filter.isEmpty()) return true;
        for (String v : values) if (filter.contains(v)) return true;
        return false;
    }

    /** JS {@code shipModel} + §7.2b + §7.2c. */
    ShipModel shipModel(Query q) {
        ShipModel M = new ShipModel();
        List<Instant> B = dayBounds(); int K = B.size();
        M.bounds = B;
        M.all = new TaskGroup("all");
        M.all.dayNO = new int[K]; M.all.dayOO = new int[K]; M.all.dayY = new int[K]; M.all.dayYu = new int[K]; M.all.dayS = new int[K - 1];
        for (String ax : TASK_AXES) { M.byAxis.put(ax, new TreeMap<>()); M.sharedUnion.put(ax, new Part()); }

        List<TaskRecord> tasks = new ArrayList<>(in.tasks());
        tasks.sort(Comparator.comparing(TaskRecord::uid));
        for (TaskRecord t : tasks) {
            if (!taskVisible(t, q)) continue;
            Rec rec = new Rec(t);
            M.nRecs++;
            TaskState s = new TaskState();
            s.uid = t.uid();
            s.st = new Eval[K];
            for (int k = 0; k < K; k++) s.st[k] = evalAt(rec, B.get(k));
            s.e0 = s.st[0]; s.e1 = s.st[K - 1];
            // Нет ни одной датированной версии или статус на t1 пуст — состояние неизвестно (JS: c === null).
            // Заведённая после t1 (все версии ≥ t1) — не «неизвестна», а отсутствует: нули.
            s.unknown = chain(t).isEmpty() || (!s.e1.absent() && s.e1.c() == null);
            if (!s.unknown) {
                s.sb = new boolean[K];
                for (int k = 0; k < K; k++) s.sb[k] = shippedBy(rec, B.get(k)) != null;
                s.C = s.e0.newOpen() == 1 && s.e1.newOpen() == 0;
                s.A = s.e0.newOpen() == 0 && s.e1.newOpen() == 1;
                s.oC = s.e0.oldOpen() == 1 && s.e1.oldOpen() == 0;
                s.oA = s.e0.oldOpen() == 0 && s.e1.oldOpen() == 1;
                s.S = !s.sb[0] && s.sb[K - 1];
                if (s.S) s.shippedAtT1 = shippedBy(rec, in.t1());
                // §7.2c: реактивации внутри P и знаменатель доли.
                Cat c0 = s.e0.absent() ? null : s.e0.c();
                s.doneEver = c0 == Cat.READY || c0 == Cat.CLOSED;
                Version prev = null;
                for (Version v : rec.tl) {
                    boolean inP = !v.at().isBefore(in.t0());
                    if (inP) {
                        Cat nc = cat3(v.status());
                        if (nc == Cat.READY || nc == Cat.CLOSED) s.doneEver = true;
                        if (prev != null && "reactivated".equals(kindOf(prev, v))) {
                            s.reactEv++;
                            Cat pc = cat3(prev.status());
                            if (everShippedAt(rec, v.at())) s.reactAfterRelease++;
                            else if (pc == Cat.READY) s.reactFromReady++;
                            else s.reactFromClosed++;
                        }
                        if (prev != null && "closed".equals(kindOf(prev, v)) || prev != null && "cancelled".equals(kindOf(prev, v))) s.W = true;
                        if (prev == null && nc == Cat.CLOSED) s.W = true;   // заведена сразу закрытой
                    }
                    prev = v;
                }
                if (rec.eps.stream().anyMatch(e -> !e.start().isBefore(in.t0()) && e.start().isBefore(in.t1()))) M.enteredReady++;
                for (Ep ep : rec.eps) {
                    if (ep.end() == null || ep.end().isBefore(in.t0()) || !ep.end().isBefore(in.t1())) continue;
                    Version nx = rec.tl.stream().filter(v -> v.at().equals(ep.end())).findFirst().orElse(null);
                    Release r = firstQual(rec, ep.start());
                    if (nx != null && cat3(nx.status()) == Cat.CLOSED && !(r != null && !r.date().isAfter(localDay(ep.end()))))
                        M.readyToClosedNoRel++;
                }
                if (s.S) {
                    Shipped h = s.shippedAtT1;
                    LocalDate ready = localDay(h.ep().start());
                    M.waits.add(new Wait(t.uid(), t.sprintId(), ready, h.r().uid(), h.r().date(),
                        ChronoUnit.DAYS.between(ready, h.r().date()), s.e1.c()));
                }
                if (s.e1.y() == 1)
                    M.oldest.add(new Oldest(t.uid(), t.sprintId(), s.e1.rs(),
                        Duration.between(s.e1.rs(), in.t1()).toMillis() / 86_400_000.0, s.e1.ship(), linkKind(rec)));
                for (int k = 0; k < K; k++) {
                    M.all.dayNO[k] += s.st[k].newOpen(); M.all.dayOO[k] += s.st[k].oldOpen();
                    M.all.dayY[k] += s.st[k].y(); M.all.dayYu[k] += s.st[k].yUnk();
                }
                for (int k = 0; k < K - 1; k++) if (!s.sb[k] && s.sb[k + 1]) M.all.dayS[k]++;
            }
            M.states.add(s);
            M.all.total.add(s);
            for (String ax : TASK_AXES) {
                List<String> keys = taskAxisValues(ax, t);
                boolean shared = keys.size() >= 2;
                for (String key : keys) {
                    TaskGroup g = M.byAxis.get(ax).computeIfAbsent(key, TaskGroup::new);
                    g.total.add(s);
                    (shared ? g.shared : g.own).add(s);
                }
                if (shared) M.sharedUnion.get(ax).add(s);
            }
        }
        M.waits.sort(Comparator.comparingLong(Wait::days).thenComparing(Wait::uid));
        int n = M.waits.size();
        M.median = n == 0 ? null : n % 2 == 1 ? (double) M.waits.get((n - 1) / 2).days()
            : (M.waits.get(n / 2 - 1).days() + M.waits.get(n / 2).days()) / 2.0;
        M.oldest.sort(Comparator.comparingDouble(Oldest::ageDays).reversed().thenComparing(Oldest::uid));
        return M;
    }

    // ═════════════════════════ §2 на сетке: дни × проекты ═════════════════════════

    public record MatrixRow(String day, List<int[]> cells, int ev, int el, int sumEv, int sumEl, int M, int extra, int maxEv, int maxEl) {}
    public record MatrixCol(String col, int ev, int el, int sumEv, int sumEl, int M, int extra) {}
    public record Matrix(int n, List<String> cols, List<MatrixRow> rows, List<MatrixCol> colT, int nProjects,
                         int ev, int el, int sumRowEv, int sumRowEl) {}

    /** JS {@code matrix}: top-N проектов по событиям + «прочие (k)». */
    Matrix matrix(List<Event> E, int N) {
        Map<String, Integer> act = new HashMap<>();
        for (Event e : E) for (String g : new LinkedHashSet<>(axisValues("project", e))) act.merge(g, 1, Integer::sum);
        List<String> ranked = new ArrayList<>(act.keySet());
        ranked.sort(Comparator.comparing((String g) -> -act.get(g)).thenComparing(g -> g));
        List<String> top = ranked.subList(0, Math.min(N, ranked.size()));
        String other = "(other:" + Math.max(0, ranked.size() - N) + ")";
        List<String> cols = new ArrayList<>(top);
        if (ranked.size() > N) cols.add(other);
        Set<String> topSet = new HashSet<>(top);
        Function<String, String> colOf = g -> topSet.contains(g) ? g : other;
        TreeSet<String> days = new TreeSet<>();
        for (Event e : E) days.add(String.valueOf(dayOf(e)));
        Map<String, int[]> cellEv = new HashMap<>(); Map<String, Set<String>> cellEl = new HashMap<>();
        Map<String, Integer> rowEv = new HashMap<>(), colEv = new HashMap<>();
        Map<String, Set<String>> rowEls = new HashMap<>(), colEls = new HashMap<>();
        Map<String, Map<String, Set<String>>> rowG = new HashMap<>(), colDays = new HashMap<>();
        for (Event e : E) {
            String d = String.valueOf(dayOf(e)), k = e.elKey();
            Set<String> cs = new LinkedHashSet<>();
            for (String g : axisValues("project", e)) cs.add(colOf.apply(g));
            rowEv.merge(d, 1, Integer::sum);
            rowEls.computeIfAbsent(d, x -> new HashSet<>()).add(k);
            Map<String, Set<String>> rg = rowG.computeIfAbsent(d, x -> new HashMap<>());
            rg.computeIfAbsent(k, x -> new HashSet<>());
            for (String c : cs) {
                rg.get(k).add(c);
                String ck = d + "\u0001" + c;
                cellEv.computeIfAbsent(ck, x -> new int[1])[0]++;
                cellEl.computeIfAbsent(ck, x -> new HashSet<>()).add(k);
                colEv.merge(c, 1, Integer::sum);
                colEls.computeIfAbsent(c, x -> new HashSet<>()).add(k);
                colDays.computeIfAbsent(c, x -> new HashMap<>()).computeIfAbsent(k, x -> new HashSet<>()).add(d);
            }
        }
        List<MatrixRow> rows = new ArrayList<>();
        for (String d : days) {
            List<int[]> cs = new ArrayList<>();
            int sumEv = 0, sumEl = 0, maxEv = 0, maxEl = 0;
            for (String c : cols) {
                String ck = d + "\u0001" + c;
                int ev = cellEv.containsKey(ck) ? cellEv.get(ck)[0] : 0, el = cellEl.containsKey(ck) ? cellEl.get(ck).size() : 0;
                cs.add(new int[]{ev, el}); sumEv += ev; sumEl += el; maxEv = Math.max(maxEv, ev); maxEl = Math.max(maxEl, el);
            }
            int M = 0, extra = 0;
            for (Set<String> s : rowG.get(d).values()) { if (s.size() >= 2) M++; extra += s.size() - 1; }
            rows.add(new MatrixRow(d, cs, rowEv.get(d), rowEls.get(d).size(), sumEv, sumEl, M, extra, maxEv, maxEl));
        }
        List<MatrixCol> colT = new ArrayList<>();
        for (int ci = 0; ci < cols.size(); ci++) {
            String c = cols.get(ci);
            int M = 0, extra = 0;
            for (Set<String> s : colDays.getOrDefault(c, Map.of()).values()) { if (s.size() >= 2) M++; extra += s.size() - 1; }
            int sumEl = 0, sumEv = 0;
            for (MatrixRow r : rows) { sumEl += r.cells().get(ci)[1]; sumEv += r.cells().get(ci)[0]; }
            colT.add(new MatrixCol(c, colEv.getOrDefault(c, 0), colEls.getOrDefault(c, Set.of()).size(), sumEv, sumEl, M, extra));
        }
        Set<String> allEls = new HashSet<>();
        for (Event e : E) allEls.add(e.elKey());
        return new Matrix(N, cols, rows, colT, ranked.size(), E.size(), allEls.size(),
            rows.stream().mapToInt(MatrixRow::ev).sum(), rows.stream().mapToInt(MatrixRow::el).sum());
    }

    // ═════════════════════════ §7.3 знания ═════════════════════════

    private static final Pattern PROP = Pattern.compile("^(PROPOSED|proposed|DRAFT|draft)$");
    private static final Pattern REJ  = Pattern.compile("^(rejected|REJECTED)$");
    private static final Pattern ACC  = Pattern.compile("^(ACCEPTED|accepted|fixed|done)$");
    private static final Pattern SUP  = Pattern.compile("^(SUPERSEDED|superseded|DEPRECATED|deprecated)$");

    static boolean m(Pattern p, String s) { return s != null && p.matcher(s.trim()).matches(); }

    public record Queue(String type, int q1, Integer q0, int q0lo, int q0hi, Integer flow, int flowLo, int flowHi,
                        int newAll, int newProp, int newDecided, int supNow, int supNew, int accNow, int noDate,
                        boolean exact, List<String> newIds) {}

    /** JS {@code knowledge().queue}: точно при истории статуса (S2-13), иначе диапазон. */
    Queue queue(String type) {
        List<Knowledge> list = in.knowledge().stream().filter(k -> type.equals(k.type()))
            .filter(k -> in.scope() == null || k.projects() == null || k.projects().stream().anyMatch(in.scope()::contains))
            .toList();
        List<Knowledge> ex = list.stream().filter(x -> x.created() != null && !x.created().isAfter(d1)).toList();
        int q1 = (int) ex.stream().filter(x -> m(PROP, x.status())).count();
        List<Knowledge> pre = ex.stream().filter(x -> x.created().isBefore(d0)).toList();
        List<Knowledge> newP = ex.stream().filter(x -> !x.created().isBefore(d0)).toList();
        int q0lo = (int) pre.stream().filter(x -> m(PROP, x.status())).count();
        int q0hi = q0lo + (int) pre.stream().filter(x -> !m(PROP, x.status())).count();
        Integer q0 = null, flow = null;
        boolean exact = kstatus.available(type);
        if (exact) {
            int c = 0; boolean all = true;
            for (Knowledge k : pre) {
                Optional<String> st = kstatus.statusAt(type, k.id(), in.t0());
                if (st.isEmpty()) { all = false; break; }
                if (m(PROP, st.get())) c++;
            }
            if (all) { q0 = c; flow = c - q1; } else exact = false;
        }
        return new Queue(type, q1, q0, q0lo, q0hi, flow, q0lo - q1, q0hi - q1, newP.size(),
            (int) newP.stream().filter(x -> m(PROP, x.status())).count(),
            (int) newP.stream().filter(x -> m(ACC, x.status()) || m(REJ, x.status())).count(),
            (int) list.stream().filter(x -> m(SUP, x.status())).count(),
            (int) newP.stream().filter(x -> m(SUP, x.status())).count(),
            (int) list.stream().filter(x -> m(ACC, x.status())).count(),
            (int) list.stream().filter(x -> x.created() == null).count(),
            exact, newP.stream().map(Knowledge::id).sorted().toList());
    }

    Map<String, Object> knowledge(List<Event> E) {
        Queue adr = queue("adr"), dec = queue("decision");
        Set<String> accAdr = new TreeSet<>();
        for (Knowledge k : in.knowledge()) if ("adr".equals(k.type()) && m(ACC, k.status())) accAdr.add(k.id());
        List<Event> adrCh = E.stream().filter(e -> "adr".equals(e.type()) && "changed".equals(e.kind())).toList();
        List<Event> rev = adrCh.stream().filter(e -> accAdr.contains(e.el())).toList();
        List<Event> specV = E.stream().filter(e -> "spec".equals(e.type()) && "version".equals(e.kind())).toList();
        Map<String, Integer> childByAdr = new HashMap<>();
        for (Knowledge k : in.knowledge()) if ("decision".equals(k.type()) && k.parent() != null) childByAdr.merge(k.parent(), 1, Integer::sum);
        List<Map<String, Object>> adrNewChildren = new ArrayList<>();
        for (String id : adr.newIds()) adrNewChildren.add(mapOf("id", id, "children", childByAdr.getOrDefault(id, 0)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("adr", queueMap(adr));
        out.put("decision", queueMap(dec));
        out.put("adr_revisions", pair(rev.size(), (int) rev.stream().map(Event::el).distinct().count()));
        out.put("adr_changes", pair(adrCh.size(), (int) adrCh.stream().map(Event::el).distinct().count()));
        out.put("spec_versions", pair(specV.size(), (int) specV.stream().map(Event::el).distinct().count()));
        out.put("spec_new", E.stream().filter(e -> "spec".equals(e.type()) && "created".equals(e.kind())).count());
        out.put("decisions_per_new_adr", adrNewChildren);
        // TODO(S2-13): реактивация ADR (§7.2c) — возврат «действует» → «на рассмотрении»
        // видна только по истории статуса; до S2-13 честно «не измерить».
        out.put("adr_reactivation", kstatus.available("adr") ? null : mapOf("measurable", false,
            "reason", "у ADR нет истории статуса — task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-13"));
        return out;
    }

    static Map<String, Object> queueMap(Queue q) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("exact", q.exact());
        m.put("q_t1", q.q1());
        if (q.exact()) { m.put("q_t0", q.q0()); m.put("flow", q.flow()); }
        else {
            m.put("q_t0_range", List.of(q.q0lo(), q.q0hi()));
            m.put("flow_range", List.of(q.flowLo(), q.flowHi()));
            m.put("reason", "нет истории статуса — точное значение после task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-10 и S2-13");
        }
        m.put("new", q.newAll()); m.put("new_proposed", q.newProp()); m.put("new_decided", q.newDecided());
        m.put("superseded_now", q.supNow()); m.put("superseded_new", q.supNew()); m.put("accepted_now", q.accNow());
        m.put("no_date", q.noDate());
        // TTD = median(t_accept − t_create) — нужен момент принятия, его нет до S2-13.
        m.put("ttd", q.exact() ? null : mapOf("measurable", false, "reason", "момент принятия неизвестен до S2-13"));
        return m;
    }

    // ═════════════════════════ фильтры и сборка ответа ═════════════════════════

    boolean matches(Event e, Query q) {
        if (!hit(q.types(), axisValues("type", e))) return false;
        if (!hit(q.projects(), axisValues("project", e))) return false;
        if (!hit(q.components(), axisValues("component", e))) return false;
        if (!hit(q.sprints(), axisValues("sprint", e))) return false;
        if (!hit(q.milestones(), axisValues("milestone", e))) return false;
        if (!hit(q.kinds(), axisValues("kind", e))) return false;
        if (q.authors() != null && !q.authors().isEmpty()
                && !q.authors().contains(authorClass(e)) && (e.who() == null || !q.authors().contains(e.who()))) return false;
        return q.els() == null || q.els().isEmpty() || q.els().contains(e.elKey());
    }

    /** Ядро метрик периода — его же движок предыдущего периода отдаёт для дельты (§7.5). */
    public static final class Core {
        public Prepared prepared;          // до фильтров
        public List<Event> E;              // после фильтров
        public GroupCount total;           // по оси запроса
        public ShipModel ship;
        public boolean tasksAvailable;
    }

    Core core(Query q) {
        Core c = new Core();
        c.prepared = prepare(periodEvents());
        c.E = c.prepared.E().stream().filter(e -> matches(e, q)).toList();
        c.total = groupCount(c.E, q.groupBy() == null ? "project" : q.groupBy());
        c.tasksAvailable = in.errors().stream().noneMatch(er -> er.critical() && er.source().startsWith("task"));
        c.ship = shipModel(q);
        return c;
    }

    /** Предыдущий такой же период (§7.5): день сравнивается с тем же днём прошлой недели. */
    Input previousInput() {
        Duration len = Duration.between(in.t0(), in.t1());
        Duration shift = len.compareTo(Duration.ofDays(1)) <= 0 ? Duration.ofDays(7) : len;
        return new Input(in.t0().minus(shift), in.t1().minus(shift), in.now(), in.zone(), in.tasks(), in.sprints(),
            in.otherEvents(), in.knowledge(), in.errors(), in.scope());
    }

    /** Полный ответ GET /lore/news/v2: {events, groups, metrics, meta}. */
    public Map<String, Object> compute(Query q) {
        if (q == null) q = Query.none();
        String axis = q.groupBy() == null ? "project" : q.groupBy();
        Core c = core(q);
        NewsV2Engine prevEngine = new NewsV2Engine(previousInput(), authors, kstatus);
        Core p = prevEngine.core(q);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("events", feedRows(c, q, axis));
        out.put("groups", groupsOut(c.E, axis, q.subBy()));
        Map<String, Object> metrics = metrics(c, p, q);
        out.put("metrics", metrics);
        if (q.matrixN() != null && q.matrixN() > 0) out.put("matrix", matrixOut(matrix(c.E, q.matrixN())));
        List<Map<String, Object>> checks = validate(c, q);
        out.put("meta", meta(c, q, checks));
        return out;
    }

    List<Map<String, Object>> feedRows(Core c, Query q, String axis) {
        Set<String> keep = new HashSet<>();
        for (Event e : c.E) keep.add(e.elKey() + "|" + e.kind() + "|" + dayOf(e));
        Map<String, Integer> seriesOf = new HashMap<>();
        List<Series> series = rollup(c.E);
        for (int i = 0; i < series.size(); i++) for (Event e : series.get(i).items()) seriesOf.put(eventId(e), i);
        List<Row> rows = new ArrayList<>(c.prepared.rows().stream().filter(r -> keep.contains(r.key())).toList());
        rows.sort(Comparator.comparing((Row r) -> sortKey(r.events().get(r.events().size() - 1))).reversed()
            .thenComparing(Row::key));
        LocalDate today = localDay(in.now());
        List<Map<String, Object>> out = new ArrayList<>();
        for (Row r : rows) {
            List<Event> evs = r.events().stream().filter(e -> matches(e, q)).toList();
            if (evs.isEmpty()) continue;
            Event last = evs.get(evs.size() - 1), first = evs.get(0);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", r.key());
            m.put("type", first.type()); m.put("el", first.el()); m.put("el_key", first.elKey());
            m.put("kind", first.kind()); m.put("title", first.title());
            m.put("day_local", String.valueOf(dayOf(first)));
            m.put("time_local", last.at() == null ? null : last.at().atZone(in.zone()).toLocalTime().withNano(0).toString().substring(0, 5));
            m.put("at_utc", last.at() == null ? null : last.at().toString());
            m.put("time_known", last.at() != null);
            m.put("mult", evs.size());
            m.put("projects", first.projects()); m.put("components", first.components());
            m.put("sprint", first.sprint()); m.put("milestones", first.milestones());
            m.put("groups_n", new LinkedHashSet<>(axisValues(axis, first)).size());
            m.put("author", authorClass(last)); m.put("who", last.who());
            m.put("from", first.fromStatus()); m.put("to", last.toStatus());
            m.put("parent", first.parent());
            Integer si = seriesOf.get(eventId(last));
            m.put("series", si == null ? null : "s" + si);
            // «Будущее» — позже текущего момента сервера (§4).
            m.put("future", last.at() != null ? last.at().isAfter(in.now()) : dayOf(last).isAfter(today));
            if (q.readMark() != null) m.put("unread", sortKey(last).isAfter(q.readMark()));
            out.add(m);
        }
        return out;
    }

    static String eventId(Event e) { return e.elKey() + "|" + e.kind() + "|" + e.at() + "|" + e.day(); }

    Map<String, Object> groupsOut(List<Event> E, String axis, String sub) {
        GroupCount R = groupCount(E, axis);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("axis", axis);
        out.put("element_level", ELEMENT_AXES.contains(axis));
        List<Map<String, Object>> list = new ArrayList<>();
        for (Group g : R.list()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", g.g()); m.put("events", g.ev()); m.put("elements", g.el()); m.put("multi", g.multi());
            m.put("agent_events", g.agEv()); m.put("agent_elements", g.agEl());
            m.put("filter", mapOf(axis, g.g()));
            if (sub != null && !sub.equals(axis)) {
                GroupCount S = groupCount(g.events(), sub);
                List<Map<String, Object>> subs = new ArrayList<>();
                for (Group x : S.list()) subs.add(mapOf("key", x.g(), "events", x.ev(), "elements", x.el(), "multi", x.multi()));
                m.put("sub", mapOf("axis", sub, "groups", subs, "total", pair(S.totEv(), S.totEl()), "multi_group_elements", S.M()));
            }
            list.add(m);
        }
        out.put("list", list);
        out.put("total", pair(R.totEv(), R.totEl()));
        out.put("sum", pair(R.list().stream().mapToInt(Group::ev).sum(), R.list().stream().mapToInt(Group::el).sum()));
        out.put("multi_group_elements", R.M());
        out.put("extra", R.extra());
        return out;
    }

    Map<String, Object> metrics(Core c, Core p, Query q) {
        Map<String, Object> m = new LinkedHashMap<>();
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("total", pair(c.E.size(), (int) c.E.stream().map(Event::elKey).distinct().count()));
        counts.put("by_type", byAxis(c.E, "type"));
        counts.put("by_kind", byAxis(c.E, "kind"));
        m.put("counts", counts);
        if (c.tasksAvailable) m.put("tasks", tasksOut(c.ship));
        else m.put("tasks", mapOf("available", false, "reason", "история задач недоступна — см. meta.errors"));
        m.put("knowledge", knowledge(c.E));
        GroupCount au = groupCount(c.E, "author");
        boolean measurable = c.E.stream().anyMatch(e -> e.agent() != null);
        m.put("agents", measurable
            ? mapOf("measurable", true, "events", pair(au.agEvT(), au.totEv()), "elements", pair(au.agElT(), au.totEl()))
            : mapOf("measurable", false, "reason", "автор версии не хранится — task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-12"));
        m.put("delta", delta(c, p));
        if (q.readMark() != null) {
            List<Event> fresh = c.E.stream().filter(e -> sortKey(e).isAfter(q.readMark())).toList();
            m.put("since_mark", mapOf("events", fresh.size(), "elements", (int) fresh.stream().map(Event::elKey).distinct().count(),
                "mark", q.readMark().toString()));
        }
        return m;
    }

    Map<String, Object> byAxis(List<Event> E, String axis) {
        Map<String, Object> out = new TreeMap<>();
        for (Group g : groupCount(E, axis).list()) out.put(g.g(), pair(g.ev(), g.el()));
        return out;
    }

    static Map<String, Object> partOut(Part x) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("burn", x.burn());
        m.put("burn_dict", x.burnDict());
        m.put("ship_correction", x.dShip());
        m.put("open_t0", x.nO0); m.put("open_t1", x.nO1);
        m.put("open_dict_t0", x.oO0); m.put("open_dict_t1", x.oO1);
        m.put("closed", x.C); m.put("added", x.A); m.put("added_new", x.aNew()); m.put("added_react", x.aReact);
        m.put("waiting_t0", x.Y0); m.put("waiting_t1", x.Y1); m.put("ship_unknown", x.Yu1);
        m.put("shipped", x.S); m.put("done_in_period", x.W);
        m.put("react", mapOf("events", x.reactEv, "elements", x.reactEl, "rate", x.reactRate(), "done_ever", x.doneEver,
            "from_ready", x.reactFromReady, "from_closed", x.reactFromClosed, "after_release", x.reactAfterRelease,
            "examples", x.exReact));
        m.put("unknown", x.unk);
        m.put("tasks", x.n);
        m.put("examples", mapOf("shipped", x.exS, "waiting", x.exY, "added", x.exA, "closed", x.exC));
        return m;
    }

    Map<String, Object> tasksOut(ShipModel M) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("available", true);
        out.put("all", partOut(M.all.total));
        Map<String, Object> axes = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, TaskGroup>> en : M.byAxis.entrySet()) {
            List<Map<String, Object>> groups = new ArrayList<>();
            for (TaskGroup g : en.getValue().values()) {
                Map<String, Object> gm = new LinkedHashMap<>();
                gm.put("key", g.key);
                gm.put("total", partOut(g.total));
                gm.put("own", partOut(g.own));
                gm.put("shared", partOut(g.shared));
                gm.put("filter", mapOf(en.getKey(), g.key));
                groups.add(gm);
            }
            int ownSum = en.getValue().values().stream().mapToInt(g -> g.own.burn()).sum();
            Part su = M.sharedUnion.get(en.getKey());
            axes.put(en.getKey(), mapOf("groups", groups, "burn_own_sum", ownSum, "burn_shared_union", su.burn(),
                "burn_sigma", ownSum + su.burn()));
        }
        out.put("by_axis", axes);
        List<Map<String, Object>> days = new ArrayList<>();
        int K = M.bounds.size();
        for (int k = 0; k < K - 1; k++) {
            days.add(mapOf("from", M.bounds.get(k).toString(), "to", M.bounds.get(k + 1).toString(),
                "day_local", String.valueOf(localDay(M.bounds.get(k))),
                "open_start", M.all.dayNO[k], "open_end", M.all.dayNO[k + 1],
                "burn", M.all.dayNO[k] - M.all.dayNO[k + 1], "burn_dict", M.all.dayOO[k] - M.all.dayOO[k + 1],
                "waiting_end", M.all.dayY[k + 1], "ship_unknown_end", M.all.dayYu[k + 1], "shipped", M.all.dayS[k]));
        }
        out.put("days", days);
        List<Map<String, Object>> waits = new ArrayList<>();
        for (Wait w : M.waits) waits.add(mapOf("uid", w.uid(), "sprint", w.sprint(), "ready", String.valueOf(w.ready()),
            "release", w.release(), "release_date", String.valueOf(w.relDate()), "days", w.days(), "now", String.valueOf(w.now())));
        out.put("shipped_list", waits);
        out.put("wait_median_days", M.median);
        List<Map<String, Object>> old = new ArrayList<>();
        for (Oldest o : M.oldest.subList(0, Math.min(15, M.oldest.size())))
            old.add(mapOf("uid", o.uid(), "sprint", o.sprint(), "since", o.since().toString(), "age_days", o.ageDays(),
                "ship", o.ship(), "link", o.link()));
        out.put("waiting_oldest", old);
        out.put("entered_ready", M.enteredReady);
        out.put("ready_to_closed_no_release", M.readyToClosedNoRel);
        return out;
    }

    /** §7.5: Δf = f(P) − f(P⁻); проценты — только при f(P⁻) ≥ 5. */
    Map<String, Object> delta(Core c, Core p) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("events", dv(c.E.size(), p.E.size()));
        d.put("elements", dv((int) c.E.stream().map(Event::elKey).distinct().count(), (int) p.E.stream().map(Event::elKey).distinct().count()));
        Map<String, Object> types = new TreeMap<>();
        Map<String, Integer> ct = new HashMap<>(), pt = new HashMap<>();
        for (Event e : c.E) ct.merge(e.type(), 1, Integer::sum);
        for (Event e : p.E) pt.merge(e.type(), 1, Integer::sum);
        Set<String> keys = new TreeSet<>(ct.keySet()); keys.addAll(pt.keySet());
        for (String k : keys) types.put(k, dv(ct.getOrDefault(k, 0), pt.getOrDefault(k, 0)));
        d.put("by_type", types);
        if (c.tasksAvailable) {
            Part a = c.ship.all.total, b = p.ship.all.total;
            d.put("burn", dv(a.burn(), b.burn()));
            d.put("waiting_t1", dv(a.Y1, b.Y1));
            d.put("shipped", dv(a.S, b.S));
            d.put("react_events", dv(a.reactEv, b.reactEv));
            d.put("react_elements", dv(a.reactEl, b.reactEl));
        }
        d.put("previous", mapOf("from", previousInput().t0().toString(), "to", previousInput().t1().toString()));
        return d;
    }

    static Map<String, Object> dv(int cur, int prev) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("value", cur); m.put("previous", prev); m.put("delta", cur - prev);
        m.put("pct", prev >= 5 ? Math.round((cur - prev) * 1000.0 / prev) / 10.0 : null);
        return m;
    }

    Map<String, Object> matrixOut(Matrix mx) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (MatrixRow r : mx.rows()) {
            List<List<Integer>> cells = new ArrayList<>();
            for (int[] x : r.cells()) cells.add(List.of(x[0], x[1]));
            rows.add(mapOf("day", r.day(), "cells", cells, "total", pair(r.ev(), r.el()), "sum", pair(r.sumEv(), r.sumEl()),
                "multi", r.M(), "extra", r.extra()));
        }
        List<Map<String, Object>> cols = new ArrayList<>();
        for (MatrixCol c : mx.colT()) cols.add(mapOf("col", c.col(), "total", pair(c.ev(), c.el()), "sum", pair(c.sumEv(), c.sumEl()),
            "multi", c.M(), "extra", c.extra()));
        return mapOf("n", mx.n(), "cols", mx.cols(), "rows", rows, "col_totals", cols, "projects", mx.nProjects(),
            "total", pair(mx.ev(), mx.el()), "sum_rows", pair(mx.sumRowEv(), mx.sumRowEl()));
    }

    Map<String, Object> meta(Core c, Query q, List<Map<String, Object>> checks) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("generated_at", in.now().toString());
        meta.put("scope", in.scope() == null ? mapOf("applied", false)
            : mapOf("applied", true, "projects", in.scope().size()));
        meta.put("period", mapOf("from", in.t0().toString(), "to", in.t1().toString(), "tz", in.zone().getId(),
            "days_local", List.of(String.valueOf(d0), String.valueOf(d1))));
        meta.put("total", mapOf("events", c.E.size(), "elements", (int) c.E.stream().map(Event::elKey).distinct().count()));
        meta.put("multi_group_elements", c.total.M());
        int rows = (int) c.prepared.rows().stream().filter(r -> r.events().stream().anyMatch(e -> matches(e, q))).count();
        meta.put("truncated", q.limit() != null && rows > q.limit());
        List<Map<String, Object>> errs = new ArrayList<>();
        for (NewsV2.SourceError e : in.errors()) errs.add(mapOf("source", e.source(), "error", e.error(), "critical", e.critical()));
        meta.put("errors", errs);
        // S7A-07: «источник недоступен» ≠ «ничего не было».
        String state = in.errors().stream().anyMatch(NewsV2.SourceError::critical) ? "partial"
            : !in.errors().isEmpty() ? "partial" : c.E.isEmpty() ? "empty" : "ok";
        meta.put("state", state);
        boolean ok = checks.stream().noneMatch(x -> Boolean.FALSE.equals(x.get("ok")));
        List<Map<String, Object>> drift = new ArrayList<>();
        for (Map<String, Object> x : checks)
            if (Boolean.FALSE.equals(x.get("ok")) && "10.2".equals(String.valueOf(x.get("inv")))) drift.add(x);
        meta.put("validation", mapOf("ok", ok, "checks", checks, "drift", drift));
        meta.put("dropped_changed_on_created_day", c.prepared.dropped().size());
        meta.put("algorithm", "SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0");
        return meta;
    }

    // ═════════════════════════ §10 валидация ═════════════════════════

    /** JS {@code validate} + инварианты 9–12 v1.1–1.3 + сверка §10.2 «снимок ↔ события». */
    List<Map<String, Object>> validate(Core c, Query q) {
        List<Map<String, Object>> checks = new ArrayList<>();
        List<Event> E = c.E;
        for (String axis : AXES) {
            GroupCount R = groupCount(E, axis);
            List<String> bad1 = R.list().stream().filter(g -> g.ev() < g.el()).map(Group::g).toList();
            push(checks, 1, "N_ev ≥ N_el — " + axis, bad1.isEmpty() && R.totEv() >= R.totEl(),
                "групп " + R.list().size() + ", итог " + R.totEv() + " · " + R.totEl(), bad1);
            int maxEv = R.list().stream().mapToInt(Group::ev).max().orElse(0), maxEl = R.list().stream().mapToInt(Group::el).max().orElse(0);
            int sumEv = R.list().stream().mapToInt(Group::ev).sum(), sumEl = R.list().stream().mapToInt(Group::el).sum();
            push(checks, 2, "max ≤ итог ≤ сумма — " + axis,
                maxEv <= R.totEv() && R.totEv() <= sumEv && maxEl <= R.totEl() && R.totEl() <= sumEl,
                "события " + maxEv + " ≤ " + R.totEv() + " ≤ " + sumEv + "; элементы " + maxEl + " ≤ " + R.totEl() + " ≤ " + sumEl, List.of());
            push(checks, 3, "Σ N_el(g) − N_el = Σ(|G(x)|−1) — " + axis, sumEl - R.totEl() == R.extra(),
                sumEl + " − " + R.totEl() + " = " + (sumEl - R.totEl()) + "; Σ(|G|−1) = " + R.extra() + "; M = " + R.M(), List.of());
            boolean sharesOk = R.list().stream().allMatch(g -> g.agEv() <= g.ev() && g.agEl() <= g.el());
            push(checks, 7, "доли ∈ [0,1] — " + axis, sharesOk, "агентских событий " + R.agEvT() + " из " + R.totEv(), List.of());
            if ("project".equals(axis)) {
                List<Series> S = rollup(E);
                int rEv = S.stream().mapToInt(x -> x.items().size()).sum();
                long rEl = S.stream().flatMap(x -> x.items().stream()).map(Event::elKey).distinct().count();
                push(checks, 8, "свёртка не меняет чисел (итог)", rEv == R.totEv() && rEl == R.totEl(),
                    "серий " + S.size() + "; по сериям " + rEv + " · " + rEl + ", без свёртки " + R.totEv() + " · " + R.totEl(), List.of());
                boolean okSub = true; List<String> exs = new ArrayList<>();
                for (Group g : R.list()) {
                    GroupCount sub = groupCount(g.events(), "component");
                    int s2 = sub.list().stream().mapToInt(Group::el).sum();
                    if (!(sub.totEl() == g.el() && s2 - sub.totEl() == sub.extra() && sub.list().stream().allMatch(x -> x.ev() >= x.el()))) {
                        okSub = false; exs.add(g.g());
                    }
                }
                push(checks, 3, "подгруппировка проект → компонент: те же правила на каждом уровне", okSub,
                    R.list().size() + " проектов проверено", exs);
            }
        }
        int kindSum = groupCount(E, "kind").list().stream().mapToInt(Group::ev).sum();
        int typeSum = groupCount(E, "type").list().stream().mapToInt(Group::ev).sum();
        push(checks, 6, "разбивки по видам и по типам в сумме дают N_ev", kindSum == E.size() && typeSum == E.size(),
            "по видам " + kindSum + ", по типам " + typeSum + ", N_ev " + E.size(), List.of());

        if (c.tasksAvailable) validateTasks(checks, c.ship);

        Queue adr = queue("adr"), dec = queue("decision");
        for (Queue k : List.of(adr, dec)) {
            if (k.exact()) push(checks, 5, k.type() + ": Flow = Q(t0) − Q(t1)", Objects.equals(k.flow(), k.q0() - k.q1()),
                "Q(t0) = " + k.q0() + ", Q(t1) = " + k.q1(), List.of());
            else pushNull(checks, 5, k.type() + ": Flow = Acc + Rej − New = Q(t0) − Q(t1)",
                "не вычисляется: нет истории статуса (TODO S2-10/S2-13). Q(t1) = " + k.q1() + "; Q(t0) ∈ [" + k.q0lo() + ", " + k.q0hi() + "]");
        }
        return checks;
    }

    void validateTasks(List<Map<String, Object>> checks, ShipModel M) {
        Part a = M.all.total;
        int K = M.bounds.size();
        // 4: Burn = C − A = O(t0) − O(t1), новое и старое правило, все группы.
        List<String> bad4 = new ArrayList<>(), bad4d = new ArrayList<>(), bad9 = new ArrayList<>(), bad10 = new ArrayList<>(),
            bad12 = new ArrayList<>();
        List<Map.Entry<String, Part>> parts = new ArrayList<>();
        parts.add(Map.entry("all", a));
        for (Map.Entry<String, Map<String, TaskGroup>> en : M.byAxis.entrySet())
            for (TaskGroup g : en.getValue().values()) {
                parts.add(Map.entry(en.getKey() + ":" + g.key, g.total));
                parts.add(Map.entry(en.getKey() + ":" + g.key + "/own", g.own));
                parts.add(Map.entry(en.getKey() + ":" + g.key + "/shared", g.shared));
            }
        for (Map.Entry<String, Part> en : parts) {
            Part x = en.getValue();
            if (x.burn() != x.C - x.A) bad4.add(en.getKey());
            if (x.burnDict() != x.oC - x.oA) bad4d.add(en.getKey());
            if (!(x.Y0 >= 0 && x.Y0 <= x.nO0 && x.Y1 >= 0 && x.Y1 <= x.nO1 && x.Yu1 <= x.Y1)) bad9.add(en.getKey());
            if (x.burn() - x.burnDict() != x.z1() - x.z0()) bad10.add(en.getKey());
            Double rate = x.reactRate();
            if (!(x.reactEv >= x.reactEl && x.A == x.aNew() + x.aReact && (rate == null || (rate >= 0 && rate <= 1))
                && x.reactFromReady + x.reactFromClosed + x.reactAfterRelease == x.reactEv)) bad12.add(en.getKey());
        }
        push(checks, 4, "Burn = C − A = O(t0) − O(t1) по правилу §7.2a (итог, группы, своё/общее)", bad4.isEmpty(),
            "итог: " + a.nO0 + " − " + a.nO1 + " = " + a.burn() + "; C − A = " + a.C + " − " + a.A + "; неизвестно: " + a.unk, bad4);
        push(checks, 4, "Burn по словарю = C − A по словарю (готова = открыта)", bad4d.isEmpty(),
            "итог: " + a.oO0 + " − " + a.oO1 + " = " + a.burnDict() + "; C − A = " + a.oC + " − " + a.oA, bad4d);
        if (a.unk > 0) push(checks, 4, "состояние на t0 известно для всех задач", false,
            a.unk + " задач без датированной версии — в O(t) не входят", List.of());
        int[] dS = M.all.dayS;
        int sSum = Arrays.stream(dS).sum();
        push(checks, 4, "сумма дневных S = недельному S (доехавшие считаются один раз)", sSum == a.S && a.S == M.waits.size(),
            "Σ S по дням = " + sSum + "; S = " + a.S + "; доехавших = " + M.waits.size(), List.of());
        int burnDays = 0;
        for (int k = 0; k < K - 1; k++) burnDays += M.all.dayNO[k] - M.all.dayNO[k + 1];
        push(checks, 4, "сгорание по дням телескопично", burnDays == a.burn(), "Σ дневных Burn = " + burnDays + "; Burn = " + a.burn(), List.of());
        push(checks, 9, "0 ≤ Y ≤ O — итог и каждая группа", bad9.isEmpty(),
            "итог: Y(t0) = " + a.Y0 + " ≤ O(t0) = " + a.nO0 + ", Y(t1) = " + a.Y1 + " ≤ O(t1) = " + a.nO1, bad9);
        push(checks, 10, "Burn − Burn^dict = Z(t1) − Z(t0) (поправка выкатки)", bad10.isEmpty(),
            "итог: " + a.burn() + " − " + a.burnDict() + " = " + a.dShip() + "; Z(t1) − Z(t0) = " + a.z1() + " − " + a.z0(), bad10);
        List<String> bad11 = new ArrayList<>();
        for (Map.Entry<String, Map<String, TaskGroup>> en : M.byAxis.entrySet()) {
            for (TaskGroup g : en.getValue().values())
                if (g.total.burn() != g.own.burn() + g.shared.burn()) bad11.add(en.getKey() + ":" + g.key);
            int ownSum = en.getValue().values().stream().mapToInt(g -> g.own.burn()).sum();
            if (ownSum + M.sharedUnion.get(en.getKey()).burn() != a.burn()) bad11.add(en.getKey() + ": Σ own + ∪ shared ≠ итог");
        }
        push(checks, 11, "Burn_g = своё + общее; итог = Σ своих + объединение общих", bad11.isEmpty(),
            "осей " + M.byAxis.size(), bad11);
        push(checks, 12, "React^ev ≥ React^el; A = A^new + A^react; 0 ≤ ReactRate ≤ 1", bad12.isEmpty(),
            "итог: реактиваций " + a.reactEv + " · " + a.reactEl + ", A = " + a.aNew() + " + " + a.aReact, bad12);
        List<String> unkY = M.oldest.stream().filter(o -> "unknown".equals(o.ship())).map(Oldest::uid).toList();
        if (unkY.isEmpty()) push(checks, "7.2a", "выкатка определена для всех ждущих задач", true, "все ждущие — со связью", List.of());
        else pushNull(checks, "7.2a", "выкатка определена для всех ждущих задач",
            "не смогли определить выкатку у " + unkY.size() + " из " + M.oldest.size() + " ждущих: у спринта нет связи с релизом");

        // §10.2: два расчёта — по снимку и по событиям.
        List<String> drift = new ArrayList<>(), replayBad = new ArrayList<>();
        int checked = 0;
        Map<String, TaskRecord> byUid = new HashMap<>();
        for (TaskRecord t : in.tasks()) byUid.put(t.uid(), t);
        for (TaskState s : M.states) {
            if (s.unknown) continue;
            TaskRecord t = byUid.get(s.uid);
            List<Version> all = chain(t);
            if (t.snapshotStatus() != null && !all.isEmpty()) {
                checked++;
                // Последняя версия вообще (в т.ч. после t1) ↔ снимок открытой строки.
                Cat last = cat3(all.get(all.size() - 1).status()), snap = cat3(t.snapshotStatus());
                if (last != snap) drift.add(s.uid);
            }
            // Проигрывание: состояние t0 + события периода = состояние t1.
            Cat state = s.e0.absent() ? null : s.e0.c();
            Version prev = null;
            for (Version v : all) {
                if (!v.at().isBefore(in.t1())) break;
                if (!v.at().isBefore(in.t0())) {
                    String k = kindOf(prev, v);
                    state = switch (k) {
                        case "closed", "cancelled" -> Cat.CLOSED;
                        case "ready" -> Cat.READY;
                        case "reactivated" -> Cat.OPEN;
                        default -> cat3(v.status()) == null ? state : cat3(v.status());
                    };
                }
                prev = v;
            }
            Cat t1c = s.e1.absent() ? null : s.e1.c();
            if (!Objects.equals(state, t1c)) replayBad.add(s.uid);
        }
        push(checks, "10.2", "статус: история ↔ снимок открытой строки (all_tasks)", drift.isEmpty(),
            "сверено " + checked + " задач; расхождений " + drift.size(), drift);
        push(checks, "10.2", "O(t1): состояние t0 + проигрывание событий ↔ цепочка на t1", replayBad.isEmpty(),
            "проиграно " + M.states.size() + " задач; расхождений " + replayBad.size(), replayBad);
    }

    static void push(List<Map<String, Object>> checks, Object inv, String name, boolean ok, String detail, List<String> ex) {
        checks.add(mapOf("inv", String.valueOf(inv), "name", name, "ok", ok, "detail", detail,
            "examples", ex.subList(0, Math.min(EXAMPLES, ex.size()))));
    }

    /** «Не смогли проверить» ≠ «проверено»: ok = null, жёлтое. */
    static void pushNull(List<Map<String, Object>> checks, Object inv, String name, String detail) {
        Map<String, Object> m = mapOf("inv", String.valueOf(inv), "name", name, "detail", detail, "examples", List.of());
        m.put("ok", null);
        checks.add(m);
    }

    // ═════════════════════════ утилиты ═════════════════════════

    static Map<String, Object> pair(int ev, int el) { return mapOf("events", ev, "elements", el); }

    /** LinkedHashMap из пар (null-значения допустимы, в отличие от Map.of). */
    static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }
}
