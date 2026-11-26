package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-01 — реестр маршрутов Forgejo-миниаппа (ADR-LORE-060 R1, SPEC-FORGEJO-APP-060 §3, §7).
 *
 * <p>Данные, а не код: {@code forgejo/forgejo-routes.json} в ресурсах — все 107 маршрутов автономного forgejo-mcp
 * (104 извлечены механически из его {@code src/tools/*.ts}, get_job_log / get_pr_diff / delete_file сверены вручную)
 * плюс маршруты, добавленные записью ({@code origin: "lore"}). Новый маршрут — строка в файле, релиз MCP не нужен.
 *
 * <p>RBAC — поле {@code roles[]} маршрута (allowlist: роли нет в списке — отказ). {@link #GROUP_ROLES} — та же
 * матрица §7 в коде; сторож {@code ForgejoRoutesTest} держит их равными, чтобы правка одной копии не прошла молча.
 * {@code risk=high} (разрушающие и dispatch) — гейт подтверждения человеком (исполнение — FJ-07).
 *
 * <p>Виды {@code forgejo:<route>} для KnowRegistry ({@link #kinds()}) импортирует {@link KnowRegistrySync} на старте.
 */
final class ForgejoRoutes {

    static final String ARTIFACT = "forgejo/forgejo-routes.json";
    static final String FORMAT = "forgejo-routes/1";
    static final String SOURCE = "forgejo-routes";

    /**
     * Матрица SPEC-FORGEJO-APP-060 §7: группа маршрутов → профили agent_profile. {@code repo-destructive} — отдельная
     * группа разрушающих операций (delete_repo/org/branch, transfer_repo, admin_* записи) поверх восьми групп спеки:
     * только full (architect — по решению владельца, пока не принято).
     */
    static final Map<String, List<String>> GROUP_ROLES = Map.of(
        "read", List.of("full", "architect", "developer", "tester", "pm", "analyst", "marketer"),
        "issues-write", List.of("full", "architect", "developer", "tester", "pm"),
        "PR", List.of("full", "architect", "developer", "tester", "pm"),
        "file-write", List.of("full", "architect", "developer"),
        "actions-read", List.of("full", "architect", "developer", "tester"),
        "dispatch", List.of("full", "architect", "developer"),
        "notifications", List.of("full", "architect", "pm", "marketer"),
        "admin", List.of("full"),
        "repo-destructive", List.of("full"));

    /** Параметр маршрута. {@code in}: path | query | body | capability; {@code wire} — имя на проводе, если другое. */
    record Param(String name, String type, boolean required, String in, String pattern, String format,
                 Integer min, Integer max, List<String> values, String items, String wire, Object dflt, String desc) {

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("type", type);
            m.put("required", required);
            m.put("in", in);
            if (pattern != null) m.put("pattern", pattern);
            if (format != null) m.put("format", format);
            if (min != null) m.put("min", min);
            if (max != null) m.put("max", max);
            if (values != null) m.put("enum", values);
            if (items != null) m.put("items", items);
            if (wire != null) m.put("wire", wire);
            if (dflt != null) m.put("default", dflt);
            if (desc != null) m.put("desc", desc);
            return m;
        }
    }

    /** Маршрут реестра. {@code via} — исполняется штатным инструментом моста; {@code capability} — не REST. */
    record Route(String name, String method, String pathTemplate, String desc, String group, List<String> roles,
                 String risk, boolean list, String via, String capability, String response, String origin, String note,
                 Map<String, Param> params, List<Rule> rules) {

        boolean allows(String role) { return role != null && roles.contains(role); }
    }

    /**
     * FJ-06: правило маршрута по значению аргумента. {@code refuse} — значение из {@code values} или под {@code pattern}
     * не исполняется никогда (409 REFUSED, даже с подтверждением); {@code escalate} — такое значение поднимает маршрут
     * до {@code risk}/{@code roles} (тег релиза v* — только full и с подтверждением).
     */
    record Rule(String kind, String param, List<String> values, String pattern, String risk, List<String> roles, String reason) {

        boolean matches(Object raw) {
            if (!(raw instanceof String s)) return false;
            if (values != null && values.contains(s)) return true;
            return pattern != null && java.util.regex.Pattern.compile(pattern).matcher(s).find();
        }
    }

    private final Map<String, Route> routes;
    private final String source;

    private ForgejoRoutes(Map<String, Route> routes, String source) {
        this.routes = routes;
        this.source = source;
    }

    private static volatile ForgejoRoutes cached;

    /** Реестр из classpath (кэш на процесс: файл — часть сборки и в рантайме не меняется). */
    static ForgejoRoutes load() {
        ForgejoRoutes r = cached;
        if (r == null) cached = r = parse(text());
        return r;
    }

    static String text() {
        try (InputStream in = ForgejoRoutes.class.getClassLoader().getResourceAsStream(ARTIFACT)) {
            if (in == null) throw new IllegalStateException("нет реестра маршрутов " + ARTIFACT + " в classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("реестр маршрутов " + ARTIFACT + " не прочитан: " + e.getMessage(), e);
        }
    }

    static ForgejoRoutes parse(String text) {
        JsonObject doc = new JsonObject(text);
        if (!FORMAT.equals(doc.getString("format")))
            throw new IllegalStateException("реестр маршрутов: формат " + doc.getString("format") + ", ждали " + FORMAT);
        Map<String, Route> out = new TreeMap<>();
        for (Object o : doc.getJsonArray("routes", new JsonArray())) {
            JsonObject r = (JsonObject) o;
            Map<String, Param> params = new LinkedHashMap<>();
            JsonObject ps = r.getJsonObject("params", new JsonObject());
            for (String name : ps.fieldNames()) {
                JsonObject p = ps.getJsonObject(name);
                List<String> values = null;
                if (p.getJsonArray("values") != null) {
                    values = new ArrayList<>();
                    for (Object v : p.getJsonArray("values")) values.add(String.valueOf(v));
                }
                params.put(name, new Param(name, p.getString("type"), p.getBoolean("required", false), p.getString("in"),
                    p.getString("pattern"), p.getString("format"), p.getInteger("min"), p.getInteger("max"),
                    values == null ? null : List.copyOf(values), p.getString("items"), p.getString("wire"),
                    p.getValue("default"), p.getString("desc")));
            }
            List<String> roles = new ArrayList<>();
            for (Object x : r.getJsonArray("roles", new JsonArray())) roles.add(String.valueOf(x));
            Route route = new Route(r.getString("name"), r.getString("method"), r.getString("pathTemplate"),
                r.getString("desc"), r.getString("group"), List.copyOf(roles), r.getString("risk"),
                r.getBoolean("list", false), r.getString("via"), r.getString("capability"), r.getString("response"),
                r.getString("origin"), r.getString("note"), java.util.Collections.unmodifiableMap(params), rulesOf(r));
            if (out.put(route.name(), route) != null)
                throw new IllegalStateException("реестр маршрутов: двойник имени " + route.name());
        }
        return new ForgejoRoutes(java.util.Collections.unmodifiableMap(out), doc.getString("source"));
    }

    List<Route> all() { return List.copyOf(routes.values()); }

    Route get(String name) { return name == null ? null : routes.get(name); }

    String source() { return source; }

    /** Маршруты, которые роль может звать (allowlist: неизвестная роль — пусто). */
    List<Route> visibleTo(String role) {
        return routes.values().stream().filter(r -> r.allows(role)).toList();
    }

    /** Ближайшие имена для отказа UNKNOWN_KIND: подстрока либо малое расстояние правки. */
    List<String> candidates(String name, int limit) {
        String q = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);
        return routes.keySet().stream()
            .map(n -> Map.entry(n, score(q, n)))
            .filter(e -> e.getValue() <= Math.max(3, q.length() / 3))
            .sorted(Map.Entry.<String, Integer>comparingByValue().thenComparing(Map.Entry.comparingByKey()))
            .limit(limit).map(Map.Entry::getKey).toList();
    }

    private static List<Rule> rulesOf(JsonObject r) {
        List<Rule> out = new ArrayList<>();
        for (Object o : r.getJsonArray("rules", new JsonArray())) {
            JsonObject x = (JsonObject) o;
            List<String> values = null;
            if (x.getJsonArray("values") != null) {
                values = new ArrayList<>();
                for (Object v : x.getJsonArray("values")) values.add(String.valueOf(v));
            }
            List<String> roles = null;
            if (x.getJsonArray("roles") != null) {
                roles = new ArrayList<>();
                for (Object v : x.getJsonArray("roles")) roles.add(String.valueOf(v));
            }
            String kind = x.getString("kind");
            if (!"refuse".equals(kind) && !"escalate".equals(kind))
                throw new IllegalStateException("реестр маршрутов: " + r.getString("name") + " — правило вида «" + kind + "» неизвестно");
            out.add(new Rule(kind, x.getString("param"), values == null ? null : List.copyOf(values), x.getString("pattern"),
                x.getString("risk"), roles == null ? null : List.copyOf(roles), x.getString("reason")));
        }
        return List.copyOf(out);
    }

    private static int score(String q, String n) {
        if (q.isEmpty()) return Integer.MAX_VALUE;
        if (n.contains(q) || q.contains(n)) return Math.abs(n.length() - q.length()) == 0 ? 0 : 1;
        return levenshtein(q, n);
    }

    static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1], cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++)
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1));
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[b.length()];
    }

    // ── KnowRegistry: виды forgejo:* ─────────────────────────────────────

    /** Вид {@code forgejo:<route>} — запись KnowKind (поля = параметры маршрута, roles[] = RBAC, гарды исполнителя). */
    static Map<String, Object> kind(Route r) {
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Param p : r.params().values()) {
            Map<String, Object> f = p.toMap();
            f.put("layer", "route");
            fields.add(f);
        }
        List<Map<String, Object>> guards = new ArrayList<>();
        guards.add(KnowRegistry.guard("rbac-before-args", List.of("roles[] до валидации args")));
        if ("high".equals(r.risk())) guards.add(KnowRegistry.guard("approval-gate", List.of("X-Lore-Human-Approval", "intent_hash", "TTL")));
        guards.add(KnowRegistry.guard("route-params", List.of("схема params реестра")));
        if (r.list()) guards.add(KnowRegistry.guard("page-on-limit", List.of("page=1 при limit", "limit 20/50", "cursor")));
        guards.add(KnowRegistry.guard("ssrf-host", List.of("хост — только наш Forgejo", "path-переменные без .., %, ://")));
        if (r.via() != null) guards.add(KnowRegistry.guard("bridge-alias", List.of(r.via())));
        if (r.capability() != null) guards.add(KnowRegistry.guard("capability", List.of(r.capability())));
        guards.add(KnowRegistry.guard("upstream", List.of("UPSTREAM_4XX/5XX с исходным статусом")));
        guards.add(KnowRegistry.guard("truncate-6k", List.of("meta.truncated", "truncate:false — только file/pipe")));
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", "forgejo:" + r.name());
        k.put("id_field", null);
        k.put("title", r.desc());
        k.put("fields", fields);
        k.put("links", List.of());
        k.put("guards", guards);
        k.put("roles", r.roles());
        k.put("replaces", List.of());
        k.put("source", SOURCE);
        k.put("group", r.group());
        k.put("risk", r.risk());
        k.put("method", r.method());
        k.put("path", r.pathTemplate());
        return KnowRegistry.withHash(k);
    }

    Map<String, Object> kind(String routeName) {
        Route r = get(routeName);
        return r == null ? null : kind(r);
    }

    List<Map<String, Object>> kinds() {
        return routes.values().stream().sorted(Comparator.comparing(Route::name)).map(ForgejoRoutes::kind).toList();
    }
}
