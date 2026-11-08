package studio.seer.heimdall.lore;

import com.arcadedb.ContextConfiguration;
import com.arcadedb.GlobalConfiguration;
import com.arcadedb.server.ArcadeDBServer;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Встроенный сервер ArcadeDB для live-DB тестов — без Docker и без общей базы.
 *
 * <p>Один сервер на JVM прогона, на случайном свободном порту {@code 127.0.0.1},
 * во временной папке. Приложение ходит в него по REST, как в любой другой
 * ArcadeDB (ADR-YGG-REST-ONLY не нарушается: встроен только сервер, и только в
 * тестах).
 *
 * <p>Адрес хранится в System property, а не в static-поле: Quarkus грузит
 * тест-классы разными загрузчиками на разные приложения, и static мог бы
 * обнулиться между классами — тогда поднялся бы второй сервер, а первый остался
 * висеть (см. то же правило в {@link LoreArcadeDbTestResource}).
 */
final class LoreEmbeddedArcadeDb {

    private LoreEmbeddedArcadeDb() {}

    static final String P_EMBEDDED_URL = "lore.test.db.embedded.url";

    static synchronized String url(String rootPassword) {
        String existing = System.getProperty(P_EMBEDDED_URL);
        if (existing != null) return existing;
        try {
            int port = freePort();
            Path root = Files.createTempDirectory("lore-arcadedb-");
            ContextConfiguration cfg = new ContextConfiguration();
            cfg.setValue(GlobalConfiguration.SERVER_ROOT_PATH, root.toString());
            cfg.setValue(GlobalConfiguration.SERVER_DATABASE_DIRECTORY, root.resolve("databases").toString());
            cfg.setValue(GlobalConfiguration.SERVER_ROOT_PASSWORD, rootPassword);
            cfg.setValue(GlobalConfiguration.SERVER_HTTP_INCOMING_HOST, "127.0.0.1");
            cfg.setValue(GlobalConfiguration.SERVER_HTTP_INCOMING_PORT, String.valueOf(port));
            cfg.setValue(GlobalConfiguration.HA_ENABLED, false);
            cfg.setValue(GlobalConfiguration.SERVER_PLUGINS, "");
            ArcadeDBServer server = new ArcadeDBServer(cfg);
            server.start();
            Runtime.getRuntime().addShutdownHook(new Thread(server::stop, "lore-embedded-arcadedb-stop"));
            String url = "http://127.0.0.1:" + port;
            System.setProperty(P_EMBEDDED_URL, url);
            return url;
        } catch (IOException e) {
            throw new IllegalStateException("встроенный сервер ArcadeDB не поднялся: " + e.getMessage(), e);
        }
    }

    private static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            s.setReuseAddress(true);
            return s.getLocalPort();
        }
    }
}
