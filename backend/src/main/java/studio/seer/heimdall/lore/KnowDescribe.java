package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-07 — describe-генератор карточек из записей KnowKind (заготовка под MCP2,
 * без MCP2-инструментов). Канон формы — SPEC-AGENT-SURFACE-061 §8 / SPEC-SKILLS-TAGS-062 §9:
 * {@code {kind, title, params, enums, identities, links, guards, errors}}. Карточка — производная записи
 * реестра: правка карточки руками = дефект QG (OQ-056-DESCRIBE-SOURCE); всё, что в ней есть, выводится
 * из записи и словарей.
 *
 * <ul>
 *   <li>{@code params} — для slice:* параметры сигнатуры среза; для остальных видов — поля записи
 *       (имя, тип, обязательность, enum_ref; у tag:* — его field_schema);</li>
 *   <li>{@code enums} — значения словарей по enum_ref полей (KnowDictEntry, рантайм — граф, тест — эталон);
 *       словарь не прочитан — ключ со значением null, а не пустой список (не смогли ≠ пусто);</li>
 *   <li>{@code identities} — профили агентов из roles[] (allowlist: пусто = запись не разрешена никому);</li>
 *   <li>{@code errors} — каталог отказов по гардам записи (§7 спеки 062, §5 спеки 061).</li>
 * </ul>
 */
final class KnowDescribe {

    private KnowDescribe() {}

    /** Короткая карточка — в схемы тулов: имя, заголовок, имена параметров и гардов. */
    static Map<String, Object> describeShort(Map<String, Object> kind) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("kind", kind.get("kind"));
        d.put("title", kind.get("title"));
        List<String> params = new ArrayList<>();
        for (Map<String, Object> p : params(kind)) params.add(String.valueOf(p.get("name")));
        d.put("params", params);
        List<String> guards = new ArrayList<>();
        for (Map<String, Object> g : list(kind, "guards")) guards.add(String.valueOf(g.get("name")));
        d.put("guards", guards);
        return d;
    }

    /**
     * Полная карточка.
     *
     * @param dicts словарь → коды значений; null — словари не прочитаны (enums с null-значениями)
     */
    static Map<String, Object> describeFull(Map<String, Object> kind, Map<String, List<String>> dicts) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("kind", kind.get("kind"));
        d.put("title", kind.get("title"));
        List<Map<String, Object>> params = params(kind);
        d.put("params", params);
        Map<String, Object> enums = new TreeMap<>();
        for (Map<String, Object> p : params) {
            if (p.get("enum") instanceof List<?> inline) { enums.put(String.valueOf(p.get("name")), inline); continue; }
            Object ref = p.get("enum_ref");
            if (ref == null) continue;
            String dict = String.valueOf(ref).startsWith("dict:") ? String.valueOf(ref).substring(5) : String.valueOf(ref);
            enums.put(dict, dicts == null ? null : dicts.get(dict));
        }
        d.put("enums", enums);
        d.put("identities", kind.get("roles") == null ? List.of() : kind.get("roles"));
        List<Map<String, Object>> links = new ArrayList<>();
        for (Map<String, Object> l : list(kind, "links")) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("rel", l.get("rel"));
            x.put("dir", l.get("dir"));
            x.put("target_kind", l.get("target_kind"));
            x.put("edge_fields", l.get("edge_fields"));
            links.add(x);
        }
        d.put("links", links);
        List<Map<String, Object>> guards = new ArrayList<>();
        for (Map<String, Object> g : list(kind, "guards")) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("name", g.get("name"));
            if (g.get("params") instanceof List<?> l && !l.isEmpty()) x.put("params", l);
            guards.add(x);
        }
        d.put("guards", guards);
        d.put("errors", errors(kind));
        if (kind.get("lifecycle") != null) d.put("lifecycle", kind.get("lifecycle"));
        d.put("source", kind.get("source"));
        d.put("content_hash", kind.get("content_hash"));
        return d;
    }

    /** Параметры карточки: срез — сигнатура; tag — field_schema; остальное — поля записи. */
    static List<Map<String, Object>> params(Map<String, Object> kind) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (kind.get("params") instanceof List<?>) {
            for (Map<String, Object> p : list(kind, "params")) {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("name", p.get("name"));
                x.put("type", p.get("type"));
                x.put("required", Boolean.TRUE.equals(p.get("required")));
                out.add(x);
            }
            return out;
        }
        for (Map<String, Object> f : list(kind, "fields")) {
            if (Boolean.TRUE.equals(f.get("service"))) continue;
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("name", f.get("name"));
            x.put("type", f.get("type"));
            x.put("required", Boolean.TRUE.equals(f.get("required")));
            if (f.get("enum_ref") != null) x.put("enum_ref", f.get("enum_ref"));
            if (f.get("enum") != null) x.put("enum", f.get("enum"));
            if (f.get("layer") != null) x.put("layer", f.get("layer"));
            out.add(x);
        }
        return out;
    }

    /** Каталог отказов по гардам: один код — одна строка (условия гардов одного кода сливаются). */
    static List<Map<String, Object>> errors(Map<String, Object> kind) {
        Map<String, Map<String, Object>> byCode = new LinkedHashMap<>();
        for (Map<String, Object> g : list(kind, "guards")) {
            String name = String.valueOf(g.get("name"));
            List<?> params = g.get("params") instanceof List<?> l ? l : List.of();
            switch (name) {
                case "required-fields" -> add(byCode, "BAD_PARAMS", "нет обязательного поля: " + params, "передать поля", null);
                case "required-params" -> add(byCode, "BAD_PARAMS", "нет обязательного параметра: " + params, "describe_full " + kind.get("kind"), null);
                case "value-whitelist", "tag-token" -> add(byCode, "BAD_PARAMS", "значение вне белого списка", "убрать кавычки, скобки, «;»", null);
                case "status-moves" -> {
                    // 061 §5 E2: переход вне жизненного цикла — INVALID_VALUE; переход «только через owner» — NOOP
                    add(byCode, "INVALID_VALUE", "переход статуса вне moves (" + params + ")", "взять разрешённый переход из workflow.moves", null);
                    if (params.stream().anyMatch(p -> String.valueOf(p).contains("owner")))
                        add(byCode, "NOOP", "переход только через owner", "запросить активацию у owner", null);
                }
                case "required-edges" -> add(byCode, "REFUSED", "нет обязательных рёбер " + params, "добавить рёбра", null);
                case "no-extends-cycle" -> add(byCode, "REFUSED", "цикл EXTENDS", "разорвать цикл", null);
                case "no-dangling-unlink" -> add(byCode, "REFUSED", "снятие последнего обязательного ребра " + params,
                    "сначала добавить замену", null);
                case "rename-identity" -> add(byCode, "IDENTITY_CONFLICT", "новое имя уже занято", "другое имя; слияние — решение владельца", null);
                case "rename-guard" -> add(byCode, "partial_failure", "rename тега с несопоставленными телами",
                    "добавить синоним в KnowTag или переписать тело", null);
                case "read-only-surface" -> add(byCode, "REFUSED", "тип только для чтения в UI-поверхности", "писать через свой write-тул", null);
                // SPRINT_FORGEJO_MINIAPP/FJ-01: гарды исполнителя маршрутов forgejo:* (SPEC-FORGEJO-APP-060 §6)
                case "approval-gate" -> {
                    add(byCode, "APPROVAL_REQUIRED", "risk=high без подтверждения человеком (428)",
                        "цитата диалога → повтор с заголовком X-Lore-Human-Approval", null);
                    add(byCode, "APPROVAL_INVALID", "подтверждение не прошло проверку (403, failed_check)", "свежая цитата в окне TTL", null);
                }
                case "route-params", "page-on-limit" -> add(byCode, "BAD_PARAMS", "args вне схемы params маршрута",
                    "describe " + kind.get("kind") + " и исправить args", null);
                case "ssrf-host" -> add(byCode, "BAD_PARAMS", "path-переменная выводит запрос за пределы пути (.., %, ://)",
                    "передать имя сегмента без спецсимволов", null);
                case "bridge-alias" -> add(byCode, "REFUSED", "маршрут исполняется только штатным мостом (409)",
                    "звать " + params, null);
                case "capability" -> add(byCode, "REFUSED", "capability " + params + " не подключена (501)",
                    "OQ-060-LOGS-VOLUME", null);
                case "upstream" -> {
                    add(byCode, "UPSTREAM_4XX", "Forgejo ответил 4xx — статус исходный", "404 → owner/repo; 401/403 → токен; 429 → backoff", null);
                    add(byCode, "UPSTREAM_5XX", "Forgejo ответил 5xx или не ответил", "повторить позже", null);
                }
                default -> { /* гард без отказа в каталоге — только в guards */ }
            }
        }
        List<?> roles = kind.get("roles") instanceof List<?> l ? l : List.of();
        if (!String.valueOf(kind.get("kind")).startsWith("slice:"))
            add(byCode, "FORBIDDEN_FOR_ROLE", "запись не из " + roles, "кого спросить", roles);
        return List.copyOf(byCode.values());
    }

    private static void add(Map<String, Map<String, Object>> byCode, String code, String when, String next, List<?> allowed) {
        Map<String, Object> e = byCode.get(code);
        if (e == null) {
            e = new LinkedHashMap<>();
            e.put("code", code);
            e.put("when", when);
            e.put("next", next);
            if (allowed != null) e.put("allowed", allowed);
            byCode.put(code, e);
        } else {
            e.put("when", e.get("when") + "; " + when);
            if (!String.valueOf(e.get("next")).contains(next)) e.put("next", e.get("next") + " / " + next);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> k, String key) {
        Object v = k.get(key);
        List<Map<String, Object>> out = new ArrayList<>();
        if (v instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    /**
     * Запись вида для запроса карточки describe (SKILL-04, один источник — реестр):
     * {@code skill:*} и геоид {@code skill:<slug>} — вид skill:* из выдачи генератора (know-registry.json);
     * {@code tag:*} — вид тега без полей (генератор {@link KnowRegistry#tagKind}); чужое — {@code null}.
     * Конкретный {@code tag:<slug>} несёт field_schema из графа — его вид собирает вызывающий по строке тега.
     */
    static Map<String, Object> kindFor(String kind, List<Map<String, Object>> artifact, io.vertx.core.json.JsonObject model) {
        if (kind == null) return null;
        String k = kind.strip();
        if (k.equals(SkillRules.PREFIX + "*") || (k.startsWith(SkillRules.PREFIX) && SkillRules.geoid(k) != null)) {
            for (Map<String, Object> a : artifact)
                if ((SkillRules.PREFIX + "*").equals(a.get("kind"))) {
                    Map<String, Object> copy = new LinkedHashMap<>(a);
                    copy.put("kind", k);
                    return copy;
                }
            return null;
        }
        if (k.equals("tag:*")) return KnowRegistry.tagKind(model, "*", List.of(), AgentScopeFilter.FAMILY_AGENTS);
        // FJ-01: forgejo:<route> — вид из реестра маршрутов миниаппа (тот же, что импортируется в KnowKind)
        if (k.startsWith("forgejo:")) return ForgejoRoutes.load().kind(k.substring("forgejo:".length()));
        return null;
    }
}
