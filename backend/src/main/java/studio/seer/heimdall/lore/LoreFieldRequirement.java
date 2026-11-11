package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/MD-REQUIRED — обязательность поля записи
 * (D-2026-LORE-RECORD-FIELD-REQUIRED, SPEC-LORE-MD-INLINE-REF §5).
 *
 * <p>Ответ владелицы 11.11 (A2): «обязательные — это из схемы в БД (передаёт приложение
 * в модели), рекомендуемые — из MCP, на которые он ругается в зависимости от логики».
 * Два уровня, два источника, ни один не задаётся руками в реестре:
 * <ul>
 *   <li><b>block</b> — свойство объявлено в схеме ArcadeDB как {@code mandatory} или
 *       {@code notNull} ({@code SELECT name, properties FROM schema:types}). Запись без
 *       него база не примет — клиент не даёт сохранить.</li>
 *   <li><b>warn</b> — проверки {@link WorkQuality}: то, что MCP называет в
 *       {@code quality.missing} ответа на запись. Коды берутся ПРОБОЙ линтера на пустой
 *       записи, а не списком: новая проверка в линтере сама попадает в контракт (а тест
 *       требует решить, к какому полю она относится). Условные проверки (класс работы,
 *       статус ADR) — пробой при условии; условие уходит описанием {@code when}.</li>
 * </ul>
 *
 * <p>Форма поля: {@code required} (boolean — как было, для старых клиентов; true также при
 * block), {@code required_level} — block | warn | null по БЕЗУСЛОВНЫМ правилам,
 * {@code required_rules} — все правила поля, включая условные. У типа —
 * {@code requirements} (все правила с {@code targets}: поле или связь — JUSTIFIED_BY не
 * поле, а связь) и {@code requirements_block}: schema — схема БД прочитана, unknown —
 * не читалась («не знаем» ≠ «обязательных нет»).
 */
final class LoreFieldRequirement {

    private LoreFieldRequirement() {}

    static final String BLOCK = "block";
    static final String WARN = "warn";

    // ── block: схема БД ─────────────────────────────────────────────────────

    /** Строки {@code schema:types} → тип вершины → свойства с mandatory или notNull. */
    static Map<String, Set<String>> mandatoryOf(List<Map<String, Object>> schemaRows) {
        Map<String, Set<String>> out = new HashMap<>();
        if (schemaRows == null) return out;
        for (Map<String, Object> t : schemaRows) {
            if (t.get("name") == null) continue;
            Set<String> req = new LinkedHashSet<>();
            if (t.get("properties") instanceof List<?> l)
                for (Object p : l)
                    if (p instanceof Map<?, ?> pm && pm.get("name") != null
                        && (truthy(pm.get("mandatory")) || truthy(pm.get("notNull"))))
                        req.add(String.valueOf(pm.get("name")));
            out.put(String.valueOf(t.get("name")), req);
        }
        return out;
    }

    private static boolean truthy(Object o) {
        return Boolean.TRUE.equals(o) || "true".equalsIgnoreCase(String.valueOf(o));
    }

    /** Схема для /lore/record: тип вершины → свойства и → обязательные. Кэш, чтобы паспорт не ходил в schema:types на каждый запрос. */
    record SchemaFacts(Map<String, List<String>> props, Map<String, Set<String>> mandatory) {
        static SchemaFacts of(List<Map<String, Object>> rows) {
            Map<String, List<String>> props = new HashMap<>();
            for (Map<String, Object> t : rows) {
                if (t.get("name") == null) continue;
                List<String> ps = new ArrayList<>();
                if (t.get("properties") instanceof List<?> l)
                    for (Object p : l) if (p instanceof Map<?, ?> pm && pm.get("name") != null) ps.add(String.valueOf(pm.get("name")));
                props.put(String.valueOf(t.get("name")), ps);
            }
            return new SchemaFacts(props, mandatoryOf(rows));
        }
    }

    private static final long TTL_MS = 5 * 60_000L;
    private static volatile SchemaFacts cached;
    private static volatile long cachedAt;

    /** Факты схемы из кэша; не прочиталась — {@code null} (block «unknown»), прошлое значение не подменяет ошибку надолго. */
    static SchemaFacts schemaFacts(Supplier<List<Map<String, Object>>> loader) {
        long now = System.currentTimeMillis();
        SchemaFacts c = cached;
        if (c != null && now - cachedAt < TTL_MS) return c;
        try {
            c = SchemaFacts.of(loader.get());
            cached = c;
            cachedAt = now;
            return c;
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ── warn: проверки качества MCP ─────────────────────────────────────────

    /** Условие пробы: поле записи и значение, при котором линтер требует больше. */
    private record Cond(String field, String eq) {}

    /** Тип → проба линтера (условие: поле → значение) и условия, которые стоит пробовать. */
    private record Probe(Function<Map<String, String>, WorkQuality.Result> eval, List<Cond> conditions) {}

    private static final Map<String, Probe> PROBES = Map.ofEntries(
        Map.entry("task", new Probe(c -> WorkQuality.evaluateTask(null, null, c.get("work_class"), null, null, null, null),
            List.of(new Cond("work_class", "uc"), new Cond("work_class", "jtd"), new Cond("work_class", "enb")))),
        Map.entry("sprint", new Probe(c -> WorkQuality.evaluateSprint(null, null, null, null, null, null), List.of())),
        Map.entry("release", new Probe(c -> WorkQuality.evaluateRelease(null, null, null, null, null), List.of())),
        Map.entry("adr", new Probe(c -> WorkQuality.evaluateAdr(c.get("status"), null, null, false, null, null, null, false),
            List.of(new Cond("status", "ACCEPTED"), new Cond("status", "SUPERSEDED")))),
        Map.entry("decision", new Probe(c -> WorkQuality.evaluateDecision(null, null, false, null, null, null), List.of())),
        Map.entry("spec", new Probe(c -> WorkQuality.evaluateSpec(null, null, null, null, null), List.of())),
        Map.entry("component", new Probe(c -> WorkQuality.evaluateComponent(null, null, null, null, null, null), List.of())),
        Map.entry("milestone", new Probe(c -> WorkQuality.evaluateMilestone(null, null, null, null), List.of())),
        Map.entry("question", new Probe(c -> WorkQuality.evaluateQuestion(null, null, null, null, null), List.of())));

    /**
     * Код линтера → к чему в паспорте он относится: {@code f:<ключ поля>} или
     * {@code r:<ребро>:<dir>} (связь типа). Пустой список — проверка про запись в целом
     * (проект задачи выводится через спринт — своего поля у задачи нет).
     */
    private static final Map<String, Map<String, List<String>>> TARGETS = Map.ofEntries(
        Map.entry("task", Map.of(
            "status", List.of("f:status"), "effort_days", List.of("f:effort"), "component", List.of("f:components"),
            "project", List.of(), "work_class", List.of("f:work_class"), "realizes_uc", List.of("f:realizes_uc"),
            "justified_by", List.of("r:JUSTIFIED_BY:out"))),
        Map.entry("sprint", Map.of(
            "status", List.of("f:status"), "project", List.of("f:projects"), "component", List.of("f:components"),
            "planned_dates", List.of("f:planned_start", "f:planned_end_date"))),
        Map.entry("release", Map.of(
            "git_tag", List.of("f:code"), "description", List.of("f:description_md"),
            "sprints_linked", List.of("r:IMPLEMENTED_IN_RELEASE:in"), "prs_linked", List.of("r:SHIPPED_IN:in"),
            "project", List.of("f:projects"))),
        Map.entry("adr", Map.ofEntries(
            Map.entry("status", List.of("f:status")), Map.entry("component", List.of("f:components")),
            Map.entry("project", List.of("f:projects")), Map.entry("context", List.of("f:context_md")),
            Map.entry("decision", List.of("f:decision_md")), Map.entry("context_substantive", List.of("f:context_md")),
            Map.entry("decision_substantive", List.of("f:decision_md")), Map.entry("traceability", List.of("f:decision_md")),
            Map.entry("consequences", List.of("f:consequences_md")), Map.entry("decisions", List.of("r:DECIDED_IN:in")),
            Map.entry("superseded_by", List.of("r:SUPERSEDES:in")))),
        Map.entry("decision", Map.of(
            "status", List.of("f:status"), "body", List.of("f:body_md"), "parent_adr", List.of("f:adr"),
            "body_substantive", List.of("f:body_md"), "project", List.of("f:projects"))),
        Map.entry("spec", Map.of(
            "title", List.of("f:title"), "content", List.of("f:content_md"), "component", List.of("f:component"),
            "project", List.of("f:projects"))),
        Map.entry("component", Map.of(
            "full_name", List.of("f:title"), "area", List.of("f:area"), "parent_sync", List.of("f:parent"))),
        Map.entry("milestone", Map.of(
            "label", List.of("f:title"), "date_display", List.of("f:date"), "products", List.of("f:products"))),
        Map.entry("question", Map.of(
            "title", List.of("f:title"), "status", List.of("f:status"), "owner", List.of("f:owner"))));

    private static List<WorkQuality.Finding> missing(String type, Map<String, String> cond) {
        Probe p = PROBES.get(type);
        if (p == null) return List.of();
        List<WorkQuality.Finding> out = new ArrayList<>();
        for (WorkQuality.Finding f : p.eval().apply(cond == null ? Map.of() : cond).findings())
            if (f.required() && !f.ok()) out.add(f);
        return out;
    }

    /** Коды, которые линтер (MCP) назвал бы в {@code quality.missing} у пустой записи типа при условии. */
    static List<String> missingCodes(String type, Map<String, String> cond) {
        return missing(type, cond).stream().map(WorkQuality.Finding::code).toList();
    }

    private static Map<String, Object> rule(String level, String source, String code, String message,
                                            Map<String, Object> when) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("level", level);
        m.put("source", source);
        m.put("code", code);
        m.put("message", message);
        m.put("when", when);
        return m;
    }

    private static Map<String, Object> when(Cond c, String label) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("field", c.field());
        m.put("eq", c.eq());
        m.put("text", "когда «" + (label == null ? c.field() : label) + "» = " + c.eq());
        return m;
    }

    /** Правила warn типа (без targets): безусловные, затем условные — каждое при своём условии. */
    private static List<Map<String, Object>> qualityRules(String type, Function<String, String> labelOf) {
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> base = new LinkedHashSet<>();
        for (WorkQuality.Finding f : missing(type, Map.of())) {
            base.add(f.code());
            out.add(rule(WARN, "quality", f.code(), f.message(), null));
        }
        Probe p = PROBES.get(type);
        if (p != null)
            for (Cond c : p.conditions())
                for (WorkQuality.Finding f : missing(type, Map.of(c.field(), c.eq())))
                    if (!base.contains(f.code()))
                        out.add(rule(WARN, "quality", f.code(), f.message(), when(c, labelOf.apply(c.field()))));
        return out;
    }

    // ── Сборка: поля и правила типа ─────────────────────────────────────────

    /**
     * Проставляет полям {@code required}, {@code required_level}, {@code required_rules}
     * и возвращает {@code requirements} типа.
     *
     * @param fields     поля schema (lore.record/1), правятся на месте
     * @param relations  связи schema (для targets вида «связь»)
     * @param props      свойства вершины и Hist типа; {@code null} — схема не читалась
     * @param mandatory  обязательные свойства из них; {@code null} — схема не читалась
     */
    static List<Map<String, Object>> annotate(String type, List<Map<String, Object>> fields,
                                              List<Map<String, Object>> relations,
                                              Set<String> props, Set<String> mandatory) {
        Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
        for (Map<String, Object> f : fields) byKey.put(String.valueOf(f.get("key")), f);
        Map<String, List<Map<String, Object>>> perField = new LinkedHashMap<>();
        List<Map<String, Object>> requirements = new ArrayList<>();

        // block — из схемы
        if (props != null && mandatory != null && !mandatory.isEmpty())
            for (Map<String, Object> f : fields) {
                String property = LoreModelTypes.propertyOf(type, f, props);
                if (property == null || !mandatory.contains(property)) continue;
                Map<String, Object> r = rule(BLOCK, "schema", property,
                    "Свойство «" + property + "» обязательно в схеме БД — без него запись не сохранится", null);
                perField.computeIfAbsent(String.valueOf(f.get("key")), k -> new ArrayList<>()).add(r);
                Map<String, Object> withTargets = new LinkedHashMap<>(r);
                withTargets.put("targets", List.of(target("field", String.valueOf(f.get("key")))));
                requirements.add(withTargets);
            }

        // warn — из линтера качества
        Map<String, List<String>> map = TARGETS.getOrDefault(type, Map.of());
        for (Map<String, Object> r : qualityRules(type, k -> byKey.containsKey(k) ? (String) byKey.get(k).get("label") : null)) {
            String code = String.valueOf(r.get("code"));
            List<Map<String, Object>> targets = new ArrayList<>();
            for (String spec : map.getOrDefault(code, List.of())) {
                if (spec.startsWith("f:")) {
                    String key = spec.substring(2);
                    if (!byKey.containsKey(key)) continue;
                    targets.add(target("field", key));
                    perField.computeIfAbsent(key, k -> new ArrayList<>()).add(r);
                } else {
                    String[] p = spec.split(":");
                    String key = relationKey(relations, p[1], p[2]);
                    if (key != null) targets.add(target("relation", key));
                }
            }
            Map<String, Object> withTargets = new LinkedHashMap<>(r);
            withTargets.put("targets", targets);
            requirements.add(withTargets);
        }

        for (Map<String, Object> f : fields) {
            List<Map<String, Object>> rules = perField.getOrDefault(String.valueOf(f.get("key")), List.of());
            String level = null;
            for (Map<String, Object> r : rules) {
                if (r.get("when") != null) continue;
                if (BLOCK.equals(r.get("level"))) level = BLOCK;
                else if (level == null) level = WARN;
            }
            boolean legacy = Boolean.TRUE.equals(f.get("required"));
            f.put("required", legacy || BLOCK.equals(level));
            f.put("required_level", level);
            f.put("required_rules", new ArrayList<>(rules));
        }
        return requirements;
    }

    private static Map<String, Object> target(String kind, String key) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("key", key);
        return m;
    }

    private static String relationKey(List<Map<String, Object>> relations, String rel, String dir) {
        if (relations == null) return null;
        for (Map<String, Object> r : relations)
            if (rel.equals(r.get("rel")) && dir.equals(r.get("dir"))) return String.valueOf(r.get("key"));
        return null;
    }
}
