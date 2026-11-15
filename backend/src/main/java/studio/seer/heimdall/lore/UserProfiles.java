package studio.seer.heimdall.lore;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-07 — правила профиля автора (имя и аватар человека), без базы и сети.
 *
 * <p>Один источник лица для LORE и miniLORE (владелица 15.11.2026: «нужны аватары, лучше чтобы автор был в
 * LORE»). Контракт двери согласован с сессией miniLORE: голый массив строк
 * {@code {kc_sub, login, display_name, avatar_url, found}}, адрес аватара — относительный от базы LORE.
 * Почта и роли через дверь не уходят: строка собирается из перечня полей, а не копией записи.
 */
final class UserProfiles {

    private UserProfiles() {}

    /** Больше id за раз дверь не принимает: стопка аватаров в чате — десятки, не сотни. */
    static final int MAX_IDS = 200;
    /** Аватар — до 2 МБ: телефон кэширует, сервер отдаёт байты как есть. */
    static final long MAX_AVATAR_BYTES = 2L * 1024 * 1024;
    /** png/jpeg/webp; svg исполняем в браузере, gif не нужен для лица — не берём. */
    static final Map<String, String> AVATAR_MIME_EXT = Map.of(
        "image/png", "png", "image/jpeg", "jpg", "image/webp", "webp");
    static final int MAX_NAME = 80;

    /** Свой профиль человек меняет сам («сам пользователь конечно», 15.11.2026), чужой — только админ. */
    static boolean canEdit(String callerSub, String role, String targetSub) {
        if (targetSub == null || targetSub.isBlank()) return false;
        if ("admin".equals(role) || "superadmin".equals(role)) return true;
        return callerSub != null && !callerSub.isBlank() && callerSub.equals(targetSub);
    }

    /** Относительный адрес аватара (у приложения своя база LORE: препрод и прод разные). Нет ключа — null. */
    static String avatarUrl(String kcSub, String avatarRef) {
        if (avatarRef == null || avatarRef.isBlank() || kcSub == null) return null;
        return "/lore/users/" + URLEncoder.encode(kcSub, StandardCharsets.UTF_8) + "/avatar";
    }

    /** ETag — хэш содержимого из ключа {@code user/<sub>/<hash>.<ext>}: новая картинка — новый ключ и ETag. */
    static String etagOf(String avatarRef) {
        if (avatarRef == null || avatarRef.isBlank()) return null;
        String file = avatarRef.substring(avatarRef.lastIndexOf('/') + 1);
        int dot = file.lastIndexOf('.');
        return "\"" + (dot > 0 ? file.substring(0, dot) : file) + "\"";
    }

    /**
     * Строка ответа двери. Нет записи — {@code found=false} и запрошенный id: молчаливое отсутствие строки
     * нельзя отличить от сбоя. Имя не выбрано — логин (лицо без подписи хуже подписи логином).
     */
    static Map<String, Object> row(String requested, Map<String, Object> db) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (db == null) {
            out.put("requested", requested);
            out.put("kc_sub", null);
            out.put("login", null);
            out.put("display_name", null);
            out.put("avatar_url", null);
            out.put("found", false);
            return out;
        }
        String sub = str(db.get("kc_sub"));
        String login = str(db.get("login"));
        String name = str(db.get("display_name"));
        out.put("kc_sub", sub);
        out.put("login", login);
        out.put("display_name", name != null ? name : login);
        out.put("avatar_url", avatarUrl(sub, str(db.get("avatar_ref"))));
        out.put("found", true);
        return out;
    }

    /** Причина отказа имени или null, если имя годится. */
    static String nameRefusal(String name) {
        if (name == null || name.isBlank()) return "имя пустое";
        String t = name.strip();
        if (t.length() > MAX_NAME) return "имя длиннее " + MAX_NAME + " символов";
        for (int i = 0; i < t.length(); i++)
            if (Character.isISOControl(t.charAt(i))) return "в имени управляющий символ";
        return null;
    }

    /** Причина отказа картинки или null. */
    static String imageRefusal(String mime, long size) {
        if (mime == null || !AVATAR_MIME_EXT.containsKey(mime.toLowerCase()))
            return "аватар — только " + AVATAR_MIME_EXT.keySet() + ", пришёл «" + mime + "»";
        if (size > MAX_AVATAR_BYTES) return "аватар " + size + " байт больше лимита " + MAX_AVATAR_BYTES;
        return null;
    }

    /** Список id из запроса: без пустых и повторов, не больше {@link #MAX_IDS}. */
    static List<String> parseIds(String raw) {
        if (raw == null) return List.of();
        Set<String> seen = new LinkedHashSet<>();
        for (String s : raw.split(",")) {
            String t = s.strip();
            if (!t.isEmpty()) seen.add(t);
            if (seen.size() >= MAX_IDS) break;
        }
        return new ArrayList<>(seen);
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o);
        return s.isBlank() ? null : s;
    }
}
