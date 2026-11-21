package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-09 — контракт экрана-списка в модели ({@code surfaces.list}): по одному
 * {@code GET /lore/model} клиент (web-next, мобильный клиент Mobilepoc) строит список любого типа без
 * своей таблицы «тип → срез». Раньше это знание жило в web-next/src/lists/screens.ts и в отдельной
 * таблице мобильного kit; у пяти типов (track, user, agent, repository, organization) на телефоне
 * был пустой экран — модель не говорила, как их перечислить.
 *
 * <p>Поля: {@code slice} — срез {@code GET /lore/slice/{slice}} без обязательных параметров (при
 * сегментах — срез сегмента по умолчанию, ради совместимости); {@code segments} — разбиение по статусу,
 * которое уже делает сервер разными срезами ({@code [{key, slice, label_key?, default?}]}, ровно один
 * default); {@code id_key} — колонка кода; {@code title_key} — колонка заголовка; {@code status_key} —
 * колонка статуса (есть у каждого типа, в срезе которого статус есть); {@code record_path} — путь паспорта
 * {@code /lore/record/<type>/{id}}; {@code default_mode} — rows | cards; {@code group_keys} — колонки для
 * группировки; {@code requires_role} — роль, без которой срез отвечает 403 (гейт {@link LoreSlices#ADMIN_ONLY}),
 * в ответе есть всегда, null — гейта нет; {@code project_scoped} — срез режется проектным скоупом (без
 * проектов — 403 SCOPE_EMPTY); {@code since} — версия LORE, с которой срез отдаётся ({@code <=1.17} — был
 * раньше): 404 UNKNOWN_SLICE на сервере старше — «ещё не отдаётся», а не «пусто».
 *
 * <p>Смысл статуса для клиента: есть segments — фильтр статуса серверный (переключатель сегментов, у каждого
 * свой срез); segments нет, а status_key есть — один срез, фильтр статуса на клиенте; нет ни того ни другого —
 * у типа нет статуса. Сверка со срезами — ModelServerConsistencyGuardTest (MC-03).
 *
 * <p>Раздел необязателен: модель, записанная в LORE до MC-09, читается с пустым контрактом.
 */
final class LoreModelList {

    private LoreModelList() {}

    static final Set<String> MODES = Set.of("rows", "cards");

    static final Set<String> SEGMENT_KEYS = Set.of("key", "slice", "label_key", "default");

    /**
     * Имена компонент — ключи файла и ответа (snake_case, как в контракте клиентов). Сегменты — сырые объекты:
     * ключ {@code default} не может быть именем компоненты записи; типизированный вид — {@link #segments(Spec)}.
     */
    record Spec(String slice, List<Object> segments, String id_key, String title_key, String status_key,
                String record_path, String default_mode, List<String> group_keys, String requires_role,
                boolean project_scoped, String since) {}

    /** Сегмент списка: срез с частью записей по статусу. */
    record Segment(String key, String slice, String labelKey, boolean isDefault) {}

    /** {@code surfaces} файла → контракт по типам; раздела нет — пусто. */
    @SuppressWarnings("unchecked")
    static Map<String, Spec> parse(Object surfaces) {
        Map<String, Spec> out = new LinkedHashMap<>();
        if (surfaces == null) return out;
        if (!(surfaces instanceof Map<?, ?> s)) throw new IllegalStateException("файл модели: «surfaces» — ждали объект");
        Object list = s.get("list");
        if (list == null) return out;
        if (!(list instanceof Map<?, ?> l)) throw new IllegalStateException("файл модели: «surfaces.list» — ждали объект");
        for (Map.Entry<String, Object> e : ((Map<String, Object>) l).entrySet())
            out.put(e.getKey(), LoreModelCodec.decode(Spec.class, e.getValue(), "surfaces.list." + e.getKey()));
        return out;
    }

    /** Сегменты записи типизированно; форма проверена {@link #problems}. */
    static List<Segment> segments(Spec s) {
        List<Segment> out = new ArrayList<>();
        for (Object o : s.segments())
            if (o instanceof Map<?, ?> m)
                out.add(new Segment(str(m.get("key")), str(m.get("slice")), str(m.get("label_key")), Boolean.TRUE.equals(m.get("default"))));
        return out;
    }

    /** Согласованность внутри файла: тип известен, обязательное есть, путь паспорта — свой, вид из двух, сегменты целы. */
    static List<String> problems(Map<String, Spec> list, Map<String, LoreRecordRegistry.TypeDef> typeDefs,
                                 Map<String, ?> passport) {
        List<String> bad = new ArrayList<>();
        list.forEach((t, s) -> {
            String w = "surfaces.list." + t;
            if (!typeDefs.containsKey(t)) bad.add(w + ": неизвестный тип");
            if (blank(s.slice())) bad.add(w + ": нет slice");
            if (blank(s.id_key())) bad.add(w + ": нет id_key");
            if (blank(s.title_key())) bad.add(w + ": нет title_key");
            if (!("/lore/record/" + t + "/{id}").equals(s.record_path()))
                bad.add(w + ": record_path «" + s.record_path() + "», ждали /lore/record/" + t + "/{id}");
            if (!passport.containsKey(t)) bad.add(w + ": у типа нет паспорта — открыть запись из списка некуда");
            if (s.default_mode() != null && !MODES.contains(s.default_mode()))
                bad.add(w + ": default_mode «" + s.default_mode() + "», бывают " + MODES);
            if (s.since() != null && !s.since().equals("<=1.17") && !s.since().matches("[0-9]+[.][0-9]+[.][0-9]+"))
                bad.add(w + ": since «" + s.since() + "», ждали X.Y.Z или <=1.17");
            segmentProblems(w, s, bad);
        });
        return bad;
    }

    private static void segmentProblems(String w, Spec s, List<String> bad) {
        if (s.segments().isEmpty()) return;
        if (s.segments().size() < 2) bad.add(w + ".segments: сегмент один — это не разбиение");
        int defaults = 0;
        Set<String> keys = new HashSet<>();
        for (Object o : s.segments()) {
            if (!(o instanceof Map<?, ?> m)) { bad.add(w + ".segments: элемент — не объект"); continue; }
            for (Object k : m.keySet())
                if (!SEGMENT_KEYS.contains(String.valueOf(k))) bad.add(w + ".segments: неизвестный ключ «" + k + "», есть " + SEGMENT_KEYS);
            if (!(m.get("key") instanceof String k) || k.isBlank()) bad.add(w + ".segments: нет key");
            else if (!keys.add(k)) bad.add(w + ".segments: key «" + k + "» дважды");
            if (!(m.get("slice") instanceof String sl) || sl.isBlank()) bad.add(w + ".segments: нет slice");
            if (m.get("label_key") != null && !(m.get("label_key") instanceof String)) bad.add(w + ".segments: label_key — не строка");
            Object d = m.get("default");
            if (d != null && !(d instanceof Boolean)) bad.add(w + ".segments: default — не true/false");
            if (Boolean.TRUE.equals(d)) {
                defaults++;
                if (!String.valueOf(m.get("slice")).equals(s.slice()))
                    bad.add(w + ".segments: slice записи «" + s.slice() + "» ≠ срезу сегмента default «" + m.get("slice") + "»");
            }
        }
        if (defaults != 1) bad.add(w + ".segments: сегментов default " + defaults + ", нужен ровно один");
    }

    /**
     * Раздел ответа и файла: типы по алфавиту, порядок ключей записи постоянный, пустое опущено — кроме
     * requires_role: он есть всегда (null — гейта нет), чтобы форма не зависела от данных (Mobilepoc 21.11).
     */
    static Map<String, Object> surface(Map<String, Spec> list) {
        Map<String, Object> out = new TreeMap<>();
        list.forEach((t, s) -> out.put(t, encode(s)));
        return out;
    }

    static Map<String, Object> encode(Spec s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("slice", s.slice());
        if (!s.segments().isEmpty()) m.put("segments", s.segments());
        m.put("id_key", s.id_key());
        m.put("title_key", s.title_key());
        if (s.status_key() != null) m.put("status_key", s.status_key());
        m.put("record_path", s.record_path());
        if (s.default_mode() != null) m.put("default_mode", s.default_mode());
        if (!s.group_keys().isEmpty()) m.put("group_keys", s.group_keys());
        m.put("requires_role", s.requires_role());
        if (s.project_scoped()) m.put("project_scoped", true);
        if (s.since() != null) m.put("since", s.since());
        return m;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
