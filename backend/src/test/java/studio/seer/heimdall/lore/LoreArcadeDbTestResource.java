package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;

/**
 * Spins up a throwaway ArcadeDB container (same image tag as the live
 * Ygg/frigg instances) for tests that need real SCD2/A1-transaction behavior.
 * Creates a fresh database and points the app at it with lore.bootstrap=true so
 * LoreSchemaInitializer/LoreComponentSeeder run their normal startup DDL —
 * no hand-duplicated schema here.
 *
 * CI-fallback (решение владельца 2026-07-17): на self-hosted Forgejo-раннере
 * Testcontainers/Ryuk не работает (DooD), и live-DB тесты годами скипались —
 * регрессия схемы на чистой БД там не ловилась ВООБЩЕ. Если задан
 * LORE_TEST_DB_URL — контейнер не поднимается, тесты идут в ПОСТОЯННУЮ БД
 * (обычно lore_ci_test на живом :2480). Изоляция от system_aida_lore —
 * отдельным именем БД; сам system_aida_lore тесты не трогают никогда.
 * Имя БД: LORE_TEST_DB_NAME (default lore_ci_test) — база пересоздаётся
 * на каждый запуск ресурса, чтобы прогоны не зависели друг от друга.
 */
public class LoreArcadeDbTestResource implements QuarkusTestResourceLifecycleManager {

    static final String ROOT_PASSWORD_CONTAINER = "lore_test_root_pw";
    static String ROOT_PASSWORD = ROOT_PASSWORD_CONTAINER; // фактический (external → из env)
    static String TEST_DB = "lore_c5_test";                // фактическое имя БД этого запуска

    // Exposed so live-DB test classes can run their own verification queries
    // (SCD2 row/edge state) straight against the DB — the app's own REST
    // surface has no "dump me the raw Hist rows" endpoint, nor should it.
    static volatile String BASE_URL;

    private GenericContainer<?> arcade;

    @Override
    public Map<String, String> start() {
        String externalUrl = System.getenv("LORE_TEST_DB_URL");
        String baseUrl;
        if (externalUrl != null && !externalUrl.isBlank()) {
            baseUrl = externalUrl.replaceAll("/+$", "");
            TEST_DB = System.getenv().getOrDefault("LORE_TEST_DB_NAME", "lore_ci_test");
            ROOT_PASSWORD = System.getenv().getOrDefault("LORE_TEST_DB_PASSWORD", "playwithdata");
        } else {
            arcade = new GenericContainer<>(DockerImageName.parse("arcadedata/arcadedb:26.7.2"))
                .withEnv("JAVA_OPTS", "-Darcadedb.server.rootPassword=" + ROOT_PASSWORD_CONTAINER)
                .withExposedPorts(2480)
                .waitingFor(Wait.forListeningPort().withStartupTimeout(Duration.ofSeconds(60)));
            arcade.start();
            baseUrl = "http://" + arcade.getHost() + ":" + arcade.getMappedPort(2480);
            TEST_DB = "lore_c5_test";
            ROOT_PASSWORD = ROOT_PASSWORD_CONTAINER;
        }
        BASE_URL = baseUrl;
        awaitReady(baseUrl);
        recreateDatabase(baseUrl);

        return Map.of(
            "quarkus.rest-client.mart-api.url", baseUrl,
            "lore.db", TEST_DB,
            "lore.bootstrap", "true",
            // ADR-LORE-023: раннер миграций гоняется на каждом тестовом старте —
            // fresh-путь (bootstrap → шаги → ledger) доказывается на каждой сборке.
            "lore.migrate", "true",
            "bench.mart.user", "root",
            "bench.mart.password", ROOT_PASSWORD
        );
    }

    private void awaitReady(String baseUrl) {
        HttpClient http = HttpClient.newHttpClient();
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/ready"))
            .timeout(Duration.ofSeconds(3)).GET().build();
        long deadline = System.currentTimeMillis() + 30_000;
        Exception last = null;
        while (System.currentTimeMillis() < deadline) {
            try {
                HttpResponse<Void> resp = http.send(req, HttpResponse.BodyHandlers.discarding());
                if (resp.statusCode() < 300) return;
            } catch (Exception e) {
                last = e;
            }
            try { Thread.sleep(500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        throw new IllegalStateException("ArcadeDB test DB never became ready: " + baseUrl, last);
    }

    /** drop-if-exists + create: внешняя постоянная БД чистится между прогонами. */
    private void recreateDatabase(String baseUrl) {
        serverCommand(baseUrl, "drop database " + TEST_DB, true);
        serverCommand(baseUrl, "create database " + TEST_DB, false);
    }

    private void serverCommand(String baseUrl, String command, boolean ignoreError) {
        try {
            String auth = "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8));
            HttpClient http = HttpClient.newHttpClient();
            String body = "{\"command\":\"" + command + "\"}";
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/server"))
                .header("Authorization", auth)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 300 && !ignoreError) {
                throw new IllegalStateException("'" + command + "' failed: " + resp.statusCode() + " " + resp.body());
            }
        } catch (Exception e) {
            if (!ignoreError) throw new RuntimeException("ArcadeDB server command failed: " + command, e);
        }
    }

    @Override
    public void stop() {
        if (arcade != null) arcade.stop();
    }
}
