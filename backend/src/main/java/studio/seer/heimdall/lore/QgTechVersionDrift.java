package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Сверка версий технологий: реестр LORE ({@code tech_registry}, KnowSpec
 * {@code SPEC-TECH-*}) против манифестов репозитория (build.gradle +
 * gradle.properties, package.json). task:SPRINT_QG_REBUILD/QG-TECH-VERSIONS, п.1 и п.3.
 *
 * <p>Чистые функции: ни сети, ни базы. Сбор манифестов и строк реестра — дело рутины
 * гейта; здесь только разбор, сопоставление и метрики единого контракта
 * (SPEC-QG-ARCHITECTURE: число производит код, пороги — гейт).
 *
 * <p>Чего здесь НЕТ: сравнения с последней стабильной версией у источника (Maven
 * Central, npm) и вердикта FAIL «уязвимая / снята с поддержки» — для этого нужен
 * внешний источник, это следующий шаг задачи. Поэтому худший статус здесь — WARN.
 */
final class QgTechVersionDrift {

    private QgTechVersionDrift() {}

    enum Status {
        /** Версии совпали (с точностью записи реестра: «21» совпадает с 21.0.12). */
        MATCH,
        /** Манифест новее реестра — реестр отстал, его надо обновить. */
        REGISTRY_BEHIND,
        /** Реестр новее манифеста — репозиторий не догнал записанную версию (или реестр врёт). */
        MANIFEST_BEHIND,
        /** Версия с одной из сторон не число («latest», неразрешённое свойство) — сравнить нельзя. */
        UNPINNED,
        /** Запись реестра не нашлась в манифестах этого репозитория. */
        NOT_IN_MANIFEST,
        /** Ключ манифеста, которому не сопоставлена ни одна запись реестра. */
        NOT_IN_REGISTRY
    }

    /** Строка среза {@code tech_registry}: spec_id, tech_name, version (свободный текст). */
    record RegistryTech(String specId, String techName, String version) {}

    /** {@code specId == null} только у {@link Status#NOT_IN_REGISTRY}. */
    record Finding(String specId, String manifestKey, Status status, String registryVersion, String manifestVersion) {}

    /**
     * Имена реестра, которые не выводятся из названия технологии. Небольшая опись,
     * а не эвристика: название «Quarkus» не совпадает ни с одним ключом манифеста.
     */
    static final Map<String, List<String>> ALIASES = Map.of(
        "quarkus", List.of("io.quarkus", "io.quarkus.platform:quarkus-bom"),
        "arcadedb", List.of("com.arcadedb:arcadedb-engine", "com.arcadedb:arcadedb-network"));

    // ── разбор манифестов ────────────────────────────────────────────────

    private static final Pattern PLUGIN = Pattern.compile(
        "id\\s*\\(?\\s*['\"]([^'\"]+)['\"]\\s*\\)?\\s+version\\s*\\(?\\s*['\"]([^'\"]+)['\"]");
    private static final Pattern QUOTED = Pattern.compile("['\"]([^'\"\\s]+)['\"]");
    private static final Pattern PROP_REF = Pattern.compile("\\$\\{([\\w.\\-]+)}|\\$([A-Za-z_]\\w*)");
    private static final Pattern COORD_PART = Pattern.compile("[\\w.\\-]+");

    /**
     * build.gradle (+ gradle.properties) → ключ → версия. Ключ — {@code group:artifact}
     * у координат и id у плагинов с версией. Координата без версии (из BOM) не
     * попадает. Версия с неразрешимым свойством — ключ есть, значение {@code null}:
     * «не смогли прочитать» ≠ «нет зависимости».
     */
    static Map<String, String> parseGradle(String gradle, String properties) {
        Map<String, String> props = parseProperties(properties);
        Map<String, String> out = new TreeMap<>();
        if (gradle == null) return out;
        Matcher p = PLUGIN.matcher(gradle);
        while (p.find()) out.put(p.group(1), resolve(p.group(2), props));
        Matcher q = QUOTED.matcher(gradle);
        while (q.find()) {
            String[] parts = q.group(1).split(":");
            if (parts.length < 3) continue;
            String group = resolve(parts[0], props), artifact = resolve(parts[1], props);
            if (group == null || artifact == null
                || !COORD_PART.matcher(group).matches() || !COORD_PART.matcher(artifact).matches()) continue;
            out.put(group + ":" + artifact, resolve(parts[2], props));
        }
        return out;
    }

    static Map<String, String> parseProperties(String text) {
        Map<String, String> out = new LinkedHashMap<>();
        if (text == null) return out;
        for (String line : text.split("\\R")) {
            String l = line.strip();
            if (l.isEmpty() || l.startsWith("#") || l.startsWith("!")) continue;
            int eq = l.indexOf('=');
            if (eq <= 0) continue;
            out.put(l.substring(0, eq).strip(), l.substring(eq + 1).strip());
        }
        return out;
    }

    /** Подставляет {@code ${x}} и {@code $x}; хоть одно неразрешимо — {@code null}. */
    private static String resolve(String s, Map<String, String> props) {
        Matcher m = PROP_REF.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String name = m.group(1) != null ? m.group(1) : m.group(2);
            String v = props.get(name);
            if (v == null) return null;
            m.appendReplacement(sb, Matcher.quoteReplacement(v));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> NPM_SECTIONS =
        List.of("dependencies", "devDependencies", "peerDependencies", "optionalDependencies");

    /** package.json → имя пакета → спецификатор версии как написан. Битый JSON — пусто. */
    static Map<String, String> parsePackageJson(String json) {
        Map<String, String> out = new TreeMap<>();
        if (json == null) return out;
        JsonNode root;
        try {
            root = JSON.readTree(json);
        } catch (Exception e) {
            return out;
        }
        if (root == null || !root.isObject()) return out;
        for (String section : NPM_SECTIONS) {
            JsonNode deps = root.get(section);
            if (deps == null || !deps.isObject()) continue;
            Iterator<Map.Entry<String, JsonNode>> it = deps.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                out.putIfAbsent(e.getKey(), e.getValue().isTextual() ? e.getValue().asText() : null);
            }
        }
        return out;
    }

    // ── версии ───────────────────────────────────────────────────────────

    private static final Pattern LEADING = Pattern.compile("^\\s*(?:[v^~=<>]+\\s*)?(\\d+(?:\\.\\d+)*)");

    /** Номер в начале строки («26.11.1 (…)», «^19.2.8», «v1.2») или {@code null}. */
    static String leadingVersion(String s) {
        if (s == null) return null;
        Matcher m = LEADING.matcher(s);
        return m.find() ? m.group(1) : null;
    }

    /** Сравнение по числовым сегментам до общей точности: «21» = «21.0.12». */
    static int compare(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.min(x.length, y.length); i++) {
            int c = Long.compare(Long.parseLong(x[i]), Long.parseLong(y[i]));
            if (c != 0) return c;
        }
        return 0;
    }

    // ── сверка ───────────────────────────────────────────────────────────

    /**
     * Каждая запись реестра → находка; плюс ключи манифеста без записи реестра.
     * Порядок детерминирован: записи в порядке входа, затем несопоставленные ключи
     * по алфавиту.
     */
    static List<Finding> drift(List<RegistryTech> registry, Map<String, String> manifest) {
        Map<String, String> sorted = new TreeMap<>(manifest);
        Set<String> used = new LinkedHashSet<>();
        List<Finding> out = new ArrayList<>();
        for (RegistryTech t : registry) {
            List<String> keys = matchingKeys(t.techName(), sorted);
            used.addAll(keys);
            if (keys.isEmpty()) {
                out.add(new Finding(t.specId(), null, Status.NOT_IN_MANIFEST, t.version(), null));
                continue;
            }
            String key = keys.get(0);
            String mvRaw = sorted.get(key);
            String rv = leadingVersion(t.version()), mv = leadingVersion(mvRaw);
            Status s;
            if (rv == null || mv == null) s = Status.UNPINNED;
            else {
                int c = compare(mv, rv);
                s = c > 0 ? Status.REGISTRY_BEHIND : c < 0 ? Status.MANIFEST_BEHIND : Status.MATCH;
            }
            out.add(new Finding(t.specId(), key, s, t.version(), mvRaw));
        }
        for (Map.Entry<String, String> e : sorted.entrySet())
            if (!used.contains(e.getKey()))
                out.add(new Finding(null, e.getKey(), Status.NOT_IN_REGISTRY, null, e.getValue()));
        return out;
    }

    /** Ключи манифеста, относящиеся к технологии; первый — источник версии. */
    static List<String> matchingKeys(String techName, Map<String, String> sortedManifest) {
        List<String> found = new ArrayList<>();
        for (String cand : candidates(techName)) {
            for (String key : sortedManifest.keySet()) {
                String k = key.toLowerCase(Locale.ROOT);
                int colon = k.indexOf(':');
                String artifact = colon >= 0 ? k.substring(colon + 1) : null;
                if ((k.equals(cand) || cand.equals(artifact)) && !found.contains(key)) found.add(key);
            }
        }
        return found;
    }

    private static final Pattern PAREN = Pattern.compile("\\(([^)]+)\\)");

    static List<String> candidates(String techName) {
        Set<String> out = new LinkedHashSet<>();
        if (techName == null) return List.of();
        String lower = techName.toLowerCase(Locale.ROOT).strip();
        Matcher p = PAREN.matcher(lower);
        while (p.find()) {
            String inner = p.group(1).strip();
            if (!inner.contains(" ")) out.add(inner); // «(@modelcontextprotocol/sdk)», не «(шрифты)»
        }
        String bare = PAREN.matcher(lower).replaceAll("").strip();
        out.addAll(ALIASES.getOrDefault(bare, List.of()));
        if (!bare.isEmpty()) {
            out.add(bare.replaceAll("\\s+", "-"));
            out.add(bare.replaceAll("\\s+", ""));
        }
        return new ArrayList<>(out);
    }

    // ── метрики ──────────────────────────────────────────────────────────

    static final String SOURCE = "manifests";

    /**
     * Находки → метрики: счётчики с целью 0, больше нуля → WARN. Манифестов не было
     * вовсе ({@code manifestSeen=false}) → NOT_MEASURED с причиной
     * {@code source_missing}: ноль из непрочитанного был бы молчаливым SKIP.
     */
    static List<LoreQgResource.QGMetricEntry> toMetrics(List<Finding> findings, boolean manifestSeen) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.put("tech_version_drift", 0);
        counts.put("tech_not_in_registry", 0);
        counts.put("tech_not_in_manifest", 0);
        counts.put("tech_unpinned", 0);
        for (Finding f : findings) {
            String key = switch (f.status()) {
                case REGISTRY_BEHIND, MANIFEST_BEHIND -> "tech_version_drift";
                case NOT_IN_REGISTRY -> "tech_not_in_registry";
                case NOT_IN_MANIFEST -> "tech_not_in_manifest";
                case UNPINNED -> "tech_unpinned";
                case MATCH -> null;
            };
            if (key != null) counts.merge(key, 1, Integer::sum);
        }
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (!manifestSeen) {
                out.add(new LoreQgResource.QGMetricEntry(e.getKey(), null, "count", 0.0, "NOT_MEASURED",
                    SOURCE, "source_missing", null, null));
            } else {
                double v = e.getValue();
                out.add(new LoreQgResource.QGMetricEntry(e.getKey(), v, "count", 0.0, v == 0 ? "PASS" : "WARN",
                    SOURCE, null, null, null));
            }
        }
        return out;
    }
}
