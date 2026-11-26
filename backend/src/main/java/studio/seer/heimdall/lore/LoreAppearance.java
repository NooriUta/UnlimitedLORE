package studio.seer.heimdall.lore;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collection;
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
 * Оформление установки — чистые правила ([[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]], прототип
 * docs/prototypes/admin-appearance.html; решения владельца 25.11.2026):
 * <ul>
 *   <li><b>1а</b> — свой стиль хранится в базе: статья справочника {@code palette} с кодом {@code own-…} и полем
 *       {@code tokens_json};</li>
 *   <li><b>2в</b> — два уровня: админ задаёт умолчание и разрешённый набор на установку (словарь {@code app_setting},
 *       ключи {@code appearance.*}), человек выбирает внутри набора; личный выбор {@code LoreMePrefs.palette}
 *       сохраняется и действует, пока он в наборе;</li>
 *   <li><b>3б</b> — на входе JSON или CSS-переменные ({@code :root} / {@code [data-mode="light"]}), хранится JSON;
 *       неизвестный токен, {@code url()}, {@code @import} и сырой шрифт — отказ словами;</li>
 *   <li><b>4а</b> — своих файлов шрифтов нет: шрифт выбирается парой из бандла ({@link #FONT_PAIRS}).</li>
 * </ul>
 * Наши палитры и пары шрифтов — обязательные: они в бандле (seidr.css), их нельзя ни удалить, ни выключить.
 */
final class LoreAppearance {

    private LoreAppearance() {}

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Наши палитры — kit/src/tokens/prefs.ts PALETTES; первая — умолчание кода. */
    static final List<String> BUILTIN_PALETTES = List.of("amber-forest", "lichen", "slate", "juniper", "warm-dark", "mono");
    /** Наши пары шрифтов — kit/src/appearance FONT_PAIRS; первая — умолчание кода. */
    static final List<String> FONT_PAIRS = List.of("pair", "mono");
    static final String DEFAULT_PALETTE = BUILTIN_PALETTES.get(0);
    static final String DEFAULT_FONT = FONT_PAIRS.get(0);

    /** Код своего стиля: префикс own- отделяет его от наших палитр навсегда. */
    static final Pattern OWN_CODE = Pattern.compile("own-[a-z0-9][a-z0-9-]{0,39}");

    // ключи установки в словаре app_setting (значение — label_ru, как у прочих настроек приложения, AL-38)
    static final String K_PALETTE_DEFAULT = "appearance.palette_default";
    static final String K_PALETTES_ALLOWED = "appearance.palettes_allowed";
    static final String K_FONT_DEFAULT = "appearance.font_default";
    static final String K_FONTS_ALLOWED = "appearance.fonts_allowed";
    static final List<String> INSTALL_KEYS = List.of(K_PALETTE_DEFAULT, K_PALETTES_ALLOWED, K_FONT_DEFAULT, K_FONTS_ALLOWED);

    static boolean isBuiltin(String code) { return code != null && BUILTIN_PALETTES.contains(code); }
    static boolean isOwn(String code) { return code != null && OWN_CODE.matcher(code).matches(); }

    // ── свой стиль: проверка ────────────────────────────────────────────────────

    /** Предел исходника: набор токенов — единицы килобайт. */
    static final int SOURCE_MAX = 64 * 1024;

    /** Токены, которые читает интерфейс (имена из kit/src/styles/seidr.css): ядро темы, статусы, виды записей. */
    static final Set<String> ALLOWED_TOKENS = allowed();
    /** Без них свой стиль опирается на amber forest — не отказ, а предупреждение. */
    static final List<String> REQUIRED = List.of("--bg0", "--bg1", "--t1", "--t2", "--acc");
    private static final Set<String> FONT_TOKENS = Set.of("--font", "--display", "--mono");

    private static Set<String> allowed() {
        Set<String> s = new LinkedHashSet<>();
        for (String t : List.of("bg0", "bg1", "bg2", "bg3", "bd", "bdh", "t1", "t2", "t3", "acc", "suc", "wrn", "inf", "dng", "on-accent"))
            s.add("--" + t);
        for (String t : List.of("done", "ready_for_deploy", "uat", "active", "partial", "planned", "design", "todo", "backlog",
                "deferred", "blocked", "cancelled"))
            s.add("--st-" + t);
        for (String t : List.of("milestones", "sprints", "adrs", "decisions", "releases", "components", "tech", "features", "actors", "rbjg"))
            s.add("--section-" + t);
        return java.util.Collections.unmodifiableSet(s);
    }

    private static final Pattern COLOR = Pattern.compile(
        "(?i)#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})"
            + "|(?:rgb|rgba|hsl|hsla)\\([^()]*\\)"
            + "|var\\(--[a-z0-9_-]+\\)"
            + "|color-mix\\((?:[^()]|\\(\\s*--[a-z0-9_-]+\\s*\\)|var\\(--[a-z0-9_-]+\\))*\\)");

    /**
     * Итог проверки: {@code root} — токены тёмного/основного режима, {@code light} — поправки светлого.
     * Годен — ошибок нет и хоть один токен принят.
     */
    record StyleCheck(Map<String, String> root, Map<String, String> light, List<String> errors, List<String> warnings) {
        boolean ok() { return errors.isEmpty() && (!root.isEmpty() || !light.isEmpty()); }

        /** Хранимая форма: {"root":{…},"light":{…}} с ключами по алфавиту — повтор той же загрузки равен себе. */
        String json() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("root", new TreeMap<>(root));
            if (!light.isEmpty()) m.put("light", new TreeMap<>(light));
            try {
                return JSON.writeValueAsString(m);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
    }

    /** Проверить исходник своего стиля: JSON ({токен: значение} или хранимая форма {root, light}) или CSS-переменные. */
    static StyleCheck checkStyle(String src) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Map<String, String> root = new LinkedHashMap<>();
        Map<String, String> light = new LinkedHashMap<>();
        String s = src == null ? "" : src.trim();
        if (s.isEmpty()) {
            errors.add("пусто: вставьте JSON «токен → цвет» или CSS-переменные в :root { … }");
            return new StyleCheck(root, light, errors, warnings);
        }
        if (s.length() > SOURCE_MAX) {
            errors.add("исходник больше " + (SOURCE_MAX / 1024) + " КБ — для набора токенов это слишком много");
            return new StyleCheck(root, light, errors, warnings);
        }
        String low = s.toLowerCase(Locale.ROOT);
        if (low.contains("@import") || low.contains("url("))
            errors.add("@import или url(): внешние загрузки запрещены защитой страницы (CSP) — свой стиль меняет только цвета");
        if (s.startsWith("{")) readJson(s, root, light, errors);
        else readCss(s, root, light, errors);
        validatePairs(root, errors, warnings, "");
        validatePairs(light, errors, warnings, "[data-mode=\"light\"] ");
        List<String> miss = REQUIRED.stream().filter(k -> !root.containsKey(k)).toList();
        if (errors.isEmpty() && !miss.isEmpty())
            warnings.add("не заданы " + String.join(", ", miss) + " — возьмутся из amber forest; проверьте контраст в предпросмотре");
        if (errors.isEmpty() && root.isEmpty() && light.isEmpty()) errors.add("ни одного токена не принято");
        return new StyleCheck(root, light, errors, warnings);
    }

    private static void readJson(String s, Map<String, String> root, Map<String, String> light, List<String> errors) {
        Map<String, Object> m;
        try {
            m = JSON.readValue(s, new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            errors.add("JSON не читается: " + firstLine(e.getMessage()));
            return;
        }
        boolean stored = m.containsKey("root") || m.containsKey("light");
        if (stored) {
            for (Map.Entry<String, Object> e : m.entrySet()) {
                Map<String, String> into = "root".equals(e.getKey()) ? root : "light".equals(e.getKey()) ? light : null;
                if (into == null) { errors.add("«" + e.getKey() + "» — в хранимой форме бывают только root и light"); continue; }
                if (!(e.getValue() instanceof Map<?, ?> inner)) { errors.add(e.getKey() + ": ожидается объект «токен → цвет»"); continue; }
                inner.forEach((k, v) -> into.put(String.valueOf(k).trim(), v == null ? "" : String.valueOf(v).trim()));
            }
        } else {
            m.forEach((k, v) -> {
                if (v instanceof Map || v instanceof List) errors.add(k + ": ожидается строка-цвет, пришёл " + (v instanceof Map ? "объект" : "список"));
                else root.put(k.trim(), v == null ? "" : String.valueOf(v).trim());
            });
        }
    }

    private static final Pattern BLOCK = Pattern.compile("([^{}]+)\\{([^{}]*)\\}");
    private static final Pattern SEL_ROOT = Pattern.compile(":root|\\[data-mode=['\"]?dark['\"]?\\]|:root\\[data-mode=['\"]?dark['\"]?\\]");
    private static final Pattern SEL_LIGHT = Pattern.compile("\\[data-mode=['\"]?light['\"]?\\]|:root\\[data-mode=['\"]?light['\"]?\\]");

    private static void readCss(String raw, Map<String, String> root, Map<String, String> light, List<String> errors) {
        String s = raw.replaceAll("(?s)/\\*.*?\\*/", " ");
        Matcher m = BLOCK.matcher(s);
        int end = 0;
        boolean any = false;
        StringBuilder outside = new StringBuilder();
        while (m.find()) {
            any = true;
            outside.append(s, end, m.start(1));
            end = m.end();
            String sel = m.group(1).trim();
            Map<String, String> into;
            if (SEL_ROOT.matcher(sel).matches()) into = root;
            else if (SEL_LIGHT.matcher(sel).matches()) into = light;
            else {
                errors.add("селектор «" + sel + "»: разрешены только :root и [data-mode=\"light\"] — свой стиль меняет токены, а не элементы");
                continue;
            }
            for (String d : m.group(2).split(";")) {
                String decl = d.trim();
                if (decl.isEmpty()) continue;
                int c = decl.indexOf(':');
                if (c <= 0) { errors.add("«" + decl + "» — не пара «токен: значение»"); continue; }
                into.put(decl.substring(0, c).trim(), decl.substring(c + 1).trim());
            }
        }
        outside.append(s.substring(end));
        String rest = outside.toString().replaceAll("(?i)@import[^;]*;?", "").trim();
        if (!any) errors.add("не нашли блок вида :root { --токен: значение; }");
        else if (!rest.isEmpty()) errors.add("текст вне блоков :root / [data-mode=\"light\"]: «" + abbreviate(rest) + "»");
    }

    private static void validatePairs(Map<String, String> pairs, List<String> errors, List<String> warnings, String where) {
        List<String> drop = new ArrayList<>();
        for (Map.Entry<String, String> e : pairs.entrySet()) {
            String k = e.getKey(), v = e.getValue();
            String bad = pairRefusal(k, v);
            if (bad != null) { errors.add(where + bad); drop.add(k); }
        }
        drop.forEach(pairs::remove);
    }

    /** Причина отказа пары или null — пара годна. */
    static String pairRefusal(String k, String v) {
        String kl = k.toLowerCase(Locale.ROOT);
        if (kl.equals("font") || kl.startsWith("font-") || kl.startsWith("--fs-"))
            return "«" + k + ": " + v + "» — сырой шрифт или кегль: шкала --fs-* и гарнитуры только наши, пара шрифтов выбирается на вкладке «Шрифты и палитра»";
        if (FONT_TOKENS.contains(kl))
            return k + ": своих шрифтов установка не принимает (решение 4а) — пара шрифтов выбирается из наших на вкладке «Шрифты и палитра»";
        if (!k.startsWith("--"))
            return "«" + k + "» — это CSS-свойство, а не токен: разрешены только переменные темы (--bg0, --acc …)";
        if (!ALLOWED_TOKENS.contains(k))
            return k + " — неизвестная переменная, интерфейс её не читает; допустимы ядро (--bg0…--dng, --on-accent), статусы --st-*, виды --section-*";
        if (v.toLowerCase(Locale.ROOT).contains("url("))
            return k + ": url() запрещён — свой стиль задаёт только цвета";
        if (!COLOR.matcher(v).matches())
            return k + ": «" + v + "» — не цвет; ждём #hex, rgb()/hsl(), color-mix() или var(--токен)";
        return null;
    }

    /** Хранимый tokens_json → {root, light}; битое — пусто (такой стиль не рисуется, админка показывает причину). */
    static Map<String, Map<String, String>> parseStored(Object tokensJson) {
        Map<String, Map<String, String>> out = new LinkedHashMap<>();
        if (tokensJson == null || String.valueOf(tokensJson).isBlank()) return out;
        StyleCheck c = checkStyle(String.valueOf(tokensJson));
        if (!c.ok()) return out;
        out.put("root", new TreeMap<>(c.root()));
        if (!c.light().isEmpty()) out.put("light", new TreeMap<>(c.light()));
        return out;
    }

    private static String firstLine(String m) {
        if (m == null) return "причина не названа";
        int i = m.indexOf('\n');
        return i < 0 ? m : m.substring(0, i);
    }

    private static String abbreviate(String s) {
        String one = s.replaceAll("\\s+", " ");
        return one.length() <= 60 ? one : one.substring(0, 57) + "…";
    }

    // ── установка: умолчание и разрешённый набор (2в) ──────────────────────────

    /** Действующие настройки установки; notes — что в базе не так и чем заменено (словами, не молча). */
    record Install(String paletteDefault, List<String> palettesAllowed, String fontDefault, List<String> fontsAllowed,
                   List<String> notes) {}

    /**
     * Из строк {@code app_setting} (dict_type, code, label_ru, is_active) и кодов включённых своих стилей.
     * Набор не задан — разрешено всё; умолчание не задано — первое из кода, если оно в наборе, иначе первое набора.
     */
    static Install install(List<Map<String, Object>> appSettingRows, Collection<String> ownActive) {
        Map<String, String> v = new LinkedHashMap<>();
        if (appSettingRows != null)
            for (Map<String, Object> r : appSettingRows) {
                if (!"app_setting".equals(str(r.get("dict_type"))) || Boolean.FALSE.equals(r.get("is_active"))) continue;
                String code = str(r.get("code"));
                if (INSTALL_KEYS.contains(code)) v.put(code, str(r.get("label_ru")));
            }
        List<String> notes = new ArrayList<>();
        List<String> palettes = new ArrayList<>(BUILTIN_PALETTES);
        if (ownActive != null) for (String o : ownActive) if (isOwn(o) && !palettes.contains(o)) palettes.add(o);
        List<String> pAllowed = allowedOf(v.get(K_PALETTES_ALLOWED), palettes, "палитр", notes);
        String pDef = defaultOf(v.get(K_PALETTE_DEFAULT), DEFAULT_PALETTE, pAllowed, "палитры", notes);
        List<String> fAllowed = allowedOf(v.get(K_FONTS_ALLOWED), FONT_PAIRS, "пар шрифтов", notes);
        String fDef = defaultOf(v.get(K_FONT_DEFAULT), DEFAULT_FONT, fAllowed, "пары шрифтов", notes);
        return new Install(pDef, List.copyOf(pAllowed), fDef, List.copyOf(fAllowed), List.copyOf(notes));
    }

    /** Набор установки не задан в базе — всё разрешено, умолчания из кода. */
    static Install installDefaults() { return install(List.of(), List.of()); }

    static List<String> splitCsv(String csv) {
        List<String> out = new ArrayList<>();
        if (csv == null) return out;
        for (String p : csv.split(",")) { String t = p.trim(); if (!t.isEmpty() && !out.contains(t)) out.add(t); }
        return out;
    }

    private static List<String> allowedOf(String csv, List<String> known, String what, List<String> notes) {
        List<String> set = splitCsv(csv);
        if (set.isEmpty()) return new ArrayList<>(known);
        List<String> out = new ArrayList<>();
        for (String c : known) if (set.contains(c)) out.add(c);
        List<String> unknown = set.stream().filter(c -> !known.contains(c)).toList();
        if (!unknown.isEmpty()) notes.add("набор " + what + ": неизвестные или выключенные коды " + unknown + " пропущены");
        if (out.isEmpty()) {
            notes.add("набор " + what + " пуст после проверки — разрешено всё");
            return new ArrayList<>(known);
        }
        return out;
    }

    private static String defaultOf(String set, String codeDefault, List<String> allowed, String what, List<String> notes) {
        String s = set == null ? "" : set.trim();
        if (!s.isEmpty()) {
            if (allowed.contains(s)) return s;
            notes.add("умолчание " + what + " «" + s + "» вне разрешённого набора — взято «"
                + (allowed.contains(codeDefault) ? codeDefault : allowed.get(0)) + "»");
        }
        return allowed.contains(codeDefault) ? codeDefault : allowed.get(0);
    }

    /** Личный выбор действует, только если он в наборе установки; иначе — умолчание установки (2в). */
    static String resolve(String personal, String installDefault, List<String> allowed) {
        return personal != null && allowed.contains(personal) ? personal : installDefault;
    }

    /** Действующие настройки человека поверх набора установки: palette и font_pair. */
    static Map<String, Object> overlay(Map<String, Object> effective, Map<String, Object> stored, Install inst) {
        Map<String, Object> out = new LinkedHashMap<>(effective);
        Map<String, Object> st = stored == null ? Map.of() : stored;
        out.put("palette", resolve(st.get("palette") instanceof String p ? p : null, inst.paletteDefault(), inst.palettesAllowed()));
        out.put("font_pair", resolve(st.get("font_pair") instanceof String f ? f : null, inst.fontDefault(), inst.fontsAllowed()));
        return out;
    }

    /** Отказ личной правки вне набора установки — словами; null — правка годна. */
    static String personalRefusal(Map<String, Object> patch, Install inst) {
        if (patch == null) return null;
        List<String> errs = new ArrayList<>();
        if (patch.get("palette") instanceof String p && !inst.palettesAllowed().contains(p))
            errs.add("палитра «" + p + "» не входит в набор установки " + inst.palettesAllowed() + " — его задаёт админ (Оформление)");
        if (patch.get("font_pair") instanceof String f && !inst.fontsAllowed().contains(f))
            errs.add("пара шрифтов «" + f + "» не входит в набор установки " + inst.fontsAllowed() + " — его задаёт админ (Оформление)");
        return errs.isEmpty() ? null : String.join("; ", errs);
    }

    /**
     * Отказ записи ключа установки {@code appearance.*} в app_setting; null — годно или ключ не наш.
     * Коды проверяются по форме (наши или own-…): включён ли свой стиль, решает {@link #install} при чтении.
     */
    static String installSettingRefusal(String key, String value) {
        if (!INSTALL_KEYS.contains(key) || value == null || value.isBlank()) return null;
        boolean fonts = key.equals(K_FONT_DEFAULT) || key.equals(K_FONTS_ALLOWED);
        List<String> codes = key.endsWith("_allowed") ? splitCsv(value) : List.of(value.trim());
        List<String> bad = new ArrayList<>();
        for (String c : codes)
            if (fonts ? !FONT_PAIRS.contains(c) : !(isBuiltin(c) || isOwn(c))) bad.add(c);
        if (bad.isEmpty()) return null;
        return key + ": неизвестные коды " + bad + "; допустимы " + (fonts ? FONT_PAIRS : BUILTIN_PALETTES + " и свои own-…");
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o).trim(); }
}
