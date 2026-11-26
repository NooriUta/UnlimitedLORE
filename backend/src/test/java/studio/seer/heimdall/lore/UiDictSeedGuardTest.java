package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_EXT_ISSUES_W2/ISS-02-DICT-SEED-GUARD · свежая база содержит словари, которые читает UI.
 *
 * <p><b>Повод:</b> issue SeidrStudio/UnlimitedLORE#2, вариант 4 автора («регресс-тест: свежая БД обязана содержать
 * словарь для всех dict_type, которые консультирует UI»). На чистой установке v1.19.0 статей {@code area} для кодов
 * фронта не было: {@code dictColor('area', …)} всегда пуст, рисовалась константа {@code AREA_COLOR}, правка цвета в
 * админке ничего не меняла (ADR-LORE-012 / AL-28 на свежей базе). Закрыто шагом V100 (AreaDictSeed); сторож не даёт
 * классу вернуться.
 *
 * <p><b>Правила:</b>
 * <ol>
 *   <li>каждый dict_type, который читает UI (v1 DictionaryProvider и его пользователи, web-next — срез
 *       {@code dictionary} с {@code dict_type}), засевается миграциями на пустую базу — либо стоит в
 *       {@link #KNOWN_GAPS} с причиной;</li>
 *   <li>каждый код, для которого у UI есть константа-фолбэк ({@link #UI_FALLBACKS}), засеян — иначе фолбэк
 *       рисуется навсегда, а словарь недостижим;</li>
 *   <li>{@link #KNOWN_GAPS} — храповик: засеянный тип из него обязан уйти.</li>
 * </ol>
 *
 * <p>«Засеян» — статически, по исходникам миграций: SQL-шаги {@link LoreSchemaMigrations#STEPS} и ядро
 * {@code LoreSchemaInitializer} (INSERT/UPSERT в KnowDictEntry) плюс Java-посевы, чей шаг зарегистрирован в STEPS.
 * Чистый JUnit: Quarkus и база не поднимаются.
 */
class UiDictSeedGuardTest {

    private static final Path REPO = Path.of("..");
    private static final Path LORE = Path.of("src/main/java/studio/seer/heimdall/lore");

    /**
     * Типы, которые UI читает, а миграции на пустую базу не засевают. Каждый — с причиной; новый сюда не добавлять
     * без решения владельца (BLOCKED в [[task:SPRINT_LORE_EXT_ISSUES_W2/ISS-02-DICT-SEED-GUARD]]). Пусто с 25.11.2026:
     * task_type, priority, agent_profile засеяны доводкой v3 ({@link UiDictSeed}, решение владельца «словари сеять
     * каких нет»).
     */
    static final Map<String, String> KNOWN_GAPS = Map.of();

    /** Константы-фолбэки UI: файл → (имя константы → dict_type). */
    static final Map<String, Map<String, String>> UI_FALLBACKS = Map.of(
        "src/components/lore/LoreComponentList.tsx", Map.of("AREA_COLOR", "area"));

    // ── что читает UI ────────────────────────────────────────────────────────

    private static final List<Pattern> UI_READ = List.of(
        Pattern.compile("useDictionary\\(\\s*['\"]([a-z_]+)['\"]"),
        Pattern.compile("dict(?:Color|Icon)\\(\\s*['\"]([a-z_]+)['\"]"),
        Pattern.compile("dict_type\\s*:\\s*['\"]([a-z_]+)['\"]"),
        Pattern.compile("(?<!typeof )\\b(?:r|row|e|entry)\\.dict_type\\s*===\\s*['\"]([a-z_]+)['\"]"));

    static Set<String> uiReadTypes(String src) {
        Set<String> out = new TreeSet<>();
        for (Pattern p : UI_READ) {
            Matcher m = p.matcher(src);
            while (m.find()) out.add(m.group(1));
        }
        return out;
    }

    private static Map<String, Set<String>> uiReads() throws IOException {
        Map<String, Set<String>> byType = new TreeMap<>();
        for (String root : List.of("src", "web-next/src", "kit/src")) {
            Path dir = REPO.resolve(root);
            if (!Files.isDirectory(dir)) continue;
            try (Stream<Path> files = Files.walk(dir)) {
                for (Path f : files.filter(p -> p.toString().matches(".*\\.tsx?$"))
                        .filter(p -> !p.toString().matches(".*\\.(test|spec|stubs?)\\.tsx?$"))
                        .filter(p -> !p.toString().contains("node_modules")).toList()) {
                    for (String t : uiReadTypes(Files.readString(f)))
                        byType.computeIfAbsent(t, k -> new TreeSet<>()).add(REPO.relativize(f).toString().replace('\\', '/'));
                }
            }
        }
        return byType;
    }

    // ── что засевают миграции на пустую базу ─────────────────────────────────

    private static final Pattern SQL_SEED = Pattern.compile("dict_type\\s*=\\s*'([a-z_]+)'\\s*,\\s*code\\s*=\\s*'([^']+)'");

    /** Тип → засеянные коды из SQL-шагов и ядра (INSERT … SET / UPDATE … UPSERT). */
    static Map<String, Set<String>> sqlSeeds(Iterable<String> statements) {
        Map<String, Set<String>> out = new TreeMap<>();
        for (String s : statements) {
            if (s == null || !s.contains("KnowDictEntry ") || !(s.contains("UPSERT") || s.startsWith("INSERT"))) continue;
            Matcher m = SQL_SEED.matcher(s);
            while (m.find()) out.computeIfAbsent(m.group(1), k -> new TreeSet<>()).add(m.group(2).toLowerCase());
        }
        return out;
    }

    private static Map<String, Set<String>> seeded() throws IOException {
        Map<String, Set<String>> out = new TreeMap<>();
        Set<String> stepNames = new TreeSet<>();
        for (LoreSchemaMigrations.Step st : LoreSchemaMigrations.STEPS) {
            stepNames.add(st.name());
            merge(out, sqlSeeds(st.sql()));
        }
        // Ядро пустой базы: строки SQL читаются из исходника (литералы со склейкой не встречаются в сидах словаря).
        String init = Files.readString(LORE.resolve("LoreSchemaInitializer.java"));
        Matcher lit = Pattern.compile("\"((?:INSERT|UPDATE) INTO KnowDictEntry[^\"]*|UPDATE KnowDictEntry[^\"]*)\"").matcher(init);
        List<String> initSql = new java.util.ArrayList<>();
        while (lit.find()) initSql.add(lit.group(1));
        merge(out, sqlSeeds(initSql));
        // Java-посевы: считаются, только если их шаг зарегистрирован в STEPS.
        record JavaSeed(String step, Map<String, List<StatusDictCoreSeed.Entry>> seeds) {}
        for (JavaSeed js : List.of(
                new JavaSeed("java__status_dict_core_seed", StatusDictCoreSeed.SEEDS),
                new JavaSeed(QgStatusDictSeed.STEP, QgStatusDictSeed.SEEDS),
                new JavaSeed(AreaDictSeed.STEP, AreaDictSeed.SEEDS))) {
            if (!stepNames.contains(js.step())) continue;
            js.seeds().forEach((type, entries) -> entries.forEach(e ->
                out.computeIfAbsent(type, k -> new TreeSet<>()).add(e.code().toLowerCase())));
        }
        // Посевы доводки схемы кода (шаги V заморожены на V100, новое — только LoreSchemaAdditive.CHANGES):
        // считаются, только если их запись доводки есть и несёт посев.
        record AdditiveSeed(String change, Map<String, List<StatusDictCoreSeed.Entry>> seeds) {}
        for (AdditiveSeed as : List.of(new AdditiveSeed("ui_dict_seed", UiDictSeed.SEEDS),
                new AdditiveSeed("appearance", PaletteDictSeed.SEEDS))) {
            LoreSchemaAdditive.Change c = LoreSchemaAdditive.change(as.change());
            if (c == null || c.seed() == null) continue;
            as.seeds().forEach((type, entries) -> entries.forEach(e ->
                out.computeIfAbsent(type, k -> new TreeSet<>()).add(e.code().toLowerCase())));
        }
        return out;
    }

    private static void merge(Map<String, Set<String>> into, Map<String, Set<String>> from) {
        from.forEach((k, v) -> into.computeIfAbsent(k, x -> new TreeSet<>()).addAll(v));
    }

    // ── правила ──────────────────────────────────────────────────────────────

    @Test
    void каждый_dict_type_который_читает_UI_засеян_на_пустой_базе() throws IOException {
        Map<String, Set<String>> reads = uiReads();
        assertTrue(reads.size() >= 5, "сторож видит чтения словарей в UI: " + reads.keySet());
        Map<String, Set<String>> seeds = seeded();
        Map<String, Set<String>> missing = new TreeMap<>();
        reads.forEach((type, files) -> {
            if (!seeds.containsKey(type) && !KNOWN_GAPS.containsKey(type)) missing.put(type, files);
        });
        assertEquals(Map.of(), missing,
            "UI читает словарь, которого на свежей базе нет (тип → кто читает). Засейте его шагом миграции; засеяны: "
                + seeds.keySet());
    }

    @Test
    void каждый_код_с_константой_фолбэком_в_UI_засеян_иначе_фолбэк_рисуется_навсегда() throws IOException {
        Map<String, Set<String>> seeds = seeded();
        Map<String, Set<String>> missing = new TreeMap<>();
        for (var file : UI_FALLBACKS.entrySet()) {
            String src = Files.readString(REPO.resolve(file.getKey()));
            for (var c : file.getValue().entrySet()) {
                Set<String> codes = constKeys(src, c.getKey());
                assertFalse(codes.isEmpty(), file.getKey() + ": константа " + c.getKey() + " не найдена — сторож ослеп");
                Set<String> have = seeds.getOrDefault(c.getValue(), Set.of());
                for (String code : codes)
                    if (!have.contains(code.toLowerCase()))
                        missing.computeIfAbsent(c.getValue(), k -> new TreeSet<>()).add(code);
            }
        }
        assertEquals(Map.of(), missing, "коды без статьи словаря на свежей базе: цвет берётся из константы, правка в"
            + " админке не действует (issue #2)");
    }

    @Test
    void храповик_засеянный_тип_уходит_из_KNOWN_GAPS() throws IOException {
        Map<String, Set<String>> seeds = seeded();
        Map<String, Set<String>> reads = uiReads();
        for (String gap : KNOWN_GAPS.keySet()) {
            assertFalse(seeds.containsKey(gap), gap + " уже засеян — уберите его из KNOWN_GAPS");
            assertTrue(reads.containsKey(gap), gap + " UI больше не читает — уберите его из KNOWN_GAPS");
        }
    }

    @Test
    void положительный_контроль_разбор_чтений_и_сидов() {
        assertEquals(Set.of("area", "priority", "harness", "app_setting"), uiReadTypes(
            "dictColor('area', a); useDictionary('priority'); fetchSlice('dictionary', { dict_type: 'harness' });"
                + " r.dict_type === 'app_setting'; typeof r.dict_type === 'string'"));
        assertEquals(Map.of("area", Set.of("research")), sqlSeeds(List.of(
            "UPDATE KnowDictEntry SET dict_type='area', code='research', label_ru='x' UPSERT WHERE dict_type='area' AND code='research'",
            "SELECT code FROM KnowDictEntry WHERE dict_type='product'")));
        assertEquals(Set.of("platform", "api"), constKeys(
            "export const AREA_COLOR: Record<string, string> = {\n  platform: 'var(--acc)',\n  api: 'x',\n};", "AREA_COLOR"));
    }

    /** Ключи объекта-константы {@code const NAME … = { key: …, … };}. */
    static Set<String> constKeys(String src, String name) {
        Matcher m = Pattern.compile("const\\s+" + name + "\\b[^=]*=\\s*\\{(.*?)\\};", Pattern.DOTALL).matcher(src);
        Set<String> out = new TreeSet<>();
        if (!m.find()) return out;
        Matcher k = Pattern.compile("(?m)^\\s*['\"]?([a-z_][a-z0-9_-]*)['\"]?\\s*:").matcher(m.group(1));
        while (k.find()) out.add(k.group(1));
        return out;
    }
}
