package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-02 — исполнитель маршрута миниаппа (ADR-LORE-060 R2, SPEC-FORGEJO-APP-060 §4–§6, §9, §10).
 *
 * <p>Чистая функция без CDI и сети: «реестр + маршрут + args + роль + апстрим → HTTP-статус и конверт v=1».
 * Слои строго по §10, каждый отказ — до следующего слоя и до апстрима:
 * <ol>
 *   <li>маршрут в реестре? нет → {@code UNKNOWN_KIND} 404 с ближайшими именами;</li>
 *   <li>роль в {@code roles[]}? нет → {@code FORBIDDEN_FOR_ROLE} 403 с ролями-допусками — ДО разбора args;</li>
 *   <li>{@code risk=high} без подтверждения → {@code APPROVAL_REQUIRED} 428; с подтверждением → проверка
 *       (4 проверки §8 — FJ-07; до неё подтверждение не принимается: {@code APPROVAL_INVALID} 403);</li>
 *   <li>маршрут-алиас моста (merge) → {@code REFUSED} 409 «через forgejo_pr_merge»; capability не подключена → 501;</li>
 *   <li>args по схеме реестра → {@code BAD_PARAMS} / {@code INVALID_VALUE} 400; page=1 при limit (PR #2 форка);</li>
 *   <li>SSRF: path-переменные без {@code ..}, {@code %}, {@code ://}, {@code @}; хост — только база нашего Forgejo;</li>
 *   <li>апстрим → {@code UPSTREAM_4XX/5XX} с исходным статусом и подсказкой;</li>
 *   <li>truncate 6k ({@link ForgejoTruncate}) и обёртка: has_more/курсор у list-маршрутов.</li>
 * </ol>
 * {@code failed} ≠ {@code empty}: failed — вызов не выполнен (data null), empty — выполнен, ничего нет.
 */
final class ForgejoApp {

    private ForgejoApp() {}

    /** Ответ апстрима: статус, тело, Content-Type. */
    record Reply(int status, String body, String contentType) {}

    /** Вызов Forgejo API относительным путём (/repos/…?…) — базу и токен держит вызывающий (ForgejoBridge). */
    @FunctionalInterface
    interface Upstream {
        Reply call(String method, String pathAndQuery, String jsonBody) throws Exception;
    }

    /** HTTP-статус ответа LORE и конверт v=1. */
    record Outcome(int http, JsonObject envelope) {}

    static final int DEFAULT_LIMIT = 20;
    static final int MAX_LIMIT = 50;

    private static final Pattern VAR = Pattern.compile("\\{(\\w+)}");
    private static final Pattern SEGMENT = Pattern.compile("^[a-zA-Z0-9_.-]+$");

    /** Отказ валидации — превращается в 400 с кодом и allowed. */
    private static final class Refusal extends RuntimeException {
        final String code;
        final List<?> allowed;
        final String hint;
        Refusal(String code, String msg, List<?> allowed) {
            this(code, msg, allowed, null);
        }
        Refusal(String code, String msg, List<?> allowed, String hint) {
            super(msg, null, false, false);
            this.code = code;
            this.allowed = allowed;
            this.hint = hint;
        }
    }

    /**
     * FJ-04: реестр проектов LORE — слаг KnowGitProject → primary-хост и owner/name на нём (ForgejoBridge.resolve).
     * Снимает ловушку «два пространства слагов»: агент даёт либо owner+repo хоста, либо git_project.
     */
    @FunctionalInterface
    interface Projects {
        java.util.Optional<ForgejoBridge.Repo> resolve(String gitProjectSlug);
    }

    static final String GIT_PROJECT = "git_project";

    static Outcome execute(ForgejoRoutes reg, String routeName, JsonObject args, String role, String approval,
                           boolean truncate, Upstream upstream) {
        return execute(reg, routeName, args, role, approval, truncate, upstream, null, null);
    }

    /**
     * @param ourBase  база нашего Forgejo (схема+хост), куда ходит миниапп; нужна, чтобы git_project чужого хоста
     *                 получил отказ, а не вызов нашим токеном
     * @param projects резолв git_project; null — приём git_project не подключён (отказ с подсказкой owner+repo)
     */
    static Outcome execute(ForgejoRoutes reg, String routeName, JsonObject args, String role, String approval,
                           boolean truncate, Upstream upstream, String ourBase, Projects projects) {
        long t0 = System.nanoTime();
        String kind = "forgejo:" + routeName;
        ForgejoRoutes.Route r = reg.get(routeName);
        if (r == null)
            return fail(kind, t0, 404, "UNKNOWN_KIND", "маршрута «" + routeName + "» нет в реестре",
                reg.candidates(routeName, 5), "describe forgejo:* (forgejo_describe) и повторить с именем из allowed", null);
        // FJ-06: правила по значению аргумента — escalate поднимает роли/риск, refuse запрещает навсегда
        JsonObject raw = args == null ? new JsonObject() : args;
        List<String> roles = r.roles();
        String risk = r.risk();
        String escalated = null;
        for (ForgejoRoutes.Rule rule : r.rules())
            if ("escalate".equals(rule.kind()) && rule.matches(raw.getValue(rule.param()))) {
                if (rule.roles() != null) roles = rule.roles();
                if (rule.risk() != null) risk = rule.risk();
                escalated = rule.reason();
            }
        if (role == null || !roles.contains(role))
            return fail(kind, t0, 403, "FORBIDDEN_FOR_ROLE", "профилю " + (role == null ? "(нет)" : "agent-" + role)
                + " маршрут " + r.name() + " (группа " + r.group() + ") не разрешён" + (escalated == null ? "" : ": " + escalated), roles,
                "кого спросить: full | architect; переложить вызов на роль из allowed", null);
        for (ForgejoRoutes.Rule rule : r.rules())
            if ("refuse".equals(rule.kind()) && rule.matches(raw.getValue(rule.param())))
                return fail(kind, t0, 409, "REFUSED", "«" + rule.param() + "» = " + raw.getValue(rule.param()) + ": " + rule.reason(),
                    null, "это не делается через миниапп ни с каким подтверждением", null);
        if ("high".equals(risk)) {
            if (approval == null || approval.isBlank())
                return fail(kind, t0, 428, "APPROVAL_REQUIRED", "маршрут " + r.name() + " (risk=high) требует подтверждения человеком",
                    null, "цитата диалога: карточка в канал link → повтор с заголовком X-Lore-Human-Approval "
                        + "{message_ref, at, human, intent_hash}", null);
            return fail(kind, t0, 403, "APPROVAL_INVALID", "проверка подтверждения ещё не подключена — подтверждение не принято",
                null, "4 проверки §8 SPEC-FORGEJO-APP-060 появятся с SPRINT_FORGEJO_MINIAPP/FJ-07; до тех пор — через человека",
                "verifier_not_ready");
        }
        if (r.via() != null)
            return fail(kind, t0, 409, "REFUSED", "маршрут " + r.name() + " исполняется только штатным мостом с гейтом (ADR-LORE-024)",
                null, r.via() + " — merge строго по зелёному гейту CI с автолинковкой графа", null);

        JsonObject a = args == null ? new JsonObject() : args;
        Map<String, Object> clean;
        try {
            a = resolveGitProject(r, a, ourBase, projects);
            clean = validate(r, a);
        } catch (Refusal e) {
            return fail(kind, t0, 400, e.code, e.getMessage(), e.allowed,
                e.hint != null ? e.hint : "describe forgejo:" + r.name() + " и исправить args", null);
        }
        if (r.capability() != null)
            return fail(kind, t0, 501, "REFUSED", "маршрут " + r.name() + " — не REST, capability «" + r.capability()
                + "» к бэкенду LORE не подключена", null,
                "OQ-060-LOGS-VOLUME: вольюм логов Forgejo не смонтирован; пока — веб-интерфейс Forgejo", null);

        String pathAndQuery;
        String body;
        int limit = 0;
        int page = 0;
        try {
            if (r.list()) {
                limit = ((Number) clean.getOrDefault("limit", DEFAULT_LIMIT)).intValue();
                Object cursor = clean.remove("cursor");
                if (cursor != null) {
                    Integer off = offsetOf(String.valueOf(cursor));
                    if (off == null) throw new Refusal("BAD_PARAMS", "cursor не разобран — передавайте meta.cursor прошлого ответа как есть", null);
                    page = off / limit + 1;
                } else {
                    page = ((Number) clean.getOrDefault("page", 1)).intValue();
                }
                clean.put("limit", limit);
                clean.put("page", page);
            }
            pathAndQuery = buildPath(r, clean);
            body = buildBody(r, clean);
        } catch (Refusal e) {
            return fail(kind, t0, 400, e.code, e.getMessage(), e.allowed, "describe forgejo:" + r.name() + " и исправить args", null);
        }

        Reply reply;
        try {
            reply = upstream.call(r.method(), pathAndQuery, body);
        } catch (Exception e) {
            return fail(kind, t0, 502, "UPSTREAM_5XX", "Forgejo не ответил: " + e.getClass().getSimpleName(), null,
                "сеть/доступность Forgejo; повторить позже", null);
        }
        if (reply.status() >= 400) {
            int st = reply.status();
            return fail(kind, t0, st, st >= 500 ? "UPSTREAM_5XX" : "UPSTREAM_4XX", "Forgejo ответил " + st + upstreamMessage(reply),
                null, hintFor(st), null);
        }

        Object data = parse(r, reply);
        JsonObject meta = new JsonObject();
        boolean empty = data == null ? false : data instanceof JsonArray arr ? arr.isEmpty() : data instanceof String s && s.isEmpty();
        if (r.list()) {
            int returned = data instanceof JsonArray arr ? arr.size() : 0;
            boolean hasMore = returned >= limit && limit > 0;
            meta.put("cursor", hasMore ? cursorOf(page * limit) : null);
            meta.put("has_more", hasMore);
        }
        if ("log".equals(r.response()) && data instanceof String text) {
            LogCut cut = cutLog(text, truncate);
            data = cut.text();
            meta.put("log", new JsonObject().put("lines_total", cut.total()).put("lines_kept", cut.kept())
                .put("error_lines", cut.errors()).put("cut", cut.cut()));
        }
        Map<String, Object> truncated = null;
        if (truncate) {
            ForgejoTruncate.Result tr = ForgejoTruncate.apply(data);
            data = tr.data();
            truncated = tr.truncated();
        }
        meta.put("truncated", truncated == null ? null : new JsonObject(truncated));
        meta.put("took_ms", (System.nanoTime() - t0) / 1_000_000);
        if (data == null) data = new JsonObject().put("ok", true).put("status", reply.status());
        JsonObject env = new JsonObject()
            .put("v", 1).put("kind", kind).put("outcome", empty ? "empty" : "found")
            .put("data", data).put("meta", meta).putNull("error");
        return new Outcome(200, env);
    }

    // ── git_project → owner/repo (FJ-04) ─────────────────────────────────

    /** У маршрута есть пара path-параметров owner+repo — значит, ему можно дать git_project. */
    static boolean takesRepo(ForgejoRoutes.Route r) {
        ForgejoRoutes.Param o = r.params().get("owner");
        ForgejoRoutes.Param p = r.params().get("repo");
        return o != null && p != null && "path".equals(o.in()) && "path".equals(p.in());
    }

    /**
     * Подставляет owner/repo из git_project. Маршрут без owner+repo — args как есть (валидация назовёт git_project
     * лишним). git_project вместе с owner/repo — BAD_PARAMS (что-то одно). Проект не зарегистрирован или primary на
     * чужом хосте — INVALID_VALUE с подсказкой; апстрим в этих случаях не зовётся.
     */
    static JsonObject resolveGitProject(ForgejoRoutes.Route r, JsonObject args, String ourBase, Projects projects) {
        Object gp = args.getValue(GIT_PROJECT);
        if (gp == null || !takesRepo(r)) return args;
        if (args.containsKey("owner") || args.containsKey("repo"))
            throw new Refusal("BAD_PARAMS", "git_project и owner/repo вместе — дайте что-то одно", List.of(GIT_PROJECT, "owner", "repo"));
        if (!(gp instanceof String slug) || slug.isBlank())
            throw new Refusal("BAD_PARAMS", "«git_project» — строка, слаг проекта LORE (например NooriUta/UnlimitedLORE)", null);
        String hint = "дайте owner+repo нашего Forgejo (например AIDA/UnlimitedLORE) или зарегистрируйте проект в LORE";
        if (projects == null)
            throw new Refusal("INVALID_VALUE", "приём git_project не подключён", null, hint);
        java.util.Optional<ForgejoBridge.Repo> repo = projects.resolve(slug);
        if (repo.isEmpty())
            throw new Refusal("INVALID_VALUE", "проект «" + slug + "» не зарегистрирован в LORE или у него нет primary-хоста", null, hint);
        String host = hostOf(repo.get().apiBase());
        if (ourBase != null && !java.util.Objects.equals(host, hostOf(ourBase)))
            throw new Refusal("INVALID_VALUE", "primary-хост проекта «" + slug + "» — " + host + ", а миниапп ходит только в наш Forgejo ("
                + hostOf(ourBase) + ")", null, "этот проект живёт не в нашем Forgejo — миниапп его не читает");
        JsonObject out = args.copy();
        out.remove(GIT_PROJECT);
        out.put("owner", repo.get().owner()).put("repo", repo.get().name());
        return out;
    }

    private static String hostOf(String base) {
        try {
            return URI.create(base).getHost();
        } catch (RuntimeException e) {
            return base;
        }
    }

    // ── валидация args ───────────────────────────────────────────────────

    static Map<String, Object> validate(ForgejoRoutes.Route r, JsonObject args) {
        List<String> names = new ArrayList<>(r.params().keySet());
        if (r.list()) names.add("cursor");
        for (String k : args.fieldNames())
            if (!names.contains(k)) throw new Refusal("BAD_PARAMS", "лишний аргумент «" + k + "» — у маршрута его нет", names);
        Map<String, Object> out = new LinkedHashMap<>();
        for (ForgejoRoutes.Param p : r.params().values()) {
            Object v = args.getValue(p.name());
            if (v == null) {
                if (p.required()) throw new Refusal("BAD_PARAMS", "нет обязательного аргумента «" + p.name() + "»", names);
                continue;
            }
            out.put(p.name(), check(p, v, names));
        }
        if (r.list() && args.getValue("cursor") != null) out.put("cursor", String.valueOf(args.getValue("cursor")));
        return out;
    }

    private static Object check(ForgejoRoutes.Param p, Object v, List<String> names) {
        String n = p.name();
        switch (String.valueOf(p.type())) {
            case "int", "number" -> {
                if (!(v instanceof Number num) || ("int".equals(p.type()) && num.doubleValue() != Math.rint(num.doubleValue())))
                    throw new Refusal("BAD_PARAMS", "«" + n + "» — число" + ("int".equals(p.type()) ? " (целое)" : ""), names);
                if (p.min() != null && num.doubleValue() < p.min())
                    throw new Refusal("BAD_PARAMS", "«" + n + "» меньше " + p.min(), names);
                if (p.max() != null && num.doubleValue() > p.max())
                    throw new Refusal("BAD_PARAMS", "«" + n + "» больше " + p.max(), names);
                return "int".equals(p.type()) ? (Object) num.longValue() : num;
            }
            case "bool" -> {
                if (!(v instanceof Boolean)) throw new Refusal("BAD_PARAMS", "«" + n + "» — true/false", names);
                return v;
            }
            case "enum" -> {
                if (!(v instanceof String s) || p.values() == null || !p.values().contains(s))
                    throw new Refusal("INVALID_VALUE", "«" + n + "» = " + v + " — вне допустимых", p.values());
                return s;
            }
            case "array" -> {
                if (!(v instanceof JsonArray arr)) throw new Refusal("BAD_PARAMS", "«" + n + "» — список", names);
                for (Object x : arr)
                    if ("int".equals(p.items()) ? !(x instanceof Number) : !(x instanceof String))
                        throw new Refusal("BAD_PARAMS", "«" + n + "» — список " + p.items(), names);
                return arr;
            }
            case "object" -> {
                if (!(v instanceof JsonObject)) throw new Refusal("BAD_PARAMS", "«" + n + "» — объект", names);
                return v;
            }
            default -> {
                if (!(v instanceof String s)) throw new Refusal("BAD_PARAMS", "«" + n + "» — строка", names);
                if (p.max() != null && s.length() > p.max()) throw new Refusal("BAD_PARAMS", "«" + n + "» длиннее " + p.max(), names);
                if (p.pattern() != null && !Pattern.compile(p.pattern()).matcher(s).matches())
                    throw new Refusal("BAD_PARAMS", "«" + n + "» не по шаблону " + p.pattern(), names);
                if ("path".equals(p.in()) || p.format() != null) ssrfCheck(p, s, names);
                return s;
            }
        }
    }

    /**
     * SSRF-защита path-переменных: значение не должно выводить запрос из пути репозитория. Запрещены {@code ..},
     * {@code %} (уже кодированное — %2f, %2e), обратный слэш, {@code ://}, ведущий {@code /} и {@code @}; сегмент
     * (owner/repo/…) — только {@code [a-zA-Z0-9_.-]}. Ветка и путь файла могут содержать «/» — между сегментами.
     */
    static void ssrfCheck(ForgejoRoutes.Param p, String s, List<String> names) {
        String why = null;
        if (s.isEmpty()) why = "пусто";
        else if (s.contains("..")) why = "«..»";
        else if (s.contains("%")) why = "кодированные символы (%)";
        else if (s.contains("\\")) why = "обратный слэш";
        else if (s.contains("://") || s.startsWith("//")) why = "адрес вместо пути";
        else if (s.startsWith("/") || s.endsWith("/") && "branch".equals(p.format())) why = "ведущий/хвостовой «/»";
        else if (s.contains("@")) why = "«@»";
        else if (s.contains("?") || s.contains("#")) why = "«?»/«#»";
        else if (!"filepath".equals(p.format()) && !"branch".equals(p.format()) && !SEGMENT.matcher(s).matches()) why = "не сегмент пути";
        if (why != null)
            throw new Refusal("BAD_PARAMS", "«" + p.name() + "»: " + why + " — значение не может выводить запрос за пределы пути", names);
    }

    // ── сборка запроса ───────────────────────────────────────────────────

    static String buildPath(ForgejoRoutes.Route r, Map<String, Object> clean) {
        Matcher m = VAR.matcher(r.pathTemplate());
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            Object v = clean.get(m.group(1));
            if (v == null) throw new Refusal("BAD_PARAMS", "нет аргумента пути «" + m.group(1) + "»", new ArrayList<>(r.params().keySet()));
            m.appendReplacement(sb, Matcher.quoteReplacement(encodePath(String.valueOf(v))));
        }
        m.appendTail(sb);
        StringBuilder q = new StringBuilder();
        for (ForgejoRoutes.Param p : r.params().values()) {
            if (!"query".equals(p.in()) || !clean.containsKey(p.name())) continue;
            Object v = clean.get(p.name());
            String val = v instanceof JsonArray arr ? String.join(",", arr.stream().map(String::valueOf).toList()) : String.valueOf(v);
            q.append(q.length() == 0 ? '?' : '&').append(enc(p.wire() == null ? p.name() : p.wire())).append('=').append(enc(val));
        }
        return sb + q.toString();
    }

    static String buildBody(ForgejoRoutes.Route r, Map<String, Object> clean) {
        JsonObject body = new JsonObject();
        boolean any = false;
        for (ForgejoRoutes.Param p : r.params().values()) {
            if (!"body".equals(p.in()) || !clean.containsKey(p.name())) continue;
            body.put(p.wire() == null ? p.name() : p.wire(), clean.get(p.name()));
            any = true;
        }
        if (any) return body.encode();
        return switch (r.method()) {
            case "POST", "PUT", "PATCH" -> "{}";
            default -> null;
        };
    }

    /** Путь кодируется посегментно: «/» между сегментами остаётся (ветка, путь файла), остальное — percent-encoding. */
    private static String encodePath(String v) {
        String[] seg = v.split("/", -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < seg.length; i++) sb.append(i == 0 ? "" : "/").append(enc(seg[i]).replace("+", "%20"));
        return sb.toString();
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }

    /**
     * Полный адрес вызова: только база нашего Forgejo + {@code /api/v1} + относительный путь. Путь обязан начинаться
     * с одиночного «/», без «..»; итоговые схема, хост и порт — ровно базовые. Иначе — исключение (SSRF).
     */
    static URI targetUri(String apiBase, String pathAndQuery) {
        if (pathAndQuery == null || !pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//") || pathAndQuery.contains(".."))
            throw new IllegalArgumentException("путь вызова Forgejo не относительный: " + pathAndQuery);
        URI base = URI.create(apiBase.replaceAll("/$", ""));
        URI target = URI.create(base + "/api/v1" + pathAndQuery);
        if (!java.util.Objects.equals(base.getScheme(), target.getScheme())
            || !java.util.Objects.equals(base.getHost(), target.getHost()) || base.getPort() != target.getPort()
            || target.getRawUserInfo() != null || !target.getRawPath().startsWith(java.util.Objects.toString(base.getRawPath(), "") + "/api/v1/"))
            throw new IllegalArgumentException("адрес вызова вне нашего Forgejo: " + target.getHost());
        return target;
    }

    // ── ответ ────────────────────────────────────────────────────────────

    // ── журнал CI (FJ-08) ────────────────────────────────────────────────

    static final int LOG_TAIL_LINES = 300;
    private static final Pattern LOG_ERROR = Pattern.compile("(?i)(::error::|\\berror\\b|\\bfailed\\b|exception|panic|FAILURE)");

    record LogCut(String text, int total, int kept, int errors, boolean cut) {}

    /**
     * Журнал в диалог: строки с ошибками (с номером строки) + последние {@link #LOG_TAIL_LINES} строк. Короткий журнал
     * и truncate=false — целиком. Число строк с ошибками считается всегда — оно и есть сводка «где смотреть».
     */
    static LogCut cutLog(String text, boolean truncate) {
        String[] lines = text.split("\n", -1);
        int total = text.endsWith("\n") ? lines.length - 1 : lines.length;
        List<Integer> err = new ArrayList<>();
        for (int i = 0; i < total; i++) if (LOG_ERROR.matcher(lines[i]).find()) err.add(i);
        if (!truncate || total <= LOG_TAIL_LINES) return new LogCut(text, total, total, err.size(), false);
        int from = total - LOG_TAIL_LINES;
        StringBuilder sb = new StringBuilder();
        List<Integer> early = err.stream().filter(i -> i < from).toList();
        if (!early.isEmpty()) {
            sb.append("--- строки с ошибками до хвоста (").append(early.size()).append(") ---\n");
            for (int i : early) sb.append(i + 1).append(": ").append(lines[i]).append('\n');
        }
        sb.append("--- TRUNCATED: последние ").append(LOG_TAIL_LINES).append(" из ").append(total)
            .append(" строк; целиком — truncate=false ---\n");
        for (int i = from; i < total; i++) sb.append(lines[i]).append('\n');
        return new LogCut(sb.toString(), total, LOG_TAIL_LINES + early.size(), err.size(), true);
    }

    private static Object parse(ForgejoRoutes.Route r, Reply reply) {
        String b = reply.body();
        if (b == null || b.isEmpty()) return null;
        if ("text".equals(r.response()) || "log".equals(r.response())) return b;
        String t = b.stripLeading();
        try {
            if (t.startsWith("[")) return new JsonArray(b);
            if (t.startsWith("{")) return new JsonObject(b);
        } catch (RuntimeException ignored) {
            // не JSON, хоть и похож — отдаём строкой
        }
        return b;
    }

    private static String upstreamMessage(Reply reply) {
        try {
            String m = new JsonObject(reply.body()).getString("message");
            return m == null || m.isBlank() ? "" : ": " + (m.length() > 300 ? m.substring(0, 300) : m);
        } catch (RuntimeException e) {
            return "";
        }
    }

    static String hintFor(int status) {
        if (status == 404) return "проверить owner/repo (и номер/имя объекта): describe forgejo:<route>";
        if (status == 401 || status == 403) return "токен моста или его право (repo-scoped токен не достаёт admin; OQ-060-TOKEN-PROVISIONING)";
        if (status == 409 || status == 422) return "состояние объекта не позволяет операцию — перечитать объект и повторить";
        if (status == 429) return "лимит запросов Forgejo — backoff и повтор";
        if (status >= 500) return "сбой Forgejo — повторить позже";
        return "исправить запрос по ответу Forgejo";
    }

    private static Outcome fail(String kind, long t0, int status, String code, String detail, List<?> allowed, String hint,
                                String failedCheck) {
        JsonObject err = new JsonObject().put("code", code).put("status", status).put("detail", detail);
        if (allowed != null) err.put("allowed", new JsonArray(new ArrayList<>(allowed)));
        if (hint != null) err.put("hint", hint);
        if (failedCheck != null) err.put("failed_check", failedCheck);
        JsonObject env = new JsonObject()
            .put("v", 1).put("kind", kind).put("outcome", "failed").putNull("data")
            .put("meta", new JsonObject().put("took_ms", (System.nanoTime() - t0) / 1_000_000))
            .put("error", err);
        return new Outcome(status, env);
    }

    // ── курсор ───────────────────────────────────────────────────────────

    static String cursorOf(int offset) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(("{\"o\":" + offset + "}").getBytes(StandardCharsets.UTF_8));
    }

    static Integer offsetOf(String cursor) {
        try {
            JsonObject o = new JsonObject(new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8));
            Integer v = o.getInteger("o");
            return v == null || v < 0 ? null : v;
        } catch (RuntimeException e) {
            return null;
        }
    }
}
