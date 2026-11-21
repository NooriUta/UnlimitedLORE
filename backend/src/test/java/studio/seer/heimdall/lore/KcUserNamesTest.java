package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Пакет 1.18 — имена людей из Keycloak. Владелица 21.11.2026: «у людей из KC то ФИО достань, а то только логины»;
 * порядок — «Имя Фамилия». Источник имени по старшинству: имя, заданное человеком (не перетирается) → ФИО из KC →
 * логин. KC только читается.
 */
class KcUserNamesTest {

    static Map<String, Object> row(String sub, String login, String name, String source) {
        Map<String, Object> m = new HashMap<>();
        m.put("kc_sub", sub);
        m.put("login", login);
        m.put("display_name", name);
        m.put("name_source", source);
        return m;
    }

    static JsonObject kc(String id, String username, String first, String last) {
        JsonObject u = new JsonObject().put("id", id).put("username", username);
        if (first != null) u.put("firstName", first);
        if (last != null) u.put("lastName", last);
        return u;
    }

    @Test
    void имяФамилияПоСловуВладелицы() {
        assertEquals("Ирина Петрова", KcUserNames.fullName("Ирина", "Петрова"));
        assertEquals("Ирина", KcUserNames.fullName("Ирина", null));
        assertEquals("Петрова", KcUserNames.fullName("  ", "Петрова"));
        assertNull(KcUserNames.fullName(null, " "), "ни имени, ни фамилии — имени нет, а не пустая строка");
        assertEquals("Ирина Петрова", KcUserNames.fullName(" Ирина ", " Петрова "));
    }

    @Test
    void планНеПеретираетИмяЧеловекаИСчитаетИсходы() {
        List<Map<String, Object>> graph = List.of(
            row("s1", "ivan", "ivan", null),                 // имя = логин → берём ФИО из KC
            row("s2", null, "olga", null),                   // до V92: логин жил в display_name → берём ФИО, логин сохраняем
            row("s3", "petr", "Пётр Великий", "manual"),     // задано человеком — не трогаем
            row("s4", "anna", "Анна К.", null),              // имя ≠ логину, источник не записан — считаем своим, не трогаем
            row("s5", "max", "Макс Старый", "kc"),           // из KC, в KC поменялось → обновляем
            row("s6", "lena", "Лена Смирнова", "kc"),        // из KC, не поменялось → без изменений
            row("s7", "nobody", "nobody", null),             // в KC без имени
            row("s8", "ghost", "ghost", null));              // в KC учётки нет
        JsonArray kcUsers = new JsonArray()
            .add(kc("s1", "ivan", "Иван", "Иванов"))
            .add(kc("s2", "olga", "Ольга", null))
            .add(kc("s3", "petr", "Пётр", "Петров"))
            .add(kc("s4", "anna", "Анна", "Кузнецова"))
            .add(kc("s5", "max", "Максим", "Новый"))
            .add(kc("s6", "lena", "Лена", "Смирнова"))
            .add(kc("s7", "nobody", null, null))
            .add(kc("s9", "outsider", "Вне", "LORE"));       // в KC есть, в LORE нет — не наша забота
        KcUserNames.Plan p = KcUserNames.plan(graph, kcUsers);
        Map<String, String> upd = new HashMap<>();
        for (KcUserNames.Update u : p.updates()) upd.put(u.kcSub(), u.name());
        assertEquals(Map.of("s1", "Иван Иванов", "s2", "Ольга", "s5", "Максим Новый"), upd);
        KcUserNames.Update s2 = p.updates().stream().filter(u -> u.kcSub().equals("s2")).findFirst().orElseThrow();
        assertEquals("olga", s2.login(), "логин из display_name сохраняется до смены имени");
        assertEquals(3, p.updated());
        assertEquals(2, p.manualKept());
        assertEquals(1, p.unchanged());
        assertEquals(List.of("s7"), p.noNameInKc());
        assertEquals(List.of("s8"), p.notInKc());
        assertEquals(8, p.checked());
    }

    @Test
    void kcНедоступен_отказ_аНеЛогины() {
        KcOps.KcCall down = (m, path, json) -> new KcOps.Resp(503, "");
        assertThrows(KcOps.KcFailed.class, () -> KcUserNames.planFromKc(down, List.of(row("s1", "ivan", "ivan", null))));
    }

    @Test
    void kcЧитаетсяСтраницамиИТолькоGet() throws Exception {
        List<String> calls = new ArrayList<>();
        KcOps.KcCall kcCall = (m, path, json) -> {
            calls.add(m + " " + path);
            return new KcOps.Resp(200, new JsonArray().add(kc("s1", "ivan", "Иван", "Иванов")).encode());
        };
        KcUserNames.Plan p = KcUserNames.planFromKc(kcCall, List.of(row("s1", "ivan", "ivan", null)));
        assertEquals(1, p.updated());
        assertTrue(calls.stream().allMatch(c -> c.startsWith("GET /users?")), "в KC ничего не пишем: " + calls);
    }

    /** Раз в сутки при открытии раздела: свежий прогон не повторяется, давний или первый — да. */
    @Test
    void разВСутки() {
        Instant now = Instant.parse("2026-11-21T12:00:00Z");
        assertTrue(KcUserNames.due(null, now, Duration.ofHours(24)));
        assertFalse(KcUserNames.due(now.minus(Duration.ofHours(3)), now, Duration.ofHours(24)));
        assertTrue(KcUserNames.due(now.minus(Duration.ofHours(25)), now, Duration.ofHours(24)));
    }

    /** Ручное имя помечается источником manual — сверка с KC его не перетрёт. */
    @Test
    void ручноеИмяПомечаетсяИсточником() throws Exception {
        String src = java.nio.file.Files.readString(java.nio.file.Path.of(
            "src/main/java/studio/seer/heimdall/lore/LoreUserProfileResource.java"));
        assertTrue(src.contains("name_source = 'manual'"), "профиль не помечает ручное имя");
    }
}
