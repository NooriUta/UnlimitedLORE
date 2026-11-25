package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-02 — входы генератора KnowRegistry из репозитория (без базы):
 * модель {@code shared/model/lore-model.json}, DDL с объявленными типами свойств (эталон v1,
 * {@code CREATE PROPERTY} в коде сервера, схема переноса 1.18), реестр срезов, матрица записи агентов.
 * Имена свойств — те же, что у сторожа MDL-05 ({@link FieldDeclaredGuardTest#ddlByType}).
 */
final class KnowRegistryInputs {

    private KnowRegistryInputs() {}

    static final Path ARTIFACT = Path.of("src", "main", "resources", "lore-model", "know-registry.json");

    private static KnowRegistry.Inputs inputs;

    static synchronized KnowRegistry.Inputs inputs() {
        if (inputs != null) return inputs;
        Map<String, LoreSlices.SliceDef> slices = new TreeMap<>();
        for (String id : LoreSlices.ids()) slices.put(id, LoreSlices.get(id));
        return inputs = new KnowRegistry.Inputs(FieldDeclaredGuardTest.model(), ddlTyped(), slices, AgentScopeFilter.FAMILY_AGENTS);
    }

    /** DDL: тип → свойство → объявленный тип ArcadeDB ("" — объявлено, тип не прочитан). */
    static Map<String, Map<String, String>> ddlTyped() {
        Map<String, Map<String, String>> out = new TreeMap<>();
        FieldDeclaredGuardTest.ddlByType().forEach((t, ps) -> {
            if ("*".equals(t)) return;
            Map<String, String> m = out.computeIfAbsent(t, x -> new TreeMap<>());
            for (String p : ps) m.put(p, "");
        });
        LoreModelGoldenTest.schemaV1().declared().forEach((t, ps) -> ps.forEach((p, ty) -> put(out, t, p, ty)));
        Pattern typed = Pattern.compile("CREATE PROPERTY\\s+`?(\\w+)`?\\.`?(\\w+)`?\\s+(?:IF NOT EXISTS\\s+)?([A-Z_]+)");
        try (Stream<Path> files = Files.walk(Path.of("src", "main", "java"))) {
            for (Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java"))::iterator) {
                Matcher m = typed.matcher(Files.readString(f, StandardCharsets.UTF_8));
                while (m.find()) put(out, m.group(1), m.group(2), m.group(3));
            }
            try (Stream<Path> schema = Files.list(Path.of("..", "scripts", "model-migration", "schema"))) {
                for (Path f : (Iterable<Path>) schema.filter(p -> p.toString().endsWith(".json")).sorted()::iterator) {
                    JsonObject types = new JsonObject(Files.readString(f, StandardCharsets.UTF_8)).getJsonObject("types");
                    if (types == null) continue;
                    types.forEach(e -> {
                        JsonObject fields = ((JsonObject) e.getValue()).getJsonObject("fields");
                        if (fields != null) fields.forEach(fe -> {
                            Object dbType = fe.getValue() instanceof JsonObject fo ? fo.getValue("db_type") : null;
                            put(out, e.getKey(), fe.getKey(), dbType == null ? "" : String.valueOf(dbType));
                        });
                    });
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out;
    }

    /** Объявленный тип не затирается пустым; первый непустой — побеждает (детерминированно по порядку входов). */
    private static void put(Map<String, Map<String, String>> out, String t, String p, String ty) {
        Map<String, String> m = out.computeIfAbsent(t, x -> new TreeMap<>());
        String have = m.get(p);
        if (have == null || have.isEmpty()) m.put(p, ty == null ? "" : ty);
    }

    /** Дамп схемы {@code SELECT name, type, properties FROM schema:types} → вершина → свойства. */
    static Map<String, Set<String>> dump(String json) {
        Map<String, Set<String>> out = new LinkedHashMap<>();
        for (Object o : new io.vertx.core.json.JsonArray(json)) {
            JsonObject row = (JsonObject) o;
            Set<String> props = new java.util.TreeSet<>();
            if (row.getJsonArray("properties") != null)
                for (Object p : row.getJsonArray("properties"))
                    if (p instanceof JsonObject pj && pj.getString("name") != null) props.add(pj.getString("name"));
            out.put(row.getString("name"), props);
        }
        return out;
    }
}
