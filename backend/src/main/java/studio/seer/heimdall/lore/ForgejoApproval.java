package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-07 — гейт рисковых операций миниаппа: два фактора (слово владельца 26.11 — «два фактора:
 * это диалог и подтверждение в LORE»; «можно и так и так» — в LORE слово-вызов или PIN Keycloak).
 *
 * <ol>
 *   <li><b>Фактор 1 — диалог.</b> Заголовок {@code X-Lore-Human-Approval} — JSON
 *       {@code {message_ref, at, human, intent_hash, challenge_id}}: на какое сообщение человека опирается агент,
 *       когда оно было, кто (= владелец сессии), какую именно операцию (отпечаток) и какой вызов LORE.</li>
 *   <li><b>Фактор 2 — LORE.</b> На 428 исполнитель выдаёт слово-вызов; агент пишет человеку «введите в LORE слово …»,
 *       человек вводит его под своей учёткой ({@link #confirm}). PIN Keycloak — второй способ этого фактора, пока не
 *       подключён (нужен step-up в KC).</li>
 * </ol>
 * Подтверждение одноразовое и привязано к отпечатку операции: тем же «да» нельзя выполнить другую операцию.
 * Хранилище — в памяти процесса: вызов живёт минуты, схему базы не трогаем (заморозка схемы); перезапуск бэкенда
 * сбрасывает незавершённые подтверждения — человек просто подтверждает заново.
 */
final class ForgejoApproval {

    static final long CHALLENGE_TTL_MS = 15 * 60_000L;
    static final long DIALOG_TTL_MS = 15 * 60_000L;

    /** Короткие обычные слова: читаются с телефона и вводятся без ошибок. */
    private static final List<String> WORDS = List.of(
        "берёза", "ворон", "гроза", "дубрава", "ель", "жёлудь", "зерно", "ива", "клён", "лось", "мёд", "ночь",
        "огонь", "пчела", "река", "сокол", "туман", "уголь", "филин", "хвоя", "цапля", "чайка", "щука", "янтарь",
        "буря", "волна", "гора", "дождь", "заря", "искра", "камень", "лист", "мост", "небо", "озеро", "поле",
        "роса", "снег", "тропа", "утро", "холм", "ветер", "иней", "кедр", "лёд", "мох", "сова", "рысь");
    private static final SecureRandom RND = new SecureRandom();

    record Challenge(String id, String word, String route, String intentHash, long issuedAt, long expiresAt,
                     String confirmedBy, long confirmedAt, boolean used) {

        Challenge confirmed(String human, long at) {
            return new Challenge(id, word, route, intentHash, issuedAt, expiresAt, human, at, used);
        }

        Challenge consumed() {
            return new Challenge(id, word, route, intentHash, issuedAt, expiresAt, confirmedBy, confirmedAt, true);
        }

        JsonObject toJson() {
            return new JsonObject().put("id", id).put("word", word).put("expires_at", expiresAt);
        }
    }

    private final Map<String, Challenge> store = new ConcurrentHashMap<>();

    /** Отпечаток операции: маршрут + args без dry_run, ключи по алфавиту — не зависит от порядка полей. */
    static String intentHash(String route, JsonObject args) {
        Map<String, Object> sorted = new TreeMap<>();
        if (args != null) for (String k : args.fieldNames()) if (!"dry_run".equals(k)) sorted.put(k, canonical(args.getValue(k)));
        String text = route + "\n" + new JsonObject(new java.util.LinkedHashMap<>(sorted)).encode();
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Object canonical(Object v) {
        if (v instanceof JsonObject o) {
            Map<String, Object> m = new TreeMap<>();
            for (String k : o.fieldNames()) m.put(k, canonical(o.getValue(k)));
            return new JsonObject(new java.util.LinkedHashMap<>(m));
        }
        if (v instanceof JsonArray a) {
            JsonArray out = new JsonArray();
            for (Object x : a) out.add(canonical(x));
            return out;
        }
        return v;
    }

    /** Выдать слово-вызов на операцию (428). */
    Challenge issue(String route, String intentHash, long now) {
        store.values().removeIf(c -> c.expiresAt() < now - CHALLENGE_TTL_MS);
        Challenge c = new Challenge(UUID.randomUUID().toString(), WORDS.get(RND.nextInt(WORDS.size())), route, intentHash,
            now, now + CHALLENGE_TTL_MS, null, 0, false);
        store.put(c.id(), c);
        return c;
    }

    /**
     * Фактор 2: человек ввёл слово в LORE под своей учёткой. Ответ: ok | unknown | expired | used | wrong_word.
     * Регистр и пробелы по краям не важны.
     */
    String confirm(String id, String word, String human, long now) {
        Challenge c = id == null ? null : store.get(id);
        if (c == null) return "unknown";
        if (c.used()) return "used";
        if (now > c.expiresAt()) return "expired";
        if (word == null || !c.word().equalsIgnoreCase(word.strip().toLowerCase(Locale.ROOT))) return "wrong_word";
        store.put(id, c.confirmed(human, now));
        return "ok";
    }

    /** Заголовок подтверждения — JSON-объект; свободный текст (как у справочника) здесь подтверждением не считается. */
    static JsonObject parseHeader(String header) {
        if (header == null || header.isBlank()) return null;
        try {
            String t = header.strip();
            return t.startsWith("{") ? new JsonObject(t) : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * Проверка обоих факторов. {@code null} — подтверждено (и подтверждение израсходовано); иначе имя проваленной
     * проверки: message | human | intent_hash | ttl | lore_factor.
     */
    String verify(JsonObject approval, String intentHash, String sessionOwner, long now) {
        if (approval == null) return "message";
        String msg = approval.getString("message_ref");
        Object atRaw = approval.getValue("at");
        if (msg == null || msg.isBlank() || !(atRaw instanceof Number at)) return "message";
        if (sessionOwner == null || !Objects.equals(sessionOwner, approval.getString("human"))) return "human";
        if (!Objects.equals(intentHash, approval.getString("intent_hash"))) return "intent_hash";
        if (now - at.longValue() > DIALOG_TTL_MS || at.longValue() > now + 60_000L) return "ttl";
        String cid = approval.getString("challenge_id");
        synchronized (store) {
            Challenge c = cid == null ? null : store.get(cid);
            if (c == null || c.used() || c.confirmedBy() == null || now > c.expiresAt()
                || !Objects.equals(c.intentHash(), intentHash) || !Objects.equals(c.confirmedBy(), sessionOwner))
                return "lore_factor";
            store.put(cid, c.consumed());
        }
        return null;
    }

    /** Ожидающий вызов для экрана LORE (что подтверждается): без проверки, только чтение. */
    Challenge get(String id) {
        return id == null ? null : store.get(id);
    }
}
