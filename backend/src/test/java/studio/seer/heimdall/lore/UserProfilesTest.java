package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-07 — профиль автора: имя и аватар человека, один источник для LORE и miniLORE.
 *
 * <p>Правила, которые проверяет этот класс:
 * <ul>
 *   <li>свой профиль человек меняет сам, чужой — только админ (владелица 15.11.2026: «сам пользователь конечно»);</li>
 *   <li>дверь чтения отдаёт имя, логин и ОТНОСИТЕЛЬНЫЙ адрес аватара; почты и ролей в ответе нет;</li>
 *   <li>неизвестный id — строка с found=false, а не молчаливое отсутствие;</li>
 *   <li>нет аватара — avatar_url=null (клиент рисует инициалы), а не выдуманная картинка;</li>
 *   <li>ETag аватара — хэш содержимого из ключа: сменили картинку — сменился ключ и ETag.</li>
 * </ul>
 * Контракт согласован с сессией miniLORE 15.11.2026.
 */
class UserProfilesTest {

    @Test
    void свойПрофильМеняетСам_чужой_толькоАдмин() {
        assertTrue(UserProfiles.canEdit("sub-1", "viewer", "sub-1"), "свой — сам, даже viewer");
        assertFalse(UserProfiles.canEdit("sub-1", "viewer", "sub-2"), "чужой без admin — нельзя");
        assertFalse(UserProfiles.canEdit("sub-1", "editor", "sub-2"), "чужой без admin — нельзя");
        assertTrue(UserProfiles.canEdit("sub-1", "admin", "sub-2"), "чужой — админ");
        assertTrue(UserProfiles.canEdit("sub-1", "superadmin", "sub-2"), "чужой — суперадмин");
        assertFalse(UserProfiles.canEdit(null, "viewer", "sub-2"), "без токена свой не опознать");
        assertFalse(UserProfiles.canEdit(null, null, null), "пустой вызов — нельзя");
    }

    @Test
    void адресАватара_относительный_аНеПолный() {
        assertEquals("/lore/users/sub-1/avatar", UserProfiles.avatarUrl("sub-1", "user/sub-1/abc123.png"));
        assertNull(UserProfiles.avatarUrl("sub-1", null), "аватара нет — null, клиент рисует инициалы");
        assertNull(UserProfiles.avatarUrl("sub-1", " "), "пустой ключ — тоже нет аватара");
    }

    @Test
    void etag_хэшСодержимогоИзКлюча() {
        assertEquals("\"abc123\"", UserProfiles.etagOf("user/sub-1/abc123.png"));
        assertNull(UserProfiles.etagOf(null));
    }

    @Test
    void строкаОтвета_безПочтыИРолей_иЧестноеНеНайден() {
        Map<String, Object> db = new HashMap<>();
        db.put("kc_sub", "sub-1");
        db.put("login", "omiloreadmin");
        db.put("display_name", "Алёна");
        db.put("avatar_ref", "user/sub-1/abc123.png");
        db.put("email", "x@y"); // если когда-то появится в выборке — наружу не уходит
        db.put("role", "admin");
        Map<String, Object> row = UserProfiles.row("omiloreadmin", db);
        assertEquals(Map.of("kc_sub", "sub-1", "login", "omiloreadmin", "display_name", "Алёна",
            "avatar_url", "/lore/users/sub-1/avatar", "found", true), row);

        Map<String, Object> missing = UserProfiles.row("nobody", null);
        assertEquals(false, missing.get("found"));
        assertEquals("nobody", missing.get("requested"));
        assertNull(missing.get("avatar_url"));
    }

    @Test
    void имяБезВыбора_логин_аНеПусто() {
        Map<String, Object> db = new HashMap<>();
        db.put("kc_sub", "sub-1");
        db.put("login", "vasilisk");
        Map<String, Object> row = UserProfiles.row("sub-1", db);
        assertEquals("vasilisk", row.get("display_name"), "имя не выбрано — показываем логин");
        assertNull(row.get("avatar_url"));
    }

    @Test
    void имяПроверяется_пустоеДлинноеИУправляющиеСимволы_отказ() {
        assertNull(UserProfiles.nameRefusal("Алёна Фролова"));
        assertNotNull(UserProfiles.nameRefusal(" "));
        assertNotNull(UserProfiles.nameRefusal("x".repeat(81)));
        assertNotNull(UserProfiles.nameRefusal("a\u0000b"));
        assertNotNull(UserProfiles.nameRefusal(null));
    }

    @Test
    void картинкаАватара_толькоPngJpegWebp_иНеБольше2Мб() {
        assertNull(UserProfiles.imageRefusal("image/png", 1000));
        assertNull(UserProfiles.imageRefusal("image/jpeg", 2 * 1024 * 1024));
        assertNull(UserProfiles.imageRefusal("image/webp", 10));
        assertNotNull(UserProfiles.imageRefusal("image/svg+xml", 10), "svg — исполняемый, не берём");
        assertNotNull(UserProfiles.imageRefusal("image/gif", 10));
        assertNotNull(UserProfiles.imageRefusal("image/png", 2 * 1024 * 1024 + 1));
        assertNotNull(UserProfiles.imageRefusal(null, 10));
    }

    @Test
    void списокId_чистится_иОграничен() {
        assertEquals(List.of("a", "b"), UserProfiles.parseIds(" a, ,b,a "));
        assertEquals(List.of(), UserProfiles.parseIds(null));
        assertEquals(200, UserProfiles.parseIds(String.join(",", java.util.Collections.nCopies(500, "x"))
            .replace("x", "") + String.join(",", java.util.stream.IntStream.range(0, 500).mapToObj(i -> "u" + i).toList())).size(),
            "не больше 200 за раз");
    }

    @Test
    void шагV92_логинИАватар_иКопияЛогинаИзИмени() {
        LoreSchemaMigrations.Step v92 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 92).findFirst().orElseThrow(() -> new AssertionError("шага V92 нет"));
        String sql = String.join("\n", v92.sql());
        assertTrue(sql.contains("CREATE PROPERTY KnowUser.login"), sql);
        assertTrue(sql.contains("CREATE PROPERTY KnowUser.avatar_ref"), sql);
        // Перенос данных НЕ в шаге (сторож аддитивности v1): у старых записей логин читается как
        // coalesce(login, display_name) — до V92 его писало назначение ролей в display_name.
        assertFalse(sql.toUpperCase().contains("UPDATE"), "шаг только объявляет");
        assertFalse(sql.toUpperCase().contains("DELETE"), "шаг только добавляет");
        assertFalse(sql.toUpperCase().contains("DROP"), "шаг только добавляет");
    }
}
