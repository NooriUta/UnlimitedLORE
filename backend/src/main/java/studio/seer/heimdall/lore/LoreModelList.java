package studio.seer.heimdall.lore;

import java.util.ArrayList;
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
 * <p>Поля: {@code slice} — срез {@code GET /lore/slice/{slice}} без обязательных параметров;
 * {@code id_key} — колонка строки с кодом записи; {@code title_key} — колонка заголовка;
 * {@code record_path} — путь паспорта {@code /lore/record/<type>/{id}}; {@code default_mode} — rows | cards;
 * {@code group_keys} — колонки для группировки; {@code requires_role} — роль, без которой срез отвечает 403
 * (гейт {@link LoreSlices#ADMIN_ONLY}); {@code project_scoped} — срез режется проектным скоупом (без
 * проектов — 403 SCOPE_EMPTY). Сверка со срезами — ModelServerConsistencyGuardTest (MC-03).
 *
 * <p>Раздел необязателен: модель, записанная в LORE до MC-09, читается с пустым контрактом.
 */
final class LoreModelList {

    private LoreModelList() {}

    static final Set<String> MODES = Set.of("rows", "cards");

    /** Имена компонент — ключи файла и ответа (snake_case, как в контракте клиентов). */
    record Spec(String slice, String id_key, String title_key, String record_path, String default_mode,
                List<String> group_keys, String requires_role, boolean project_scoped) {}

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

    /** Согласованность внутри файла: тип известен, обязательное есть, путь паспорта — свой, вид из двух. */
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
        });
        return bad;
    }

    /** Раздел ответа и файла: типы по алфавиту, пустое опущено (кодек). */
    static Map<String, Object> surface(Map<String, Spec> list) {
        Map<String, Object> out = new TreeMap<>();
        list.forEach((t, s) -> out.put(t, LoreModelCodec.encode(s)));
        return out;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
