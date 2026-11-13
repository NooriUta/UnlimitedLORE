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
    private static final Set<String> HOMES = Set.of("LiveDbHttp.java", "LiveDbHttpGuardTest.java");

    static boolean createsClient(String src) {
        String code = src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
        return NEW_CLIENT.matcher(code).find();
    }

    @Test
    void patternSeesBothFormsAndIgnoresComments() {
        assertTrue(createsClient("HttpClient http = HttpClient.newHttpClient();"));
        assertTrue(createsClient("var c = java.net.http.HttpClient.newBuilder().build();"));
        assertFalse(createsClient("HttpClient http = LiveDbHttp.CLIENT;"));
        assertFalse(createsClient("// HttpClient.newHttpClient() — в комментарии не в счёт"));
    }

    @Test
    void testsUseTheSharedClientOnly() throws IOException {
        List<String> offenders;
        try (Stream<Path> s = Files.walk(Path.of("src/test/java"))) {
            offenders = s.filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !HOMES.contains(p.getFileName().toString()))
                .filter(p -> {
                    try { return createsClient(Files.readString(p)); }
                    catch (IOException e) { throw new RuntimeException(e); }
                })
                .map(Path::toString).sorted().toList();
        }
        assertEquals(List.of(), offenders,
            "тест создаёт свой HttpClient — бери LiveDbHttp.CLIENT (поток-селектор на клиент, OOM CI 13.11)");
    }
}
