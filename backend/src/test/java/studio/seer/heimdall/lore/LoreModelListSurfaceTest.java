package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-09 — контракт экрана-списка в модели: клиент (web-next и мобильный
 * клиент Mobilepoc) строит СПИСОК любого типа по одному {@code GET /lore/model}, без сборки клиента.
 *
 * <p>Повод: у web-next конфиг экрана жил в {@code web-next/src/lists/screens.ts}, у мобильного kit —
 * своя таблица; пять из 25 типов (track, user, agent, repository, organization) на телефоне были
 * пустым экраном — модель не говорила, как их перечислить.
 *
 * <p>Форма {@code surfaces.list.<type>}: {@code slice}, {@code id_key}, {@code title_key},
 * {@code record_path} — обязательны; {@code default_mode} (rows | cards), {@code group_keys},
 * {@code requires_role}, {@code project_scoped} — по необходимости. Сверка ключей со срезами —
 * {@link ModelServerConsistencyGuardTest} (MC-03).
 */
class LoreModelListSurfaceTest {

    @SuppressWarnings("unchecked")
    static Map<String, Object> servedList() {
        Map<String, Object> surfaces = (Map<String, Object>) LoreModelGoldenTest.modelDoc().get("surfaces");
        assertNotNull(surfaces, "в /lore/model нет surfaces");
        Object list = surfaces.get("list");
        assertInstanceOf(Map.class, list, "/lore/model не отдаёт surfaces.list — клиент не построит список из модели");
        return (Map<String, Object>) list;
    }

    /** Типы, разделы которых стоят в общем меню модели (nav): разделы вне типов (news, tags, settings) не в счёт. */
    static Set<String> navTypes() {
        LoreModelFile.Content c = LoreModelFile.content();
        Set<String> out = new TreeSet<>();
        for (LoreModelNav.Group g : c.nav())
            for (LoreModelNav.Item i : g.items())
                if (c.typeDefs().containsKey(i.section())) out.add(i.section());
        return out;
    }

    @Test
    void каждыйТипМенюИмеетКонтрактСписка() {
        Map<String, Object> list = servedList();
        List<String> missing = new ArrayList<>();
        for (String t : navTypes()) if (!list.containsKey(t)) missing.add(t);
        assertEquals(List.of(), missing, "раздел в меню, а как его перечислить — модель не говорит (пустой экран на телефоне)");
        assertFalse(navTypes().isEmpty(), "положительный контроль: в меню есть типы");
    }

    /** Пять типов, которые на телефоне были пустым экраном, — контракт есть у каждого, и у трека/агента вне меню тоже. */
    @Test
    void пятьПустыхЭкрановТелефонаЗакрыты() {
        Map<String, Object> list = servedList();
        for (String t : List.of("track", "user", "agent", "repository", "organization"))
            assertTrue(list.containsKey(t), "нет surfaces.list." + t);
    }

    @Test
    @SuppressWarnings("unchecked")
    void формаКонтракта() {
        LoreModelFile.Content c = LoreModelFile.content();
        Map<String, Object> list = servedList();
        for (Map.Entry<String, Object> e : list.entrySet()) {
            String t = e.getKey();
            Map<String, Object> s = (Map<String, Object>) e.getValue();
            assertTrue(c.typeDefs().containsKey(t), "surfaces.list: неизвестный тип " + t);
            for (String k : List.of("slice", "id_key", "title_key", "record_path"))
                assertTrue(s.get(k) instanceof String v && !v.isBlank(), t + "." + k + " обязателен");
            assertEquals("/lore/record/" + t + "/{id}", s.get("record_path"), t + ": путь паспорта");
            assertTrue(c.passport().containsKey(t), t + ": у типа нет паспорта — открыть запись из списка некуда");
            Object mode = s.get("default_mode");
            if (mode != null) assertTrue(Set.of("rows", "cards").contains(mode), t + ".default_mode: " + mode);
            Object gk = s.get("group_keys");
            if (gk != null) assertInstanceOf(List.class, gk, t + ".group_keys — массив");
            // Mobilepoc 21.11: requires_role есть в каждой записи (null — гейта нет), формат стабилен; since — с какой версии срез отдаётся.
            assertTrue(s.containsKey("requires_role"), t + ": requires_role должен быть всегда (null — гейта нет)");
            assertTrue(s.get("since") instanceof String v && (v.equals("<=1.17") || v.matches("[0-9]+[.][0-9]+[.][0-9]+")), t + ".since: " + s.get("since"));
            Set<String> known = Set.of("slice", "id_key", "title_key", "status_key", "record_path", "default_mode", "group_keys",
                "segments", "requires_role", "project_scoped", "since");
            assertTrue(known.containsAll(s.keySet()), t + ": лишние ключи " + s.keySet());
        }
    }

    /**
     * Владелица 21.11.2026: «закрытые задачи тоже отдай; подумай, как указать, что в одном случае фильтр по
     * статусу, а во втором нет». Сервер делит задачи двумя срезами — open_tasks и closed_tasks: это сегменты
     * (фильтр статуса серверный), slice верхнего уровня = сегмент по умолчанию (совместимость).
     */
    @Test
    @SuppressWarnings("unchecked")
    void задачиОтдаютсяДвумяСегментами() {
        Map<String, Object> task = (Map<String, Object>) servedList().get("task");
        List<Map<String, Object>> seg = (List<Map<String, Object>>) task.get("segments");
        assertNotNull(seg, "у задач нет segments — закрытые клиенту не достать");
        assertEquals(List.of("open", "closed", "all"), seg.stream().map(s -> s.get("key")).toList());
        assertEquals(List.of("open_tasks", "closed_tasks", "all_tasks"), seg.stream().map(s -> s.get("slice")).toList());
        assertEquals(Boolean.TRUE, seg.get(0).get("default"));
        assertEquals(task.get("slice"), seg.get(0).get("slice"), "slice верхнего уровня = сегмент по умолчанию");
        assertEquals("status_raw", task.get("status_key"));
    }

    /** Форма сегментов: ровно один по умолчанию, ключи уникальны, slice верхнего уровня = срез умолчания. */
    @Test
    @SuppressWarnings("unchecked")
    void формаСегментов() {
        for (Map.Entry<String, Object> e : servedList().entrySet()) {
            Map<String, Object> s = (Map<String, Object>) e.getValue();
            Object raw = s.get("segments");
            if (raw == null) continue;
            List<Map<String, Object>> seg = (List<Map<String, Object>>) raw;
            String t = e.getKey();
            assertTrue(seg.size() >= 2, t + ": сегмент один — это не разбиение");
            assertEquals(1, seg.stream().filter(x -> Boolean.TRUE.equals(x.get("default"))).count(), t + ": ровно один default");
            assertEquals(seg.size(), seg.stream().map(x -> x.get("key")).distinct().count(), t + ": ключи сегментов уникальны");
            Map<String, Object> def = seg.stream().filter(x -> Boolean.TRUE.equals(x.get("default"))).findFirst().orElseThrow();
            assertEquals(s.get("slice"), def.get("slice"), t + ": slice верхнего уровня = сегмент по умолчанию");
            for (Map<String, Object> x : seg)
                assertTrue(Set.of("key", "slice", "label_key", "default").containsAll(x.keySet()), t + ": лишние ключи сегмента " + x.keySet());
        }
    }

    /**
     * Mobilepoc 21.11: на проде v1.17.28 /lore/slice/organizations → 404 UNKNOWN_SLICE, и клиент не отличит его
     * от «пусто». since называет версию, с которой срез отдаётся: срезов organizations и repositories в v1.17.28
     * нет (сверено по тегу), остальные срезы контракта там уже были.
     */
    @Test
    @SuppressWarnings("unchecked")
    void sinceНазываетНовыеСрезы() {
        Map<String, Object> list = servedList();
        for (String t : List.of("organization", "repository"))
            assertEquals("1.18.0", ((Map<String, Object>) list.get(t)).get("since"), t);
        for (String t : List.of("task", "sprint", "agent", "track", "user"))
            assertEquals("<=1.17", ((Map<String, Object>) list.get(t)).get("since"), t);
    }

    /**
     * 1.18 (#1699, раздел #1714): тип pr в меню под «Релизами» — список всех PR срезом prs (скоуп проекта), паспорт
     * /lore/record/pr/{id}. Среза prs в v1.17 не было — since 1.18.0.
     */
    @Test
    @SuppressWarnings("unchecked")
    void prПеречисляетсяСрезомPrs() {
        Map<String, Object> pr = (Map<String, Object>) servedList().get("pr");
        assertNotNull(pr, "нет surfaces.list.pr — раздел «PR» есть в меню, а телефону его не перечислить");
        assertEquals("prs", pr.get("slice"));
        assertEquals("pr_uid", pr.get("id_key"));
        assertEquals("title", pr.get("title_key"));
        assertEquals("state", pr.get("status_key"));
        assertEquals(Boolean.TRUE, pr.get("project_scoped"));
        assertEquals("1.18.0", pr.get("since"));
    }

    /** Версия сервера рядом с моделью: без неё since не с чем сравнить. Тот же источник, что /lore/version. */
    @Test
    void моделиОтдаётсяВерсияСервера() throws Exception {
        Map<String, Object> info = LoreVersionResource.info("v1.18.0");
        assertEquals("v1.18.0", info.get("release"));
        assertTrue(info.containsKey("commit") && info.containsKey("schema_version"));
        assertNull(LoreVersionResource.info(null).get("release"), "тега нет — null, а не выдуманная версия");
        String src = java.nio.file.Files.readString(java.nio.file.Path.of(
            "src/main/java/studio/seer/heimdall/lore/LoreModelResource.java"));
        assertTrue(src.contains("doc.put(\"server\", LoreVersionResource.info("), "/lore/model не отдаёт версию сервера");
    }

    /** Сегмент без default или с двумя — отказ разбора словами. */
    @Test
    @SuppressWarnings("unchecked")
    void дваСегментаПоУмолчаниюОтказывают() throws Exception {
        io.vertx.core.json.JsonObject m = new io.vertx.core.json.JsonObject(LoreModelLiveReplaceTest.canon());
        io.vertx.core.json.JsonArray seg = m.getJsonObject("surfaces").getJsonObject("list").getJsonObject("task").getJsonArray("segments");
        seg.getJsonObject(1).put("default", true);
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(m.encode()));
        assertTrue(e.getMessage().contains("default"), e.getMessage());
    }

    /** Раздел отдан — в missing его больше нет: «описано» и «не описано» не путаются. */
    @Test
    @SuppressWarnings("unchecked")
    void missingБольшеНеНазываетСписок() {
        List<String> missing = (List<String>) LoreModelGoldenTest.modelDoc().get("missing");
        assertFalse(missing.contains("surfaces:list"), "surfaces.list отдан, а missing говорит, что его нет");
    }

    /** Файл → разбор → вывод: раздел не теряется (разбор не выбрасывает незнакомый верхний ключ). */
    @Test
    void разделПереживаетРазборИВывод() {
        String rendered = LoreModelFile.render(LoreModelFile.content());
        assertTrue(rendered.contains("\"surfaces\" : {"), "render потерял surfaces");
        assertEquals(LoreModelFile.content().listSurface(), LoreModelFile.parse(rendered).listSurface());
    }

    /** Модель из LORE, записанная до MC-09 (без surfaces), читается: раздел пуст, а не отказ разбора. */
    @Test
    void модельБезРазделаЧитается() throws Exception {
        io.vertx.core.json.JsonObject m = new io.vertx.core.json.JsonObject(LoreModelLiveReplaceTest.canon());
        m.remove("surfaces");
        assertEquals(Map.of(), LoreModelFile.parse(m.encode()).listSurface());
    }

    /** Ошибка в контракте — отказ словами при разборе, а не тихий экран без строк. */
    @Test
    void плохойКонтрактОтказывает() throws Exception {
        io.vertx.core.json.JsonObject m = new io.vertx.core.json.JsonObject(LoreModelLiveReplaceTest.canon());
        m.getJsonObject("surfaces").getJsonObject("list").getJsonObject("sprint").put("record_path", "/lore/record/task/{id}");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(m.encode()));
        assertTrue(e.getMessage().contains("record_path"), e.getMessage());
    }
}
