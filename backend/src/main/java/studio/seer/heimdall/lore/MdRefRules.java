package studio.seer.heimdall.lore;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-20 — правила ссылок на объекты LORE в MD, чистая часть.
 *
 * <p>Порт {@code scripts/md-refs-fix/md_refs_fix.py} (PU-19) плюс контекст записи, о котором
 * спросила владелица 13.11.2026: «у сомнительных проверь нельзя ли косвенно (привязано к проекту
 * компоненту уменьшить неоднозначность?)». Тест-примеры общие с Python — {@code shared/md-refs/cases.json}.
 *
 * <p>Однозначное переписывается в {@code [[тип:ID]]} (правила — {@link #RULES}); остальное — {@link Issue}
 * для раздела админки «Привести в порядок». Внешние ссылки не считаются вовсе (владелица 13.11:
 * «внешние ссылки MD должно не быть багом и не быть лишним шумом»). Блоки кода не трогаются.
 */
final class MdRefRules {

    private MdRefRules() {}

    /** Правила автопочинки. lone_unique по умолчанию выключено: код один в базе, но контекст его не подтвердил. */
    static final List<String> RULES = List.of("shape", "typed", "wrong_type", "wiki", "escaped", "lore_url",
        "lone_own_sprint", "lone_ctx", "lone_unique_ctx", "lone_unique");
    static final Set<String> DEFAULT_OFF = Set.of("lone_unique");

    /** Типы, которые читатели открывают по {@code тип:ID} (список splitLoreRefs). */
    static final List<String> TYPED = List.of("task", "adr", "spec", "decision", "sprint", "release", "doc", "runbook",
        "component", "uc", "feature", "question", "pain", "gain", "job", "actor", "agent_actor");

    private static final int U = Pattern.UNICODE_CHARACTER_CLASS;
    private static final List<Map.Entry<String, Pattern>> FAMILIES = List.of(
        Map.entry("adr", Pattern.compile("ADR-[A-Z0-9]+-\\d+[A-Z0-9-]*")),
        Map.entry("decision", Pattern.compile("D-\\d{4}-[A-Z0-9-]+")),
        Map.entry("spec", Pattern.compile("SPEC-[A-Z0-9-]+")),
        Map.entry("runbook", Pattern.compile("RUNBOOK-[A-Z0-9-]+")),
        Map.entry("pain", Pattern.compile("PAIN-[A-Z0-9-]+")),
        Map.entry("gain", Pattern.compile("GAIN-[A-Z0-9-]+")),
        Map.entry("uc", Pattern.compile("UC-[A-Z0-9-]+")),
        Map.entry("feature", Pattern.compile("FEAT-[A-Z0-9-]+")),
        Map.entry("actor", Pattern.compile("ACT-[A-Z0-9-]+")),
        Map.entry("agent_actor", Pattern.compile("AGENT-[A-Za-z0-9_-]+")),
        Map.entry("question", Pattern.compile("Q-[A-Z][A-Z0-9-]{2,}")));
    private static final List<Map.Entry<String, Pattern>> SHAPES;
    static {
        List<Map.Entry<String, Pattern>> s = new ArrayList<>();
        s.add(Map.entry("task", Pattern.compile("SPRINT_[A-Z0-9_]+/[A-Za-z0-9._-]+")));
        s.add(Map.entry("sprint", Pattern.compile("SPRINT_[A-Z0-9_]+")));
        s.addAll(FAMILIES);
        SHAPES = List.copyOf(s);
    }
    private static final String TRAIL = ".,;:!?)]}»\"'";
    private static final Pattern ID_CHAR = Pattern.compile("[A-Za-z0-9_\\-/.@]");
    private static final Pattern FENCE = Pattern.compile("^ {0,3}(`{3,}|~{3,})");
    private static final Pattern INLINE = Pattern.compile("(`+)([\\s\\S]*?[^`])\\1(?!`)");
    private static final Pattern ESC_WIKI = Pattern.compile("\\\\\\[\\\\\\[([^\\[\\]\\n\\\\]{1,200})\\\\\\]\\\\\\]");
    private static final Pattern WIKI = Pattern.compile("\\[\\[([^\\[\\]\\n]{1,200})\\]\\]");
    private static final Pattern MD_LINK = Pattern.compile("\\[([^\\]\\n]{1,200})\\]\\((https?://[^)\\s]+|/lore\\?[^)\\s]+)\\)");
    private static final Pattern URL = Pattern.compile("https?://[^\\s<>()\\]`\"']+|(?<![\\w/])/lore\\?[^\\s<>()\\]`\"']+", U);
    private static final Pattern TYPED_RE = Pattern.compile("(?<!\\w)(" + String.join("|", TYPED) + "):([A-Za-z0-9._/#-]+)",
        U | Pattern.CASE_INSENSITIVE);
    private static final Pattern TYPED_FULL = Pattern.compile("^([a-z_]+):(.+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern LONE = Pattern.compile("(?<![\\w/.#@:-])([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(?![\\w/-])", U);
    private static final Pattern CODE_FULL = Pattern.compile("[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+");
    private static final Pattern DOC_SLUG = Pattern.compile("^[a-z0-9]+(_[a-z0-9]+)+$");
    private static final Pattern WORD_AFTER = Pattern.compile("[A-Za-z0-9_]");

    // ───────────────────────────── контекст ─────────────────────────────

    /** Привязки записи: проекты (slug) и компоненты. */
    record Scope(Set<String> projects, Set<String> components) {
        static final Scope NONE = new Scope(Set.of(), Set.of());
        boolean empty() { return projects.isEmpty() && components.isEmpty(); }
    }

    /**
     * Что известно о базе: ID по типам, коды задач, прочие ID (инсайты, гейты…) и — если есть —
     * привязки спринтов и задач. {@code sprintScope == null} — контекста нет вовсе (режим скрипта).
     */
    static final class Ctx {
        final Map<String, Set<String>> ids;
        final Set<String> other;
        final Map<String, List<String>> codes = new TreeMap<>();
        final Map<String, Scope> sprintScope;
        final Map<String, Set<String>> taskComponents;

        Ctx(Map<String, Set<String>> ids, Set<String> other, Map<String, Scope> sprintScope, Map<String, Set<String>> taskComponents) {
            this.ids = ids;
            this.other = other == null ? Set.of() : other;
            this.sprintScope = sprintScope;
            this.taskComponents = taskComponents == null ? Map.of() : taskComponents;
            List<String> uids = new ArrayList<>(ids.getOrDefault("task", Set.of()));
            Collections.sort(uids);
            for (String uid : uids) {
                int i = uid.indexOf('/');
                if (i > 0) codes.computeIfAbsent(uid.substring(i + 1), k -> new ArrayList<>()).add(uid);
            }
        }

        boolean has(String type, String id) { return ids.getOrDefault(type, Set.of()).contains(id); }

        /** Тип, под которым запись есть: подсказка, иначе единственный другой тип. */
        String resolve(String id, String hint) {
            if (hint != null && has(hint, id)) return hint;
            String found = null;
            for (String t : TYPED) {
                if (t.equals(hint) || !has(t, id)) continue;
                if (found != null) return null;
                found = t;
            }
            return found;
        }

        boolean anyId(String id) {
            if (other.contains(id)) return true;
            for (Set<String> s : ids.values()) if (s.contains(id)) return true;
            return false;
        }

        Scope taskScope(String uid) {
            Scope sp = sprintScope == null ? Scope.NONE : sprintScope.getOrDefault(uid.substring(0, uid.indexOf('/')), Scope.NONE);
            Set<String> comps = new HashSet<>(sp.components());
            comps.addAll(taskComponents.getOrDefault(uid, Set.of()));
            return new Scope(sp.projects(), comps);
        }
    }

    /** Разрешение одинокого кода: правило автопочинки или подсказка-кандидаты. */
    record Lone(String uid, String rule, List<String> suggest) {}

    static Lone lone(String code, Ctx ctx, String ownerSprint, Scope rec) {
        List<String> uids = ctx.codes.get(code);
        if (uids == null || typeFromShape(code) != null) return null;
        if (ownerSprint != null && uids.contains(ownerSprint + "/" + code)) return new Lone(ownerSprint + "/" + code, "lone_own_sprint", List.of());
        boolean withCtx = ctx.sprintScope != null && rec != null && !rec.empty();
        if (!withCtx) {
            return uids.size() == 1 ? new Lone(uids.get(0), "lone_unique", List.of()) : new Lone(null, null, List.of());
        }
        List<String> byProject = new ArrayList<>(), byComponent = new ArrayList<>();
        for (String u : uids) {
            Scope s = ctx.taskScope(u);
            if (!Collections.disjoint(rec.projects(), s.projects())) byProject.add(u);
            if (!Collections.disjoint(rec.components(), s.components())) byComponent.add(u);
        }
        if (uids.size() == 1) {
            boolean confirmed = !byProject.isEmpty() || !byComponent.isEmpty();
            return new Lone(uids.get(0), confirmed ? "lone_unique_ctx" : "lone_unique", List.of());
        }
        if (!byProject.isEmpty()) {
            List<String> both = byProject.stream().filter(byComponent::contains).toList();
            if (both.size() == 1) return new Lone(both.get(0), "lone_ctx", List.of());
            if (byProject.size() == 1) return new Lone(byProject.get(0), "lone_ctx", List.of());
            return new Lone(null, null, both.isEmpty() ? byProject : both);
        }
        if (!byComponent.isEmpty()) return new Lone(null, null, byComponent);   // только компонент — подсказка
        return new Lone(null, null, List.of());
    }

    // ───────────────────────────── разбор ─────────────────────────────

    record Change(String rule, String id, String oldText, String newText) {}

    /** Место для раздела «Вручную»: kind — ambiguous_code | no_record | backtick | broken | unknown | lore_url. */
    record Issue(String kind, String id, int start, String snippet, List<String> suggest) {}

    record Result(String text, List<Change> changes, List<Issue> issues) {}

    static String typeFromShape(String id) {
        if (id.startsWith("SPRINT_")) return id.contains("/") ? "task" : "sprint";
        for (Map.Entry<String, Pattern> f : FAMILIES) if (f.getValue().matcher(id).matches()) return f.getKey();
        return null;
    }

    static String stripTrail(String s) {
        int n = s.length();
        while (n > 0 && TRAIL.indexOf(s.charAt(n - 1)) >= 0) n--;
        return s.substring(0, n);
    }

    static boolean isLoreUrl(String u) {
        return Pattern.compile("(/lore\\?|[?&](open|passport)=)", Pattern.CASE_INSENSITIVE).matcher(u).find()
            && Pattern.compile("(:44\\d\\d\\b|new\\.lore|lore\\.odal|^/lore\\?|localhost|127\\.0\\.0\\.1|192\\.168\\.)",
                Pattern.CASE_INSENSITIVE).matcher(u).find();
    }

    private static String wiki(String type, String id) { return "[[" + type + ":" + id + "]]"; }

    static String baseRule(String rule) {
        String r = rule.startsWith("backtick_") ? rule.substring("backtick_".length()) : rule;
        return r.endsWith("_wiki") ? r.substring(0, r.length() - "_wiki".length()) : r;
    }

    /** Разбор одного MD-тела. enabled — включённые правила; выключенное оставляет место и даёт Issue. */
    static Result fix(String text, Ctx ctx, String ownerSprint, Scope rec, Set<String> enabled) {
        return new Run(text, ctx, ownerSprint, rec, enabled).go();
    }

    private static final class Run {
        final String text; final Ctx ctx; final String owner; final Scope rec; final Set<String> enabled;
        final List<int[]> claimed = new ArrayList<>();
        final List<Object[]> edits = new ArrayList<>();   // start, end, new, rule, id
        final List<Issue> issues = new ArrayList<>();
        final List<int[]> prose = new ArrayList<>();

        Run(String text, Ctx ctx, String owner, Scope rec, Set<String> enabled) {
            this.text = text == null ? "" : text; this.ctx = ctx; this.owner = owner;
            this.rec = rec == null ? Scope.NONE : rec; this.enabled = enabled;
        }

        boolean free(int s, int e) { for (int[] c : claimed) if (!(e <= c[0] || s >= c[1])) return false; return true; }
        void protect(int s, int e) { claimed.add(new int[]{s, e}); }
        void issue(String kind, String id, int s, int e, List<String> sug) {
            int a = Math.max(0, s - 50), b = Math.min(text.length(), e + 50);
            issues.add(new Issue(kind, id, s, text.substring(a, b).replaceAll("\\s+", " ").strip(), sug == null ? List.of() : sug));
        }
        void edit(int s, int e, String nw, String rule, String id) {
            claimed.add(new int[]{s, e});
            if (enabled.contains(baseRule(rule))) edits.add(new Object[]{s, e, nw, rule, id});
            else issue("ambiguous_code", id, s, e, nw.startsWith("[[task:") ? List.of(nw.substring(7, nw.length() - 2)) : List.of());
        }

        Result go() {
            fences();
            inline();
            scan(ESC_WIKI, this::onEsc);
            scan(WIKI, this::onWiki);
            scan(MD_LINK, this::onMdLink);
            scan(URL, this::onUrl);
            scan(TYPED_RE, this::onTyped);
            shapes();
            scan(LONE, this::onLone);
            edits.sort(Comparator.comparingInt(x -> (int) x[0]));
            StringBuilder out = new StringBuilder();
            List<Change> changes = new ArrayList<>();
            int at = 0;
            for (Object[] ed : edits) {
                int s = (int) ed[0], e = (int) ed[1];
                out.append(text, at, s).append((String) ed[2]);
                changes.add(new Change((String) ed[3], (String) ed[4], text.substring(s, e), (String) ed[2]));
                at = e;
            }
            out.append(text.substring(at));
            issues.sort(Comparator.comparingInt(Issue::start));
            return new Result(out.toString(), changes, issues);
        }

        void fences() {
            int pos = 0, seg = 0, fstart = 0;
            String fence = null;
            Matcher lines = Pattern.compile("[^\\n]*\\n|[^\\n]+$").matcher(text);
            while (lines.find()) {
                String line = lines.group();
                Matcher m = FENCE.matcher(line);
                boolean isFence = m.find();
                if (fence != null) {
                    if (isFence && m.group(1).charAt(0) == fence.charAt(0) && m.group(1).length() >= fence.length()) {
                        protect(fstart, pos + line.length());
                        fence = null;
                        seg = pos + line.length();
                    }
                } else if (isFence) {
                    if (pos > seg) prose.add(new int[]{seg, pos});
                    fence = m.group(1);
                    fstart = pos;
                }
                pos += line.length();
            }
            if (fence != null) protect(fstart, text.length());
            else if (text.length() > seg) prose.add(new int[]{seg, text.length()});
        }

        void inline() {
            for (int[] p : prose) {
                Matcher m = INLINE.matcher(text).region(p[0], p[1]);
                while (m.find()) {
                    String inner = m.group(2).strip();
                    Object[] r = exactRef(inner);
                    if (r != null && r[0] != null) {
                        String[] te = (String[]) r[0];
                        edit(m.start(), m.end(), wiki(te[0], te[1]), "backtick_" + r[1], inner);
                    } else {
                        protect(m.start(), m.end());
                        if (r != null || containsId(inner)) issue("backtick", inner, m.start(), m.end(), r == null ? List.of() : (List<String>) r[2]);
                    }
                }
            }
        }

        /** {@code `X`} целиком — ссылка? [[тип,id] | null, правило, подсказки] или null (не ID вовсе). */
        @SuppressWarnings("unchecked")
        Object[] exactRef(String inner) {
            Matcher w = Pattern.compile("^\\[\\[([^\\[\\]\\n]+)\\]\\]$").matcher(inner);
            if (w.matches()) {
                Object[] r = wikiInner(w.group(1).strip());
                return r == null ? null : new Object[]{r[0], "wiki", r[2]};
            }
            Matcher t = Pattern.compile("^(" + String.join("|", TYPED) + "):([A-Za-z0-9._/#-]+)$", Pattern.CASE_INSENSITIVE).matcher(inner);
            if (t.matches()) {
                String type = ctx.resolve(t.group(2), t.group(1).toLowerCase());
                return type == null ? null : new Object[]{new String[]{type, t.group(2)}, "typed", List.of()};
            }
            String shape = typeFromShape(inner);
            if (shape != null) {
                String type = ctx.resolve(inner, shape);
                return type == null ? null : new Object[]{new String[]{type, inner}, "shape", List.of()};
            }
            if (CODE_FULL.matcher(inner).matches()) {
                Lone l = lone(inner, ctx, owner, rec);
                if (l == null) return null;
                if (l.uid() != null) return new Object[]{new String[]{"task", l.uid()}, l.rule(), List.of()};
                return new Object[]{null, null, l.suggest()};
            }
            return null;
        }

        boolean containsId(String s) {
            for (Map.Entry<String, Pattern> sh : SHAPES) if (sh.getValue().matcher(s).find()) return true;
            Matcher l = LONE.matcher(s);
            while (l.find()) if (ctx.codes.containsKey(l.group(1))) return true;
            return WIKI.matcher(s).find();
        }

        /** Внутренность [[…]] без типа или с типом: [[тип,id] | null, правило, подсказки] или null. */
        Object[] wikiInner(String inner) {
            Matcher m = TYPED_FULL.matcher(inner);
            if (m.matches()) {
                String type = ctx.resolve(m.group(2), m.group(1).toLowerCase());
                return type == null ? null : new Object[]{new String[]{type, m.group(2)}, "typed", List.of()};
            }
            String type = ctx.resolve(inner, typeFromShape(inner));
            if (type != null) return new Object[]{new String[]{type, inner}, "wiki", List.of()};
            Lone l = lone(inner, ctx, owner, rec);
            if (l == null) return null;
            if (l.uid() != null) return new Object[]{new String[]{"task", l.uid()}, l.rule(), List.of()};
            return new Object[]{null, null, l.suggest()};
        }

        interface OnMatch { void on(Matcher m); }

        void scan(Pattern rx, OnMatch fn) {
            for (int[] p : prose) {
                Matcher m = rx.matcher(text).region(p[0], p[1]);
                m.useTransparentBounds(true).useAnchoringBounds(false);
                while (m.find()) if (free(m.start(), m.end())) fn.on(m);
            }
        }

        void onEsc(Matcher m) {
            String inner = m.group(1).strip();
            Object[] r = wikiInner(inner);
            String nw = r != null && r[0] != null ? wiki(((String[]) r[0])[0], ((String[]) r[0])[1]) : "[[" + inner + "]]";
            edit(m.start(), m.end(), nw, "escaped", inner);
        }

        void onWiki(Matcher m) {
            String inner = m.group(1).strip();
            int s = m.start(), e = m.end();
            Matcher t = TYPED_FULL.matcher(inner);
            if (t.matches()) {
                protect(s, e);
                String type = t.group(1).toLowerCase();
                if (!TYPED.contains(type)) issue("unknown", inner, s, e, null);
                else if (ctx.resolve(t.group(2), type) == null) issue("broken", t.group(2), s, e, null);
                return;
            }
            String shape = typeFromShape(inner);
            if (shape != null && ctx.has(shape, inner)) { protect(s, e); return; }
            if (shape != null) {
                String real = ctx.resolve(inner, shape);
                if (real != null) { edit(s, e, wiki(real, inner), "wrong_type", inner); return; }
                protect(s, e); issue("broken", inner, s, e, null); return;
            }
            Lone l = lone(inner, ctx, owner, rec);
            if (l != null && l.uid() != null) { edit(s, e, wiki("task", l.uid()), l.rule() + "_wiki", inner); return; }
            protect(s, e);
            if (l != null) issue("ambiguous_code", inner, s, e, l.suggest());
            else if (!ctx.anyId(inner)) issue("unknown", inner, s, e, null);
        }

        void onMdLink(Matcher m) {
            String label = m.group(1), url = m.group(2);
            if (isLoreUrl(url)) {
                String[] r = urlRef(url);
                if (r != null && (label.strip().equals(r[1]) || label.strip().equals(url))) {
                    edit(m.start(), m.end(), wiki(r[0], r[1]), "lore_url", r[1]); return;
                }
                protect(m.start(), m.end());
                issue("lore_url", r != null ? r[1] : url, m.start(), m.end(), null);
                return;
            }
            protect(m.start(), m.end());   // внешняя ссылка: не считается, но и текст подписи не трогаем
        }

        void onUrl(Matcher m) {
            String u = stripTrail(m.group());
            int end = m.start() + u.length();
            if (isLoreUrl(u)) {
                String[] r = urlRef(u);
                if (r != null) { edit(m.start(), end, wiki(r[0], r[1]), "lore_url", r[1]); return; }
                protect(m.start(), end); issue("lore_url", u, m.start(), end, null); return;
            }
            protect(m.start(), end);
        }

        void onTyped(Matcher m) {
            String id = stripTrail(m.group(2));
            int end = m.start() + m.group(1).length() + 1 + id.length();
            if (id.isEmpty() || !free(m.start(), end)) return;
            String type = ctx.resolve(id, m.group(1).toLowerCase());
            if (type != null) edit(m.start(), end, wiki(type, id), "typed", id);
            else { protect(m.start(), end); issue("broken", id, m.start(), end, null); }
        }

        void shapes() {
            for (int[] p : prose) {
                int i = p[0];
                while (i < p[1]) {
                    if (i > 0 && ID_CHAR.matcher(String.valueOf(text.charAt(i - 1))).matches()) { i++; continue; }
                    String bestType = null, bestId = null;
                    for (Map.Entry<String, Pattern> sh : SHAPES) {
                        Matcher m = sh.getValue().matcher(text).region(i, p[1]);
                        if (!m.lookingAt()) continue;
                        String id = stripTrail(m.group());
                        int after = i + id.length();
                        if (after < text.length() && WORD_AFTER.matcher(String.valueOf(text.charAt(after))).matches()) continue;
                        if (bestId == null || id.length() > bestId.length()) { bestType = sh.getKey(); bestId = id; }
                    }
                    if (bestId != null && !bestId.isEmpty() && free(i, i + bestId.length())) {
                        String real = ctx.resolve(bestId, bestType);
                        if (real != null) edit(i, i + bestId.length(), wiki(real, bestId), real.equals(bestType) ? "shape" : "wrong_type", bestId);
                        else { protect(i, i + bestId.length()); issue("no_record", bestId, i, i + bestId.length(), null); }
                        i += bestId.length();
                    } else i++;
                }
            }
        }

        void onLone(Matcher m) {
            Lone l = lone(m.group(1), ctx, owner, rec);
            if (l == null) return;
            if (l.uid() != null) edit(m.start(1), m.end(1), wiki("task", l.uid()), l.rule(), m.group(1));
            else { protect(m.start(1), m.end(1)); issue("ambiguous_code", m.group(1), m.start(1), m.end(1), l.suggest()); }
        }

        String[] urlRef(String url) {
            String q;
            try {
                q = url.startsWith("/") ? (url.contains("?") ? url.substring(url.indexOf('?') + 1) : "") : URI.create(url).getRawQuery();
            } catch (IllegalArgumentException e) {
                return null;
            }
            if (q == null) return null;
            Map<String, List<String>> params = new LinkedHashMap<>();
            for (String kv : q.split("&")) {
                int eq = kv.indexOf('=');
                if (eq <= 0) continue;
                params.computeIfAbsent(kv.substring(0, eq), k -> new ArrayList<>())
                    .add(URLDecoder.decode(kv.substring(eq + 1), StandardCharsets.UTF_8));
            }
            for (String key : List.of("open", "passport")) {
                for (String v : params.getOrDefault(key, List.of())) {
                    Matcher t = TYPED_FULL.matcher(v);
                    String hint = t.matches() ? t.group(1) : typeFromShape(v);
                    String id = t.matches() ? t.group(2) : v;
                    String type = ctx.resolve(id, hint);
                    if (type != null) return new String[]{type, id};
                }
            }
            return null;
        }
    }

    /** Включённые правила по умолчанию. */
    static Set<String> defaults() {
        Set<String> s = new HashSet<>(RULES);
        s.removeAll(DEFAULT_OFF);
        return s;
    }

    /** Не используется вне тестов: ссылка вида doc snake_case. */
    static boolean docSlug(String s) { return DOC_SLUG.matcher(s).matches(); }
}
