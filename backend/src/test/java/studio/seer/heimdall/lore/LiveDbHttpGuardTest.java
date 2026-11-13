package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_PIPELINE_HOST/PL-14 — в тестах JDK HttpClient только общий
 * ({@link LiveDbHttp}). Клиент на класс/вызов копил потоки-селекторы (OOM бэкенд-CI 13.11.2026).
 */
class LiveDbHttpGuardTest {

    private static final Pattern NEW_CLIENT = Pattern.compile("HttpClient\\s*\\.\\s*(newHttpClient|newBuilder)\\s*\\(");
    private static final Set<String> HOMES = Set.of("LoreHttpClients.java", "LiveDbHttp.java", "LiveDbHttpGuardTest.java");
    /** Разрешено: builder внутри LoreHttpClients.shared(...) — общий клиент, закрываемый на остановке. */
    private static final Pattern ALLOWED = Pattern.compile(
        "LoreHttpClients\\s*\\.\\s*shared\\s*\\(\\s*\\(\\s*\\)\\s*->\\s*HttpClient\\s*\\.\\s*newBuilder\\s*\\(");
    /** Поле с клиентом держит закрытый после остановки приложения — только вызов client()/get() на месте. */
    private static final Pattern FIELD = Pattern.compile("(static|final)[^;=(]*\\bHttpClient\\s+\\w+\\s*=");

    static boolean createsClient(String src) {
        String code = src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
        return NEW_CLIENT.matcher(ALLOWED.matcher(code).replaceAll("LoreHttpClients.shared(() -> ((")).find()
            || FIELD.matcher(code).find();
    }

    @Test
    void patternSeesBothFormsAndIgnoresComments() {
        assertTrue(createsClient("HttpClient http = HttpClient.newHttpClient();"));
        assertTrue(createsClient("var c = java.net.http.HttpClient.newBuilder().build();"));
        assertFalse(createsClient("HttpClient http = LiveDbHttp.client();"));
        assertFalse(createsClient("// HttpClient.newHttpClient() — в комментарии не в счёт"));
        assertFalse(createsClient("HTTP = LoreHttpClients.shared(() -> HttpClient.newBuilder().connectTimeout(d));"));
        assertTrue(createsClient("private static final HttpClient HTTP = LiveDbHttp.client();"), "поле держит закрытый клиент");
    }

    @Test
    void testsUseTheSharedClientOnly() throws IOException {
        List<String> offenders;
        try (Stream<Path> s = Stream.concat(Files.walk(Path.of("src/main/java")), Files.walk(Path.of("src/test/java")))) {
            offenders = s.filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !HOMES.contains(p.getFileName().toString()))
                .filter(p -> {
                    try { return createsClient(Files.readString(p)); }
                    catch (IOException e) { throw new RuntimeException(e); }
                })
                .map(Path::toString).sorted().toList();
        }
        assertEquals(List.of(), offenders,
            "HttpClient мимо LoreHttpClients.shared (код) / LiveDbHttp.client() (тесты) или в поле — потоки-селекторы копятся (OOM CI 13.11)");
    }
}
