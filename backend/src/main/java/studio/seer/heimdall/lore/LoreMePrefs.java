package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-04 · decision:D-2026-UXR-VIEWS-SERVER — чистые
 * правила личного слоя: белый список настроек, проверка вида, видимость.
 *
 * <p>Вынесено из {@link LoreMeResource}, чтобы правила проверялись без живой БД
 * и без CDI, а ресурс оставался тонким слоем «прочитать — решить — записать».
 *
 * <p><b>Почему белый список настроек, а не свободный JSON.</b> Свободный мешок
 * ключей превращается в свалку: опечатка во фронте молча заводит второй ключ,
 * и устройство А видит одно, устройство Б — другое. Неизвестный ключ — 400
 * с его именем. Новая настройка = строка здесь, без миграции: хранение —
 * один JSON-текст на пользователя.
 */
final class LoreMePrefs {

    private LoreMePrefs() {}

    enum Kind { BOOL, ENUM, NUMBER }

    /** min/max/step — только у NUMBER; у прочих null. */
    record SettingSpec(Kind kind, Object def, List<String> values, Double min, Double max, Double step) {
        SettingSpec(Kind kind, Object def, List<String> values) { this(kind, def, values, null, null, null); }

        Map<String, Object> describe() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("type", switch (kind) { case BOOL -> "boolean"; case ENUM -> "enum"; case NUMBER -> "number"; });
            m.put("default", def);
            if (kind == Kind.ENUM) m.put("values", values);
            if (kind == Kind.NUMBER) { m.put("min", min); m.put("max", max); m.put("step", step); }
            return m;
        }

        /** Число, прижатое к границам. */
        double clamp(double v) { return Math.max(min, Math.min(max, v)); }
    }

    private static SettingSpec bool(boolean def) { return new SettingSpec(Kind.BOOL, def, List.of()); }
    /** Места показа записи (S4-17): тот же список, что RECORD_PLACEMENTS в kit. Новое место — строка здесь. */
    static final List<String> PASSPORT_PLACES = List.of("left", "right", "bottom", "full");

    /** Допустимые значения настройки места: «auto» (выбора не было) и каждое место списка. */
    private static String[] placeValues() {
        List<String> v = new ArrayList<>();
        v.add("auto");
        v.addAll(PASSPORT_PLACES);
        return v.toArray(new String[0]);
    }

    private static SettingSpec oneOf(String def, String... values) {
        return new SettingSpec(Kind.ENUM, def, List.of(values));
    }
    private static SettingSpec number(double def, double min, double max, double step) {
        return new SettingSpec(Kind.NUMBER, def, List.of(), min, max, step);
    }

    /**
     * Границы множителя масштаба текста (S4-16) — ПРЕДВАРИТЕЛЬНЫЕ: владелица назовёт свои после
     * выкатки («я скажу сколько мин/макс оставить»). Меняются здесь, одной правкой.
     */
    static final double TEXT_SCALE_MIN = 0.8, TEXT_SCALE_MAX = 1.6, TEXT_SCALE_STEP = 0.05;

    /**
     * Личные настройки — список из задачи S2-04, п.4. Умолчания выбраны так,
     * чтобы пустой профиль вёл себя как сегодняшний интерфейс: плотный IDE-вид,
     * тёмная тема, новая навигация — только по явному выбору.
     */
    static final Map<String, SettingSpec> SETTINGS;
    static {
        Map<String, SettingSpec> m = new LinkedHashMap<>();
        m.put("nav_collapse_on_read", bool(false));                          // сворачивать меню при чтении
        m.put("right_column", oneOf("auto", "auto", "shown", "hidden"));     // правая колонка
        m.put("text_size", oneOf("m", "s", "m", "l", "xl"));                 // размер текста (предустановка поверх text_scale)
        // множитель масштаба текста — единственная ось размера (S4-16); вне границ — прижатие, не отказ
        m.put("text_scale", number(1.0, TEXT_SCALE_MIN, TEXT_SCALE_MAX, TEXT_SCALE_STEP));
        m.put("theme", oneOf("dark", "dark", "light", "system"));            // тема
        // плотность: roomy — умолчание v2 (решение владелицы 08.11, SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21)
        m.put("density", oneOf("roomy", "roomy", "compact", "comfortable"));
        // палитра темы — коды kit/tokens/prefs.ts PALETTES (те же, что cookie seer-prefs v1)
        m.put("palette", oneOf("amber-forest", "amber-forest", "lichen", "slate", "juniper", "warm-dark", "mono"));
        m.put("single_key_shortcuts", bool(false));                          // однобуквенные клавиши
        m.put("stripes", bool(false));                                       // полоски в таблицах
        m.put("peek_hover", bool(true));                                    // карточки Peek по наведению (S9-10)
        // вид вкладки «Граф» (GC-03): auto = не выбирал — на компьютере секторы, на телефоне список
        m.put("graph_view", oneOf("auto", "auto", "sectors", "list", "force", "obsidian"));
        m.put("new_navigation", bool(false));                                // флаг «новая навигация»
        // место показа паспорта (S4-17): auto = выбора не было, экран решает сам; не подменять умолчанием
        // MP2-14-PLACE-LEFT (13.11): «слева» — пятое значение
        // S4-17 (14.11): набор мест — одним списком PASSPORT_PLACES (= RECORD_PLACEMENTS kit); modal — строкой там.
        m.put("passport_place", oneOf("auto", placeValues()));
        // показывать технические сведения (S4-TECH-NOTES): коды срезов, оговорки модели, сырые метрики
        m.put("show_tech", bool(false));
        SETTINGS = Collections.unmodifiableMap(m);
    }

    static Map<String, Object> defaults() {
        Map<String, Object> d = new LinkedHashMap<>();
        SETTINGS.forEach((k, s) -> d.put(k, s.def()));
        return d;
    }

    static Map<String, Object> schema() {
        Map<String, Object> d = new LinkedHashMap<>();
        SETTINGS.forEach((k, s) -> d.put(k, s.describe()));
        return d;
    }

    /** Ошибки патча настроек; пустой список — патч годен. {@code null}-значение = «снять личное». */
    static List<String> validateSettingsPatch(Map<String, Object> patch) {
        List<String> errs = new ArrayList<>();
        if (patch == null) return errs;
        patch.forEach((k, v) -> {
            SettingSpec s = SETTINGS.get(k);
            if (s == null) { errs.add("неизвестная настройка: " + k); return; }
            if (v == null) return;
            if (s.kind() == Kind.BOOL && !(v instanceof Boolean))
                errs.add(k + ": ожидается true/false, пришло " + v);
            if (s.kind() == Kind.ENUM && !(v instanceof String str && s.values().contains(str)))
                errs.add(k + ": допустимо " + s.values() + ", пришло " + v);
            if (s.kind() == Kind.NUMBER && !(v instanceof Number n && Double.isFinite(n.doubleValue())))
                errs.add(k + ": ожидается число, пришло " + v);
        });
        return errs;
    }

    /** Значение для хранения/выдачи: число прижимается к границам, прочее — как есть. */
    private static Object normalized(String k, Object v) {
        SettingSpec s = SETTINGS.get(k);
        if (s != null && s.kind() == Kind.NUMBER && v instanceof Number n) return s.clamp(n.doubleValue());
        return v;
    }

    /**
     * Оговорки о прижатых значениях: вне границ — не отказ, а край, и об этом сказано словами
     * (иначе человек увидит не то, что выбрал, и не поймёт почему).
     */
    static List<String> clampNotes(Map<String, Object> patch) {
        List<String> notes = new ArrayList<>();
        if (patch == null) return notes;
        patch.forEach((k, v) -> {
            SettingSpec s = SETTINGS.get(k);
            if (s == null || s.kind() != Kind.NUMBER || !(v instanceof Number n)) return;
            double d = n.doubleValue(), c = s.clamp(d);
            if (c != d) notes.add(k + ": " + d + " вне границ " + s.min() + "…" + s.max() + " — сохранено " + c);
        });
        return notes;
    }

    /** Сохранённые личные значения + патч. Патч уже проверен. null снимает ключ. */
    static Map<String, Object> merge(Map<String, Object> stored, Map<String, Object> patch) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (stored != null) stored.forEach((k, v) -> { if (SETTINGS.containsKey(k) && v != null) out.put(k, v); });
        if (patch != null) patch.forEach((k, v) -> { if (v == null) out.remove(k); else out.put(k, normalized(k, v)); });
        return out;
    }

    /** Действующие значения: умолчания, поверх — личные. Снятые из списка ключи не утекают. */
    static Map<String, Object> effective(Map<String, Object> stored) {
        Map<String, Object> eff = defaults();
        if (stored != null) stored.forEach((k, v) -> {
            if (SETTINGS.containsKey(k) && v != null && validateSettingsPatch(Map.of(k, v)).isEmpty()) eff.put(k, normalized(k, v));
        });
        return eff;
    }

    // ── Вид ─────────────────────────────────────────────────────────────────

    static final Set<String> VISIBILITY = Set.of("me", "all", "roles");
    static final Pattern SECTION = Pattern.compile("[a-z][a-z0-9_-]{0,63}");
    static final Pattern ROLE = Pattern.compile("[a-z][a-z0-9_-]{0,63}");
    static final Pattern REF_TYPE = Pattern.compile("[a-z][a-z0-9_-]{0,31}");
    static final Pattern REF_ID = Pattern.compile("[A-Za-z0-9_./:\\-]{1,200}");
    static final int NAME_MAX = 120;
    static final int QUERY_MAX = 4000;
    /** Сколько недавних записей помнить на человека; хвост срезается при записи. */
    static final int RECENT_CAP = 50;

    /** Причина отказа или {@code null}. Вид = имя + раздел + строка запроса + видимость. */
    static String validateView(String name, String section, String query, String visibility, List<String> roles) {
        if (name == null || name.isBlank()) return "name required";
        if (name.length() > NAME_MAX) return "name longer than " + NAME_MAX;
        if (section == null || !SECTION.matcher(section).matches())
            return "section must match " + SECTION.pattern();
        if (query != null && query.length() > QUERY_MAX) return "query longer than " + QUERY_MAX;
        if (visibility == null || !VISIBILITY.contains(visibility))
            return "visibility must be one of me|all|roles";
        List<String> rs = roles == null ? List.of() : roles;
        if ("roles".equals(visibility) && rs.isEmpty()) return "visibility=roles needs non-empty roles";
        for (String r : rs)
            if (r == null || !ROLE.matcher(r).matches()) return "role must match " + ROLE.pattern() + ": " + r;
        return null;
    }

    /**
     * Видит ли вызывающий вид. Личный вид — только владелец, без исключения для
     * админа: «личное» перестаёт быть личным, как только его видит кто-то ещё.
     */
    static boolean visibleTo(String ownerSub, String visibility, Collection<String> viewRoles,
                             String callerSub, Collection<String> callerRoles) {
        if (ownerSub != null && ownerSub.equals(callerSub)) return true;
        if ("all".equals(visibility)) return true;
        if ("roles".equals(visibility) && viewRoles != null && callerRoles != null)
            for (String r : viewRoles) if (callerRoles.contains(r)) return true;
        return false;
    }

    /** Роли вида храним строкой: отсортировано, без повторов — сравнение без учёта порядка. */
    static String rolesCsv(List<String> roles) {
        if (roles == null || roles.isEmpty()) return "";
        return String.join(",", new TreeSet<>(roles));
    }

    static List<String> parseRolesCsv(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        for (String s : csv.split(",")) if (!s.isBlank()) out.add(s.trim());
        return List.copyOf(out);
    }
}
