package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Владелица 21.11.2026 (паспорт AIDA/MIDGARD и BRAGI на препроде): блок «Не описано в модели» показывал aliases, hosts,
 * mig_src_rid, regroup у проекта и dict_type, is_extensible, mig_src_rid у продукта — «не описаны в модели — дописать
 * описание в модель». Правило общее: свойство, которое база 1.18 хранит у записи типа (схема установщика + свойства,
 * которые ставят шаги переноса), либо описано полем модели, либо объявлено служебным (service_fields модели), либо
 * названо здесь с причиной как «ждёт описания». Новое неописанное свойство валит сторож.
 */
class ModelDescribesRecordPropsTest {

    /** Свойства, которые ставят шаги переноса поверх схемы установщика. */
    static final Map<String, List<String>> STEP_PROPS = Map.of(
        "*", List.of("mig_src_rid"),
        "KnowGitProject", List.of("aliases", "regroup", "hosts", "short_code", "short_title", "short_title_en", "short_title_pl",
            "title_en", "title_pl", "description", "description_en", "description_pl"),
        "QualityGate", List.of("scope"),
        "KnowDictEntry", List.of("kind", "dict_type", "is_extensible"));

    /** Неописанные свойства прочих типов — ждут описания в модели (найдены этим сторожем 21.11.2026). */
    // Владелица 21.11.2026: «опиши — нужно в инсталлятор отдать». Все свойства базы 1.18 описаны моделью или service_fields.
    static final Map<String, Set<String>> PENDING = Map.of();

    static Map<String, Set<String>> installerProps() throws Exception {
        Map<String, Set<String>> out = new HashMap<>();
        ObjectMapper m = new ObjectMapper();
        for (String file : List.of("sprint-phase-task.json", "all-objects.json")) {
            JsonNode types = m.readTree(Path.of("..", "scripts", "model-migration", "schema", file).toFile()).get("types");
            types.fields().forEachRemaining(e -> {
                Set<String> s = out.computeIfAbsent(e.getKey(), k -> new TreeSet<>());
                e.getValue().get("fields").fieldNames().forEachRemaining(s::add);
            });
        }
        return out;
    }

    static Map<String, Set<String>> unmodeled() throws Exception {
        Map<String, Set<String>> props = installerProps();
        Map<String, Set<String>> out = new TreeMap<>();
        for (String type : LoreRecordRegistry.TYPES) {
            if (!LoreRecordUnmodeled.reads(type)) continue;
            LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
            Map<String, Object> vertex = new LinkedHashMap<>();
            for (String p : props.getOrDefault(g.vertex(), Set.of())) vertex.put(p, "x");
            for (String p : STEP_PROPS.get("*")) vertex.put(p, "x");
            for (String p : STEP_PROPS.getOrDefault(g.vertex(), List.of())) vertex.put(p, "x");
            Set<String> left = LoreRecordUnmodeled.of(type, vertex).keySet();
            if (!left.isEmpty()) out.put(type, new TreeSet<>(left));
        }
        return out;
    }

    // ── SPRINT_LORE_MODEL_DOCS_TIDY/MDL-05: обратное направление — «поле либо в DDL, либо в модели» ──────────────────
    // Срез читает свойство записи (колонку SELECT … FROM <тип>), которого нет ни в схеме установщика, ни в модели (поле,
    // псевдоним, service_fields), ни среди свойств шагов переноса, — сборка красная. Повод: 204 поля оказались в проде
    // без объявления, потому что ничто не мешало читать поле, которого нигде нет.

    /** Легаси: срез читает свойство вне схемы и модели — с причиной; новое такое чтение валит сторож. */
    static final Map<String, String> LEGACY_READS = Map.ofEntries(
        // в 1.18 проект записи — ребро BELONGS_TO_PROJECT; плоское поле читается для старой схемы (до переноса)
        Map.entry("timeline_releases: KnowRelease.git_project", "1.18: проект релиза — ребро; поле — для старой схемы"),
        Map.entry("releases_since: KnowRelease.git_project", "1.18: проект релиза — ребро; поле — для старой схемы"),
        Map.entry("release_by_id: KnowRelease.git_project", "1.18: проект релиза — ребро; поле — для старой схемы"),
        Map.entry("releases: KnowRelease.git_project", "1.18: проект релиза — ребро; поле — для старой схемы"),
        Map.entry("release_prs: KnowPR.git_project", "1.18: проект PR — ребро; поле пишет мерж (LoreForgejoResource), установщик его не заводит"),
        Map.entry("pr_by_id: KnowPR.git_project", "1.18: проект PR — ребро; поле пишет мерж (LoreForgejoResource), установщик его не заводит"),
        Map.entry("release_prs_by_tag: KnowPR.git_project", "1.18: проект PR — ребро; поле пишет мерж (LoreForgejoResource), установщик его не заводит"),
        Map.entry("prs: KnowPR.git_project", "1.18: проект PR — ребро; поле пишет мерж (LoreForgejoResource), установщик его не заводит (раздел «PR», #1714)"),
        Map.entry("pr_ship_lag: KnowPR.git_project", "1.18: проект PR — ребро; поле пишет мерж (LoreForgejoResource), установщик его не заводит"),
        Map.entry("files_of_task: KnowFile.project", "файл — служебный тип без описания в модели; проект строкой — до решения о модели файлов"),
        Map.entry("project_files: KnowFile.project", "файл — служебный тип без описания в модели; проект строкой — до решения о модели файлов"),
        Map.entry("agent_sessions: KnowAgentSession.project", "сессия: проект строкой становится связью при переносе (session-model.mjs); поле — для старой схемы"),
        Map.entry("project_role_events: KnowProjectRoleEvent.project", "журнал событий роли — проект строкой, тип вне модели"),
        Map.entry("agent_owners: KnowActor.activity_window_h", "окно активности машины: свойство заводит сервер (MachineActivity:44), установщик — нет"),
        Map.entry("agent_owners: KnowActor.activity_window_harness", "окно активности по harness: свойство заводит сервер (MachineActivity), установщик — нет"),
        Map.entry("machine_acl: KnowActor.activity_window_h", "окно активности машины: свойство заводит сервер (MachineActivity:44), установщик — нет"),
        Map.entry("machine_acl: KnowActor.activity_window_harness", "окно активности по harness: свойство заводит сервер (MachineActivity), установщик — нет"),
        Map.entry("decision: KnowDecision.rationale_md", "обоснование решения: поле среза decision без объявления в схеме установщика и в модели — ждёт решения"),
        Map.entry("history_sprint: KnowSprintHist.track_id", "1.18: трек — ребро ON_TRACK (MDL-13); строка версии — для старой схемы"),
        Map.entry("history_sprint: KnowSprintHist.pr_refs", "1.18: номера PR спринта удержаны переносом (MDL-06); строка версии — для старой схемы"),
        Map.entry("bragi_insights: BragiInsight.subject_id", "BRAGI вне модели паспорта; поле пишет LoreBragiResource:805"));

    private static final java.util.regex.Pattern BARE = java.util.regex.Pattern.compile("(?i)^([a-z_][a-z0-9_]*)(\\s+AS\\s+[a-z_][a-z0-9_]*)?$");

    /** Колонки SELECT верхнего уровня (по запятым вне скобок). */
    static List<String> selectItems(String list) {
        List<String> out = new java.util.ArrayList<>();
        int depth = 0, from = 0;
        boolean quote = false;
        for (int i = 0; i < list.length(); i++) {
            char c = list.charAt(i);
            if (c == '\'') quote = !quote;
            if (quote) continue;
            if (c == '(' || c == '[') depth++;
            else if (c == ')' || c == ']') depth--;
            else if (c == ',' && depth == 0) { out.add(list.substring(from, i).trim()); from = i + 1; }
        }
        out.add(list.substring(from).trim());
        return out;
    }

    /** Что вершина {@code vertex} знает: схема установщика (и её версия), модель, служебное, шаги переноса. */
    static Set<String> knownProps(String vertex, Map<String, Set<String>> installer) {
        Set<String> k = new java.util.HashSet<>(installer.getOrDefault(vertex, Set.of()));
        installer.getOrDefault(vertex + "Hist", Set.of()).forEach(k::add);
        k.addAll(STEP_PROPS.get("*"));
        k.addAll(STEP_PROPS.getOrDefault(vertex, List.of()));
        k.addAll(LoreModelFile.content().serviceFields().keySet());
        k.addAll(LoreRecordUnmodeled.SERVICE);
        for (Map.Entry<String, LoreModelTypes.Graph> e : LoreModelTypes.GRAPH.entrySet()) {
            if (!vertex.equals(e.getValue().vertex())) continue;
            k.add(e.getValue().key());
            Map<String, String> al = LoreModelTypes.ALIASES.getOrDefault(e.getKey(), Map.of());
            k.addAll(al.values());
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(e.getKey());
            if (d == null) d = LoreRecordRegistry.childDef(e.getKey());
            if (d != null) for (LoreRecordRegistry.Field f : d.fields()) k.add(f.key());
        }
        return k;
    }

    /** Свойства, которые срез читает у типа, а их нет ни в схеме, ни в модели: «срез: Тип.свойство». */
    static List<String> unknownReads(String sliceId, String sql, Map<String, Set<String>> installer) {
        List<String> out = new java.util.ArrayList<>();
        // первый FROM верхнего уровня (вне скобок): подзапрос (FROM ( … )) — не чтение свойств записи
        String u = sql.toUpperCase(java.util.Locale.ROOT);
        int depth = 0, at = -1;
        for (int i = 0; i < u.length() && at < 0; i++) {
            char c = u.charAt(i);
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && u.startsWith(" FROM ", i)) at = i;
        }
        if (at < 0 || !u.stripLeading().startsWith("SELECT ")) return out;
        java.util.regex.Matcher t = java.util.regex.Pattern.compile("^\\s+FROM\\s+([A-Za-z][A-Za-z0-9_]*)\\b").matcher(sql.substring(at));
        if (!t.find()) return out;
        String vertex = t.group(1);
        if (!installer.containsKey(vertex)) return out;   // тип вне схемы установщика (Bragi*, служебные) — не наша ось
        Set<String> known = knownProps(vertex, installer);
        // старые имена, которые сервер на базе 1.18 переписывает на новые (ModelSchemaAdapter.RENAMES)
        ModelSchemaAdapter.RENAMES.forEach((old, now) -> { if (known.contains(now)) known.add(old); });
        String list = sql.substring(sql.toUpperCase(java.util.Locale.ROOT).indexOf("SELECT") + 6, at);
        for (String item : selectItems(list)) {
            java.util.regex.Matcher b = BARE.matcher(item);
            if (!b.matches()) continue;               // функции, обходы рёбер, литералы — не свойство записи
            String p = b.group(1);
            if (p.equalsIgnoreCase("count") || known.contains(p)) continue;
            out.add(sliceId + ": " + vertex + "." + p);
        }
        return out;
    }

    @Test
    void everySliceReadsOnlyDeclaredOrModeledProps() throws Exception {
        Map<String, Set<String>> installer = installerProps();
        List<String> bad = new java.util.ArrayList<>();
        for (String id : LoreSlices.ids())
            for (String r : unknownReads(id, LoreSlices.get(id).baseSql(), installer))
                if (!LEGACY_READS.containsKey(r)) bad.add(r);
        List<String> stale = LEGACY_READS.keySet().stream().filter(r -> {
            String id = r.substring(0, r.indexOf(':'));
            try { return LoreSlices.get(id) == null || !unknownReads(id, LoreSlices.get(id).baseSql(), installer).contains(r); }
            catch (Exception e) { return true; }
        }).sorted().toList();
        assertEquals(List.of(), bad, "срез читает свойство, которого нет ни в схеме установщика, ни в модели");
        assertEquals(List.of(), stale, "исключение без случая — убрать из LEGACY_READS");
    }

    /** Обратная проверка: выдуманное поле в срезе — сторож краснеет; поле схемы и поле модели — нет. */
    @Test
    void madeUpFieldInSliceIsCaught() throws Exception {
        Map<String, Set<String>> installer = installerProps();
        assertEquals(List.of("fake: KnowTask.made_up_field"),
            unknownReads("fake", "SELECT task_uid, title, made_up_field, out('PART_OF').sprint_id AS sid FROM KnowTask", installer));
        assertEquals(List.of(), unknownReads("ok", "SELECT task_uid, task_id, order_index AS oi FROM KnowTask WHERE x = 1", installer));
        assertEquals(List.of(), unknownReads("other", "SELECT whatever FROM NoSuchVertexType", installer), "тип вне схемы установщика — не наша ось");
        assertEquals(List.of(), unknownReads("sub", "SELECT made_up FROM (SELECT expand(unionall($a)) LET $a = (SELECT FROM KnowTask))", installer), "подзапрос — не чтение свойств");
    }

    @Test
    void projectAndProductHaveNothingUnmodeled() throws Exception {
        Map<String, Set<String>> u = unmodeled();
        assertNull(u.get("project"), "у проекта «Не описано в модели» пусто: " + u.get("project"));
        assertNull(u.get("product"), "у продукта «Не описано в модели» пусто: " + u.get("product"));
    }

    @Test
    void everyStoredPropIsModeledServiceOrPendingWithReason() throws Exception {
        Map<String, Set<String>> u = unmodeled();
        assertEquals(PENDING, u, "свойства базы 1.18 без описания в модели (описать полем или service_fields): " + u);
    }

    /** Поля, описанные 21.11.2026 (бывший список «ждёт описания»): в схеме установщика каждое — с типом базы. */
    @Test
    void describedFieldsAreInInstallerSchemaWithType() throws Exception {
        Map<String, List<String>> was = Map.of(
            "KnowTask", List.of("task_id", "priority", "priority_note", "order_index", "src", "summary_md"),
            "KnowSprint", List.of("effort_days", "goal", "unplanned_intentional"),
            "KnowRelease", List.of("git_tag", "release_name", "released_at"),
            "KnowDoc", List.of("content_html", "content_html_bytes", "content_html_sha256", "content_md_en_bytes",
                "content_md_en_sha256", "content_md_ru_bytes", "content_md_ru_sha256", "sort_order"),
            "KnowDecision", List.of("refs_raw"), "KnowQuestion", List.of("trigger"), "KnowUseCase", List.of("feature_id"),
            "KnowPR", List.of("pr_number"), "QualityGate", List.of("routine_name"), "KnowSpec", List.of("file_path", "status"));
        ObjectMapper m = new ObjectMapper();
        Map<String, JsonNode> types = new HashMap<>();
        for (String file : List.of("sprint-phase-task.json", "all-objects.json"))
            m.readTree(Path.of("..", "scripts", "model-migration", "schema", file).toFile()).get("types").fields()
                .forEachRemaining(e -> types.put(e.getKey(), e.getValue()));
        for (Map.Entry<String, List<String>> e : was.entrySet())
            for (String f : e.getValue()) {
                JsonNode n = types.get(e.getKey()).get("fields").get(f);
                assertNotNull(n, e.getKey() + "." + f + ": нет в схеме установщика");
                assertFalse(n.get("db_type").asText().isBlank(), e.getKey() + "." + f + ": без типа базы");
            }
    }

    @Test
    void serviceFieldsAreDeclaredWithReason() {
        Map<String, String> s = LoreModelFile.content().serviceFields();
        for (String p : List.of("mig_src_rid", "regroup", "dict_type")) {
            assertTrue(s.containsKey(p), p + " — служебное поле модели");
            assertFalse(s.get(p).isBlank(), p + ": причина");
            assertTrue(LoreModelTypes.isInternal(p, "slug"), p + ": на поверхности не выводится");
        }
    }

    /**
     * Описанное поле не должно пропасть из паспорта: раньше его значение показывал блок «Не описано в модели» (чтение
     * вершины), а у главного среза такой колонки нет. Поле модели без значения в строке среза берётся из вершины;
     * значение среза не перезаписывается, служебное не подставляется.
     */
    @Test
    void describedFieldTakesValueFromVertexWhenSliceHasNone() {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("title", "Задача");
        Map<String, Object> vertex = Map.of("task_uid", "S/MD-05", "task_id", "MD-05", "order_index", 3, "title", "другое",
            "src", "manual", "mig_src_rid", "#1:2");
        LoreRecordUnmodeled.fillModeled("task", values, vertex);
        assertEquals("MD-05", values.get("task_id"));
        assertEquals(3, values.get("order_index"));
        assertEquals("Задача", values.get("title"), "значение среза не перезаписано");
        assertFalse(values.containsKey("src"), "служебное не подставляется");
        assertFalse(values.containsKey("mig_src_rid"));
    }

    /** Положительный контроль: свойство, которого нет в модели, блок показывает. */
    @Test
    void positiveControlUnknownPropIsShown() {
        assertEquals(Set.of("totally_new_prop"), LoreRecordUnmodeled.of("project", Map.of("slug", "a/b", "totally_new_prop", "x")).keySet());
    }

    /** Паспорт проекта: короткий код, краткое и полное название, описание на трёх языках, адреса и прежние ключи. */
    @Test
    void projectValuesCarryNames() {
        Map<String, Object> row = new HashMap<>();
        row.put("slug", "AIDA/MIDGARD");
        row.put("name", "MIDGARD");
        row.put("short_code", "MIDGARD");
        row.put("short_title", "MIDGARD");
        row.put("short_title_en", "MIDGARD");
        row.put("description", "Хаб GLADSHEIM и сервисы BOKVIT, TEIKN");
        row.put("description_en", "GLADSHEIM hub");
        row.put("aliases", List.of("AIDA/MIDGARD", "AIDA/GLADSHEIM"));
        row.put("hosts", List.of(Map.of("remote", "origin", "role", "primary", "base_url", "https://h/AIDA/MIDGARD")));
        Map<String, Object> v = LoreRecordValues.values("project", row);
        assertEquals("MIDGARD", v.get("short_code"));
        assertEquals("MIDGARD", v.get("short_title"));
        assertEquals("Хаб GLADSHEIM и сервисы BOKVIT, TEIKN", v.get("description"));
        assertEquals("GLADSHEIM hub", v.get("description_en"));
        assertEquals(List.of("AIDA/MIDGARD", "AIDA/GLADSHEIM"), v.get("aliases"));
        assertEquals(row.get("hosts"), v.get("hosts"), "адреса — структурой, kit рисует таблицей");
        row.remove("short_title");
        assertEquals("MIDGARD", LoreRecordValues.values("project", row).get("short_title"), "нет краткого — полное, не пусто");
        assertTrue(LoreSlices.get("project_by_id").baseSql().contains("short_title"));
        assertTrue(LoreSlices.get("git_projects").baseSql().contains("short_title_en"));
    }
}
