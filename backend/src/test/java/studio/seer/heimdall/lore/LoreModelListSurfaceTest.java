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
            Set<String> known = Set.of("slice", "id_key", "title_key", "record_path", "default_mode", "group_keys",
                "requires_role", "project_scoped");
            assertTrue(known.containsAll(s.keySet()), t + ": лишние ключи " + s.keySet());
        }
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
