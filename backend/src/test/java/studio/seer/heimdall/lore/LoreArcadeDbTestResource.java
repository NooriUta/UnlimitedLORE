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
 * Ygg/frigg instances — see docker images arcadedata/arcadedb) for tests
 * that need real SCD2/A1-transaction behavior, which no amount of mocking
 * can prove. Creates a fresh database and points the app at it with
 * lore.bootstrap=true so LoreSchemaInitializer/LoreComponentSeeder run
 * their normal startup DDL against it — no hand-duplicated schema here.
 */
public class LoreArcadeDbTestResource implements QuarkusTestResourceLifecycleManager {

    static final String ROOT_PASSWORD = "lore_test_root_pw";
    static final String TEST_DB = "lore_c5_test";

    // Exposed so live-DB test classes can run their own verification queries
    // (SCD2 row/edge state) straight against the container — the app's own
    // REST surface has no "dump me the raw Hist rows" endpoint, nor should it.
    static volatile String BASE_URL;

    private GenericContainer<?> arcade;

    @Override
    public Map<String, String> start() {
        arcade = new GenericContainer<>(DockerImageName.parse("arcadedata/arcadedb:26.7.2"))
            .withEnv("JAVA_OPTS", "-Darcadedb.server.rootPassword=" + ROOT_PASSWORD)
            .withExposedPorts(2480)
            .waitingFor(Wait.forListeningPort().withStartupTimeout(Duration.ofSeconds(60)));
        arcade.start();

        String baseUrl = "http://" + arcade.getHost() + ":" + arcade.getMappedPort(2480);
        BASE_URL = baseUrl;
        awaitReady(baseUrl);
        createDatabase(baseUrl);

        return Map.of(
            "quarkus.rest-client.mart-api.url", baseUrl,
            "lore.db", TEST_DB,
            "lore.bootstrap", "true",
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
        throw new IllegalStateException("ArcadeDB test container never became ready", last);
    }

    private void createDatabase(String baseUrl) {
        try {
            String auth = "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8));
            HttpClient http = HttpClient.newHttpClient();
            String body = "{\"command\":\"create database " + TEST_DB + "\"}";
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/server"))
                .header("Authorization", auth)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 300) {
                throw new IllegalStateException("create database failed: " + resp.statusCode() + " " + resp.body());
            }
        } catch (Exception e) {
            throw new RuntimeException("failed to create ArcadeDB test database", e);
        }
    }

    @Override
    public void stop() {
        if (arcade != null) arcade.stop();
    }
}
