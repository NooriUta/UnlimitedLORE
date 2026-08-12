package studio.seer.heimdall.lore;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;

/**
 * VLT-03: контракт всех трёх провайдеров секретов ОДНИМ table-driven сьютом —
 * семантика get/has/invalidate не должна разъезжаться между реализациями молча.
 *
 * <p>Infisical и Vault ходят в локальный мок (JDK HttpServer, без новых
 * зависимостей — WireMock в корпусе нет); env читает system properties
 * (MicroProfile Config считает их источником по умолчанию). Живой Vault через
 * testcontainers сознательно НЕ поднимается в юнитах (грабли корпуса: юниты
 * быстрые, live-пробы — отдельным классом по образцу LoreArcadeDbTestResource).</p>
 *
 * <p>Уточнение контракта против исходной формулировки задачи: «отказ бэкенда →
 * исключение провайдера» в корпусе НЕ действует — фактический контракт
 * {@link SecretProvider} (D14, pluggable): любой отказ → {@link Optional#empty()},
 * а 503 отдаёт МОСТ-потребитель. Сьют закрепляет фактический контракт.</p>
 */
class SecretProviderContractTest {

    private static HttpServer server;
    private static String baseUrl;
    /** Хранилище секретов мока — общее для infisical- и vault-роутов. */
    private static final Map<String, String> STORE = new ConcurrentHashMap<>();
    /** true — мок отвечает 500 на всё (эмуляция лежащего бэкенда). */
    private static final AtomicBoolean DOWN = new AtomicBoolean(false);

    private static final String TOKEN = "test-token-not-a-real-secret";

    @BeforeAll
    static void startMock() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        // Infisical: GET /api/v3/secrets/raw/{key}?... → {"secret":{"secretValue":v}}
        server.createContext("/api/v3/secrets/raw/", ex -> {
            if (DOWN.get()) { respond(ex, 500, "{}"); return; }
            String auth = ex.getRequestHeaders().getFirst("Authorization");
            if (!("Bearer " + TOKEN).equals(auth)) { respond(ex, 401, "{}"); return; }
            String path = ex.getRequestURI().getPath();
            String key = path.substring(path.lastIndexOf('/') + 1);
            String v = STORE.get(key);
            if (v == null) { respond(ex, 404, "{}"); return; }
            respond(ex, 200, "{\"secret\":{\"secretValue\":\"" + v + "\"}}");
        });
        // Vault KV v2: GET /v1/secret/data/lore → {"data":{"data":{key:v,...}}}
        server.createContext("/v1/secret/data/lore", ex -> {
            if (DOWN.get()) { respond(ex, 500, "{}"); return; }
            String tok = ex.getRequestHeaders().getFirst("X-Vault-Token");
            if (!TOKEN.equals(tok)) { respond(ex, 403, "{}"); return; }
            StringBuilder inner = new StringBuilder();
            STORE.forEach((k, v) -> inner.append(inner.length() > 0 ? "," : "")
                .append("\"").append(k).append("\":\"").append(v).append("\""));
            respond(ex, 200, "{\"data\":{\"data\":{" + inner + "}}}");
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterAll
    static void stopMock() { server.stop(0); }

    @BeforeEach
    void reset() {
        STORE.clear();
        DOWN.set(false);
        System.clearProperty("VLT_CONTRACT_KEY");
    }

    // ── Таблица провайдеров ──────────────────────────────────────────────────

    record Row(String name, Supplier<SecretProvider> fresh, java.util.function.BiConsumer<String, String> put,
               java.util.function.Consumer<String> remove, boolean supportsOutage) {}

    static SecretProvider bare() {
        SecretProvider p = new SecretProvider();
        p.provider = "env";
        p.serviceUrl = Optional.empty();
        p.serviceToken = Optional.empty();
        p.clientId = Optional.empty();
        p.clientSecret = Optional.empty();
        p.projectId = Optional.empty();
        p.environment = "prod";
        p.scope = "/lore";
        p.vaultUrl = Optional.empty();
        p.vaultToken = Optional.empty();
        p.vaultPath = "secret/data/lore";
        p.cacheTtlSeconds = 300;
        return p;
    }

    static List<Row> providers() {
        return List.of(
            new Row("env",
                () -> bare(),
                (k, v) -> System.setProperty(k, v),
                k -> System.clearProperty(k),
                false),
            new Row("infisical",
                () -> { SecretProvider p = bare(); p.provider = "infisical";
                        p.serviceUrl = Optional.of(baseUrl); p.serviceToken = Optional.of(TOKEN); return p; },
                STORE::put, STORE::remove, true),
            new Row("vault",
                () -> { SecretProvider p = bare(); p.provider = "vault";
                        p.vaultUrl = Optional.of(baseUrl); p.vaultToken = Optional.of(TOKEN); return p; },
                STORE::put, STORE::remove, true)
        );
    }

    // ── Контрактные кейсы (одни на всех) ─────────────────────────────────────

    @ParameterizedTest(name = "{0}: секрет есть → значение, has=true")
    @MethodSource("providers")
    void присутствующийКлючЧитается(Row row) {
        row.put().accept("VLT_CONTRACT_KEY", "value-1");
        SecretProvider p = row.fresh().get();
        assertEquals(Optional.of("value-1"), p.get("VLT_CONTRACT_KEY"));
        assertTrue(p.has("VLT_CONTRACT_KEY"));
    }

    @ParameterizedTest(name = "{0}: секрета нет → empty, has=false, БЕЗ исключений")
    @MethodSource("providers")
    void отсутствующийКлючДаётEmpty(Row row) {
        SecretProvider p = row.fresh().get();
        assertEquals(Optional.empty(), p.get("VLT_CONTRACT_KEY"));
        assertFalse(p.has("VLT_CONTRACT_KEY"));
    }

    @ParameterizedTest(name = "{0}: значение кэшируется; invalidate сбрасывает кэш")
    @MethodSource("providers")
    void invalidateСбрасываетКэш(Row row) {
        row.put().accept("VLT_CONTRACT_KEY", "old");
        SecretProvider p = row.fresh().get();
        assertEquals(Optional.of("old"), p.get("VLT_CONTRACT_KEY"));

        row.put().accept("VLT_CONTRACT_KEY", "new");
        assertEquals(Optional.of("old"), p.get("VLT_CONTRACT_KEY"),
            "до invalidate обязано отдаваться кэшированное значение");

        p.invalidate("VLT_CONTRACT_KEY");
        assertEquals(Optional.of("new"), p.get("VLT_CONTRACT_KEY"));
    }

    @ParameterizedTest(name = "{0}: отказ бэкенда → empty (503 отдаёт мост, не провайдер)")
    @MethodSource("providers")
    void отказБэкендаДаётEmptyНеИсключение(Row row) {
        org.junit.jupiter.api.Assumptions.assumeTrue(row.supportsOutage(), "env не имеет бэкенда");
        row.put().accept("VLT_CONTRACT_KEY", "value-1");
        DOWN.set(true);
        SecretProvider p = row.fresh().get();
        assertDoesNotThrow(() -> assertEquals(Optional.empty(), p.get("VLT_CONTRACT_KEY")));
    }

    @ParameterizedTest(name = "{0}: значение секрета не утекает в toString")
    @MethodSource("providers")
    void toStringНеСодержитСекрет(Row row) {
        row.put().accept("VLT_CONTRACT_KEY", "s3cr3t-value-must-not-leak");
        SecretProvider p = row.fresh().get();
        p.get("VLT_CONTRACT_KEY");
        assertFalse(p.toString().contains("s3cr3t-value-must-not-leak"));
    }

    // ── DBR-02: TTL кэша + сброс по отказу авторизации у потребителя ────────

    @ParameterizedTest(name = "{0}: TTL истёк — перечитывается из источника")
    @MethodSource("providers")
    void ttlПротухаетИПеречитывается(Row row) {
        row.put().accept("VLT_CONTRACT_KEY", "old");
        SecretProvider p = row.fresh().get();
        p.cacheTtlSeconds = 0; // истекает немедленно — без сна на реальный TTL
        assertEquals(Optional.of("old"), p.get("VLT_CONTRACT_KEY"));

        row.put().accept("VLT_CONTRACT_KEY", "new");
        assertEquals(Optional.of("new"), p.get("VLT_CONTRACT_KEY"),
            "TTL=0 обязан требовать перечитывания на КАЖДЫЙ вызов, а не только на первый после истечения");
    }

    @ParameterizedTest(name = "{0}: значение живёт в кэше, пока TTL не истёк")
    @MethodSource("providers")
    void вПределахTtlОтдаётсяКэш(Row row) {
        row.put().accept("VLT_CONTRACT_KEY", "cached-value");
        SecretProvider p = row.fresh().get();
        p.cacheTtlSeconds = 300;
        assertEquals(Optional.of("cached-value"), p.get("VLT_CONTRACT_KEY"));

        row.put().accept("VLT_CONTRACT_KEY", "changed-but-should-not-be-seen-yet");
        assertEquals(Optional.of("cached-value"), p.get("VLT_CONTRACT_KEY"),
            "TTL не истёк — обязана вернуться закэшированная запись, а не новая");
    }

    @ParameterizedTest(name = "{0}: протухший кред у потребителя — invalidate + ровно один повтор восстанавливает значение")
    @MethodSource("providers")
    void invalidateДаётРовноОдинПовторныйФетч(Row row) {
        org.junit.jupiter.api.Assumptions.assumeTrue(row.supportsOutage(), "env не имеет бэкенда — сценарий ротации неприменим");
        row.put().accept("VLT_CONTRACT_KEY", "stale");
        SecretProvider p = row.fresh().get();
        assertEquals(Optional.of("stale"), p.get("VLT_CONTRACT_KEY"), "закэшировано первым вызовом");

        // Потребитель (напр. ArcadeDB-клиент) получил 401 со stale-кредом →
        // ротация уже произошла на стороне секрет-сервиса, вызывающий делает
        // invalidate + РОВНО один повторный get (без внутреннего цикла в get()).
        row.put().accept("VLT_CONTRACT_KEY", "rotated");
        p.invalidate("VLT_CONTRACT_KEY");
        assertEquals(Optional.of("rotated"), p.get("VLT_CONTRACT_KEY"),
            "один invalidate + один get обязаны вернуть новое значение");

        // get() сам по себе не ретраит: один промах кэша = ровно один сетевой
        // запрос к источнику, что и делает "третью попытку" не нужной в принципе.
    }

    @ParameterizedTest(name = "{0}: пустой результат не оседает в кэше")
    @MethodSource("providers")
    void пустойРезультатНеКэшируется(Row row) {
        SecretProvider p = row.fresh().get();
        assertEquals(Optional.empty(), p.get("VLT_CONTRACT_KEY"));

        row.put().accept("VLT_CONTRACT_KEY", "appeared-later");
        assertEquals(Optional.of("appeared-later"), p.get("VLT_CONTRACT_KEY"),
            "если бы пустой результат кэшировался, свежее значение не появилось бы без invalidate");
    }

    // ── VLT-02: недоконфиг vault = ошибка старта, не тихий фолбэк ────────────

    @Test
    void недоконфигVaultВалитСтартВнятно() {
        SecretProvider p = bare();
        p.provider = "vault"; // url и token пусты
        IllegalStateException e = assertThrows(IllegalStateException.class, p::validateProviderConfig);
        assertTrue(e.getMessage().contains("lore.secrets.vault.url"));
        assertTrue(e.getMessage().contains("lore.secrets.vault.token"));
    }

    @Test
    void полныйКонфигVaultПроходитВалидацию() {
        SecretProvider p = bare();
        p.provider = "vault";
        p.vaultUrl = Optional.of("http://vault:8200");
        p.vaultToken = Optional.of(TOKEN);
        assertDoesNotThrow(p::validateProviderConfig);
    }

    @Test
    void валидацияНеТрогаетДругиеПровайдеры() {
        assertDoesNotThrow(() -> bare().validateProviderConfig());
    }

    private static void respond(com.sun.net.httpserver.HttpExchange ex, int code, String body) throws java.io.IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(code, b.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(b); }
        ex.close();
    }
}
