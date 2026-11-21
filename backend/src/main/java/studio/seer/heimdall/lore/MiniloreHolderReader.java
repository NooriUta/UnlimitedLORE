package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * SPRINT_MINILORE_POLISH/LINKS-VIEW-HOLDER — «сессия у записи»: какие сессии агентов работали с
 * записью. Сессии — модель miniLORE (ADR-LORE-054): LORE их не хранит, а читает у сервера miniLORE
 * {@code GET /links/record/{refId}?view=holder} — массив объектов формата версии 1
 * (SPEC-LORE-SESSION-AT-RECORD).
 *
 * <p>Доступ — служебным клиентом {@code client_credentials}; код и секрет клиента читаются через
 * {@link SecretProvider}, адрес сервера — настройкой {@code lore.minilore.url}. Ничего из этого не
 * задано — состояние {@code not_configured}, а не пустой список. Отказ ({@code denied}) и сбой
 * ({@code error}) тоже не выглядят как «никто не ведёт». Секрет и токен в ответ, в причину и в лог
 * не попадают.
 */
@ApplicationScoped
public class MiniloreHolderReader {

    static final String CLIENT_ID_KEY = "MINILORE_READER_CLIENT_ID";
    static final String CLIENT_SECRET_KEY = "MINILORE_READER_CLIENT_SECRET";
    static final List<String> REQUIRED = List.of("v", "sessionId", "machineId", "since", "source");
    static final int FORMAT_VERSION = 1;

    private static final LoreHttpClients.Shared HTTP = LoreHttpClients.shared(HttpClient::newBuilder);
    private static final Duration TIMEOUT = Duration.ofSeconds(4);

    @ConfigProperty(name = "lore.minilore.url")
    Optional<String> url;
    // SELF-PROVISION-STANDALONE: умолчания на наш Keycloak нет — чужая установка не должна стучаться к нам.
    // Не задан — состояние not_configured при чтении, старт не падает (Optional, как у lore.minilore.url).
    @ConfigProperty(name = "lore.minilore.token-url")
    Optional<String> tokenUrl;
    @Inject
    SecretProvider secrets;

    private volatile String token;
    private volatile long tokenUntilMs;

    /** Итог чтения: состояние, сессии и причина словами (без секретов). */
    record Result(String state, List<Map<String, Object>> items, String reason) {
        static Result notConfigured(String why) { return new Result("not_configured", List.of(), why); }
        static Result error(String why) { return new Result("error", List.of(), why); }

        Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("state", state);
            m.put("items", items);
            if (reason != null) m.put("reason", reason);
            return m;
        }
    }

    /** Путь двери: код записи по частям, дробь у задачи «спринт/код» сохраняется. */
    static String path(String refId) {
        StringBuilder sb = new StringBuilder("/links/record/");
        String[] parts = refId.split("/");
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) sb.append('/');
            sb.append(URLEncoder.encode(parts[i], StandardCharsets.UTF_8).replace("+", "%20"));
        }
        return sb.append("?view=holder").toString();
    }

    /**
     * Ответ сервера miniLORE → итог. «С записью никто не работал» — это 200 и пустой массив; 404 дверь
     * не отдаёт, поэтому 404 значит «двери нет» (сервер miniLORE старше формата или адрес не тот) — сбой,
     * а не «никого».
     */
    static Result fromResponse(int status, String body) {
        if (status == 404) return Result.error("у сервера miniLORE нет двери «сессия у записи» (404): сервер старше формата или адрес не тот");
        if (status == 401 || status == 403) return new Result("denied", List.of(), "сервер miniLORE отказал: " + status);
        if (status != 200) return Result.error("сервер miniLORE ответил " + status);
        JsonArray arr;
        try {
            arr = new JsonArray(body);
        } catch (RuntimeException e) {
            return Result.error("ответ сервера miniLORE — не массив формата «сессия у записи»");
        }
        List<Map<String, Object>> items = new ArrayList<>();
        int broken = 0, otherVersion = 0;
        for (Object o : arr) {
            if (!(o instanceof JsonObject j)) { broken++; continue; }
            Map<String, Object> m = j.getMap();
            if (!REQUIRED.stream().allMatch(k -> m.get(k) != null)) { broken++; continue; }
            if (!(m.get("v") instanceof Number n) || n.intValue() != FORMAT_VERSION) { otherVersion++; continue; }
            items.add(m);
        }
        String reason = null;
        if (broken > 0 || otherVersion > 0)
            reason = "отброшено: без обязательных ключей — " + broken + ", незнакомой версии формата — " + otherVersion;
        return new Result("ok", List.copyOf(items), reason);
    }

    /** Сессии у записи. Не бросает: любой исход — состояние. */
    Result read(String refId) {
        if (url == null || url.isEmpty() || url.get().isBlank()) return Result.notConfigured("не задан адрес сервера miniLORE (lore.minilore.url)");
        if (tokenUrl == null || tokenUrl.isEmpty() || tokenUrl.get().isBlank())
            return Result.notConfigured("не задан адрес выдачи токена Keycloak (lore.minilore.token-url)");
        Optional<String> id = secrets.get(CLIENT_ID_KEY), secret = secrets.get(CLIENT_SECRET_KEY);
        if (id.isEmpty() || secret.isEmpty()) return Result.notConfigured("нет учётки читателя miniLORE в хранилище секретов");
        try {
            Result r = call(refId, token(id.get(), secret.get(), false));
            // Токен мог истечь раньше срока или быть отозван: один повтор со свежим.
            if ("denied".equals(r.state())) r = call(refId, token(id.get(), secret.get(), true));
            return r;
        } catch (TokenRefused e) {
            return new Result("denied", List.of(), e.getMessage());
        } catch (Exception e) {
            return Result.error("сервер miniLORE недоступен: " + e.getClass().getSimpleName());
        }
    }

    private Result call(String refId, String bearer) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url.get().replaceAll("/+$", "") + path(refId)))
            .timeout(TIMEOUT).header("Authorization", "Bearer " + bearer).header("Accept", "application/json").GET().build();
        HttpResponse<String> r = HTTP.get().send(req, HttpResponse.BodyHandlers.ofString());
        return fromResponse(r.statusCode(), r.body());
    }

    private static final class TokenRefused extends RuntimeException {
        TokenRefused(String m) { super(m); }
    }

    private synchronized String token(String clientId, String secret, boolean fresh) throws Exception {
        long now = System.currentTimeMillis();
        if (!fresh && token != null && now < tokenUntilMs) return token;
        String body = "grant_type=client_credentials&client_id=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8)
            + "&client_secret=" + URLEncoder.encode(secret, StandardCharsets.UTF_8);
        HttpRequest req = HttpRequest.newBuilder(URI.create(tokenUrl.get())).timeout(TIMEOUT)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = HTTP.get().send(req, HttpResponse.BodyHandlers.ofString());
        // Тело ответа в причину не идёт: в нём может быть эхо учётки.
        if (r.statusCode() != 200) throw new TokenRefused("область входа не выдала токен читателю miniLORE: " + r.statusCode());
        JsonObject j = new JsonObject(r.body());
        token = j.getString("access_token");
        tokenUntilMs = now + Math.max(30, j.getInteger("expires_in", 60) - 30) * 1000L;
        return token;
    }
}
