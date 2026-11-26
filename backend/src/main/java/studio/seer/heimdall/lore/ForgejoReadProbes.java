package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-04 — QG-прогон read-группы миниаппа против нашего Forgejo (SPEC-FORGEJO-APP-060 §12,
 * OQ-060-ROUTES-VALIDATION). Пробы — данные ({@code forgejo/forgejo-read-probes.json}): маршрут, контрольные args,
 * ожидание и проверяемое поле. Значение {@code {"$ref": route, "at": "0.id"}} берётся из ответа уже выполненной пробы.
 *
 * <p>Вердикт на пробу: {@code pass} — ожидание сбылось; {@code fail} — нет (с кодом ошибки или полем, которое не
 * совпало); {@code skip} — не проверено, потому что не из чего взять аргумент (пустой список у $ref). skip — не зелёный:
 * «нет данных проверить» ≠ «проверили».
 */
final class ForgejoReadProbes {

    static final String RESOURCE = "/forgejo/forgejo-read-probes.json";

    record Probe(String route, JsonObject args, String expect, String reason, JsonObject check) {
        /** Маршруты, на чьи ответы ссылается проба через $ref. */
        List<String> refs() {
            List<String> out = new ArrayList<>();
            if (args == null) return out;
            for (String k : args.fieldNames())
                if (args.getValue(k) instanceof JsonObject o && o.containsKey("$ref")) out.add(o.getString("$ref"));
            return out;
        }
    }

    record Result(String route, String expect, String outcome, int http, String verdict, String note) {
        boolean pass() { return "pass".equals(verdict); }

        JsonObject toJson() {
            return new JsonObject().put("route", route).put("expect", expect).put("outcome", outcome)
                .put("http", http).put("verdict", verdict).put("note", note);
        }
    }

    record Report(List<Result> results) {
        int total() { return results.size(); }
        int passed() { return (int) results.stream().filter(Result::pass).count(); }
        int failed() { return (int) results.stream().filter(r -> "fail".equals(r.verdict())).count(); }
        int skipped() { return (int) results.stream().filter(r -> "skip".equals(r.verdict())).count(); }

        /** Итог прогона: PASS только когда нет ни fail, ни skip. */
        String verdict() { return failed() > 0 ? "FAIL" : skipped() > 0 ? "PARTIAL" : "PASS"; }

        JsonObject toJson() {
            JsonArray rows = new JsonArray();
            for (Result r : results) rows.add(r.toJson());
            return new JsonObject().put("verdict", verdict()).put("total", total()).put("passed", passed())
                .put("failed", failed()).put("skipped", skipped()).put("results", rows);
        }
    }

    private final List<Probe> probes;

    private ForgejoReadProbes(List<Probe> probes) { this.probes = probes; }

    List<Probe> probes() { return probes; }

    static ForgejoReadProbes load() {
        try (InputStream in = ForgejoReadProbes.class.getResourceAsStream(RESOURCE)) {
            if (in == null) throw new IllegalStateException("нет ресурса " + RESOURCE);
            JsonObject root = new JsonObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            List<Probe> out = new ArrayList<>();
            for (Object o : root.getJsonArray("probes")) {
                JsonObject p = (JsonObject) o;
                out.add(new Probe(p.getString("route"), p.getJsonObject("args", new JsonObject()),
                    p.getString("expect", "found"), p.getString("reason"), p.getJsonObject("check")));
            }
            return new ForgejoReadProbes(List.copyOf(out));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Прогон всех проб по порядку; роль full — проверяем маршруты, а не RBAC (его стерегут юнит-тесты). */
    static Report run(ForgejoRoutes reg, ForgejoReadProbes probes, ForgejoApp.Upstream upstream) {
        Map<String, Object> data = new HashMap<>();
        List<Result> out = new ArrayList<>();
        for (Probe p : probes.probes()) {
            JsonObject args = new JsonObject();
            String missing = null;
            for (String k : p.args().fieldNames()) {
                Object v = p.args().getValue(k);
                if (v instanceof JsonObject ref && ref.containsKey("$ref")) {
                    Object got = at(data.get(ref.getString("$ref")), ref.getString("at", ""));
                    if (got == null) {
                        missing = "нет значения " + ref.getString("$ref") + " → " + ref.getString("at")
                            + " (пустой ответ или проба не прошла) — маршрут не проверен";
                        break;
                    }
                    args.put(k, got);
                } else {
                    args.put(k, v);
                }
            }
            if (missing != null) {
                out.add(new Result(p.route(), p.expect(), null, 0, "skip", missing));
                continue;
            }
            ForgejoApp.Outcome o = ForgejoApp.execute(reg, p.route(), args, "full", null, true, upstream);
            JsonObject env = o.envelope();
            String outcome = env.getString("outcome");
            JsonObject err = env.getJsonObject("error");
            if (!"failed".equals(outcome)) data.put(p.route(), env.getValue("data"));
            out.add(judge(p, outcome, o.http(), err, env.getValue("data")));
        }
        return new Report(List.copyOf(out));
    }

    private static Result judge(Probe p, String outcome, int http, JsonObject err, Object body) {
        String code = err == null ? null : err.getString("code");
        switch (p.expect()) {
            case "refused" -> {
                boolean ok = "failed".equals(outcome) && "REFUSED".equals(code);
                return new Result(p.route(), p.expect(), outcome, http, ok ? "pass" : "fail",
                    ok ? "ожидаемо не исполняется: " + p.reason() : "ожидали REFUSED, получили " + (code == null ? outcome : code));
            }
            case "found_or_empty" -> {
                boolean ok = "found".equals(outcome) || "empty".equals(outcome);
                return new Result(p.route(), p.expect(), outcome, http, ok ? "pass" : "fail",
                    ok ? "вызов выполнен (" + outcome + ")" : failNote(code, err));
            }
            default -> {
                if (!"found".equals(outcome))
                    return new Result(p.route(), p.expect(), outcome, http, "fail",
                        "empty".equals(outcome) ? "позитивный контроль: ждали данные, пришло пусто" : failNote(code, err));
                if (p.check() != null) {
                    String field = p.check().getString("field");
                    Object want = p.check().getValue("eq");
                    Object got = at(body, field);
                    if (!same(want, got))
                        return new Result(p.route(), p.expect(), outcome, http, "fail",
                            "позитивный контроль: поле " + field + " = " + got + ", ждали " + want);
                }
                return new Result(p.route(), p.expect(), outcome, http, "pass", "данные есть");
            }
        }
    }

    private static String failNote(String code, JsonObject err) {
        return (code == null ? "failed" : code) + (err == null || err.getString("detail") == null ? "" : ": " + err.getString("detail"));
    }

    private static boolean same(Object want, Object got) {
        if (want instanceof Number a && got instanceof Number b) return a.doubleValue() == b.doubleValue();
        return Objects.equals(want, got);
    }

    /** Значение по пути «0.id» / «login» / «0» в разобранном ответе (JsonArray/JsonObject). */
    static Object at(Object node, String path) {
        if (node == null) return null;
        if (path == null || path.isEmpty()) return node;
        Object cur = node;
        for (String seg : path.split("\\.")) {
            if (cur instanceof JsonArray arr) {
                int i;
                try {
                    i = Integer.parseInt(seg);
                } catch (NumberFormatException e) {
                    return null;
                }
                if (i < 0 || i >= arr.size()) return null;
                cur = arr.getValue(i);
            } else if (cur instanceof JsonObject obj) {
                cur = obj.getValue(seg);
            } else {
                return null;
            }
            if (cur == null) return null;
        }
        return cur;
    }
}
