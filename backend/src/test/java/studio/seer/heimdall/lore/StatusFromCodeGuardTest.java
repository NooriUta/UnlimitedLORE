package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-01 — CI 25.11.2026 (Backend CI #1802, SkillResourceLiveDbTest): отказы скиллов
 * отвечали 502 вместо 422. Корень: {@code Response.Status.fromStatusCode(422)} возвращает null — 422 нет в enum
 * JAX-RS, — {@code Response.status(null)} падает NPE без текста, общий catch превращает его в 502
 * (в журнале «[LORE SKILL] skill:…: null»).
 * <p>Правило (частный фикс → правило): в коде бэкенда {@code Status.fromStatusCode(...)} не используется — код
 * ответа задаётся числом {@code Response.status(int)}, которое принимает любой код.
 */
class StatusFromCodeGuardTest {

    @Test
    void ловушка_422НетВEnumJaxRs() {
        // Положительный контроль причины: без него сторож охранял бы от несуществующей беды.
        assertNull(Response.Status.fromStatusCode(422));
    }

    @Test
    void отказСкиллаОтвечает422СТелом() {
        Response r = LoreSkillResource.refuse(422, SkillRules.refusedCycle(List.of("skill:a", "skill:b", "skill:a")));
        assertEquals(422, r.getStatus());
        assertEquals("REFUSED", ((Map<?, ?>) r.getEntity()).get("error"));
    }

    @Test
    void сторож_вКодеНетStatusFromStatusCode() throws IOException {
        List<String> hits = new ArrayList<>();
        try (Stream<Path> files = Files.walk(Path.of("src/main/java"))) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                List<String> lines = Files.readAllLines(f);
                for (int i = 0; i < lines.size(); i++)
                    if (lines.get(i).contains("Status.fromStatusCode(")) hits.add(f.getFileName() + ":" + (i + 1));
            }
        }
        assertTrue(hits.isEmpty(), "Status.fromStatusCode даёт null на кодах вне enum (422…) → NPE → 502; "
            + "задавайте код числом Response.status(int): " + hits);
    }
}
