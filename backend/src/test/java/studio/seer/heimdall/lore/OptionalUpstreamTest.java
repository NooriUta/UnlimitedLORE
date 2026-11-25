package studio.seer.heimdall.lore;

import jakarta.ws.rs.ProcessingException;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_EXT_ISSUES_W2/ISS-03-OPTIONAL-SERVICES · опциональный upstream задан, но недоступен → 503 с причиной.
 *
 * <p><b>Повод:</b> issues SeidrStudio/UnlimitedLORE #3 (S3) и #7 (MART). Сервис задан, но не поднят: ответ — 502
 * {@code S3_UPSTREAM} / {@code MART_UPSTREAM} с сырым «Connect to localhost:9000 failed: Connection refused» при
 * зелёном healthcheck. Отказ выглядит поломкой, хотя это не развёрнутый сервис, и не говорит, что проверить.
 *
 * <p><b>Правило:</b> один помощник {@link OptionalUpstream} на все опциональные upstream: «недостижим» (отказ
 * соединения, неизвестный хост, таймаут соединения) → 503 {@code <SVC>_UNREACHABLE} + какую переменную проверить;
 * прочая ошибка сервиса → 502 {@code <SVC>_UPSTREAM}. Сторож: сырые коды и голый BAD_GATEWAY у этих upstream живут
 * только в помощнике. Чистый JUnit: Quarkus не поднимается, исходники читаются с диска.
 */
class OptionalUpstreamTest {

    // ── классификация ────────────────────────────────────────────────────────

    @Test
    void s3_отказ_соединения_внутри_SdkClientException_это_503_S3_UNREACHABLE_с_переменной() {
        Throwable e = SdkClientException.builder()
            .message("Unable to execute HTTP request: Connect to localhost:9000 failed: Connection refused")
            .cause(new ConnectException("Connection refused")).build();
        OptionalUpstream.Failure f = OptionalUpstream.classify(OptionalUpstream.Service.S3, e, "файл не загружен");
        assertEquals(503, f.status());
        assertEquals("S3_UNREACHABLE", f.code());
        assertTrue(f.detail().contains("S3_ENDPOINT"), "подсказка называет переменную: " + f.detail());
        assertTrue(f.detail().startsWith("файл не загружен"), "контекст вызова сохраняется: " + f.detail());
        assertFalse(f.detail().contains("Connection refused"), "сырой текст сокета наружу не идёт: " + f.detail());
    }

    @Test
    void s3_неизвестный_хост_и_таймаут_соединения_тоже_недостижим() {
        for (Throwable cause : new Throwable[]{new UnknownHostException("minio"), new SocketTimeoutException("connect timed out")}) {
            Throwable e = SdkClientException.builder().message("Unable to execute HTTP request").cause(cause).build();
            assertEquals("S3_UNREACHABLE", OptionalUpstream.classify(OptionalUpstream.Service.S3, e, "x").code(), cause.toString());
        }
    }

    @Test
    void s3_ответ_сервиса_с_ошибкой_остаётся_502_S3_UPSTREAM() {
        Throwable e = S3Exception.builder().statusCode(403).message("Access Denied").build();
        OptionalUpstream.Failure f = OptionalUpstream.classify(OptionalUpstream.Service.S3, e, "файл не загружен");
        assertEquals(502, f.status());
        assertEquals("S3_UPSTREAM", f.code());
        assertTrue(f.detail().contains("Access Denied"), "ошибка самого сервиса видна целиком: " + f.detail());
    }

    @Test
    void mart_отказ_соединения_rest_client_это_503_MART_UNREACHABLE_с_переменными() {
        Throwable e = new ProcessingException(new ConnectException("Connection refused: host.docker.internal/9300"));
        OptionalUpstream.Failure f = OptionalUpstream.classify(OptionalUpstream.Service.MART, e, "срез не прочитан");
        assertEquals(503, f.status());
        assertEquals("MART_UNREACHABLE", f.code());
        assertTrue(f.detail().contains("MART_ARCADE_URL"), f.detail());
        assertTrue(f.detail().contains("BENCH_MART_ENABLED"), "как выключить, если не нужен: " + f.detail());
    }

    @Test
    void только_текст_без_причины_тоже_распознаётся() {
        Throwable e = new RuntimeException("Connect to http://localhost:9000 failed: Connection refused");
        assertEquals("S3_UNREACHABLE", OptionalUpstream.classify(OptionalUpstream.Service.S3, e, "x").code());
    }

    @Test
    void посторонняя_ошибка_не_выдаётся_за_недоступность() {
        assertFalse(OptionalUpstream.unreachable(new IOException("disk full")));
        assertFalse(OptionalUpstream.unreachable(new IllegalArgumentException("bad key")));
        assertFalse(OptionalUpstream.unreachable(null));
    }

    // ── проба при старте ─────────────────────────────────────────────────────

    @Test
    void проба_при_старте_недоступен_значит_предупреждение_с_кодом_и_переменной() {
        Optional<String> w = OptionalUpstream.probe(OptionalUpstream.Service.S3, () -> {
            throw SdkClientException.builder().message("x").cause(new ConnectException("Connection refused")).build();
        });
        assertTrue(w.isPresent());
        assertTrue(w.get().contains("S3_UNREACHABLE") && w.get().contains("S3_ENDPOINT"), w.get());
        assertTrue(OptionalUpstream.probe(OptionalUpstream.Service.S3, () -> "ok").isEmpty(), "доступен — молчим");
    }

    @Test
    void проба_при_старте_ошибка_сервиса_тоже_предупреждение_но_с_кодом_UPSTREAM() {
        Optional<String> w = OptionalUpstream.probe(OptionalUpstream.Service.MART, () -> {
            throw new IllegalStateException("401 Unauthorized");
        });
        assertTrue(w.isPresent());
        assertTrue(w.get().contains("MART_UPSTREAM"), w.get());
    }

    // ── сторож: все опциональные upstream идут через помощника ───────────────

    private static final Path MAIN = Path.of("src/main/java/studio/seer/heimdall");
    private static final Pattern RAW_CODE = Pattern.compile("\"(S3|MART)_(UPSTREAM|UNREACHABLE)\"");
    /** Кто держит опциональный upstream: хранилище файлов — везде, витрина MART — в пакете bench. */
    private static final Pattern USES_S3 = Pattern.compile("\\bBragiS3Service\\s+\\w+\\s*;");
    private static final Pattern USES_MART = Pattern.compile("\\bMartClient\\s+\\w+\\s*;");

    /** Нарушения в одном исходнике: сырой код вне помощника или пользователь upstream без помощника. */
    static List<String> offenders(String rel, String src) {
        List<String> out = new ArrayList<>();
        if (rel.endsWith("OptionalUpstream.java")) return out;
        if (RAW_CODE.matcher(src).find())
            out.add(rel + ": код S3_/MART_ UPSTREAM|UNREACHABLE литералом — только через OptionalUpstream");
        boolean holder = USES_S3.matcher(src).find() && !rel.endsWith("BragiS3Service.java")
            || USES_MART.matcher(src).find() && rel.contains("/bench/");
        if (holder && !src.contains("OptionalUpstream."))
            out.add(rel + ": держит опциональный upstream, но отказ не идёт через OptionalUpstream");
        return out;
    }

    @Test
    void сторож_все_опциональные_upstream_через_помощника() throws IOException {
        assertTrue(Files.isDirectory(MAIN), "запуск не из backend/: " + MAIN.toAbsolutePath());
        List<String> bad = new ArrayList<>();
        int holders = 0;
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String rel = MAIN.relativize(p).toString().replace('\\', '/');
                String src = Files.readString(p);
                if (USES_S3.matcher(src).find() || USES_MART.matcher(src).find() && rel.contains("bench/")) holders++;
                bad.addAll(offenders("/" + rel, src));
            }
        }
        assertTrue(holders >= 4, "сторож видит держателей upstream (bragi, asset, profile, bench): " + holders);
        assertEquals(List.of(), bad);
    }

    @Test
    void сторож_ловит_гвоздь_положительный_контроль() {
        String nail = "class X { @Inject BragiS3Service s3; Response r() { return error(\"S3_UPSTREAM\"); } }";
        assertEquals(2, offenders("/lore/X.java", nail).size(), "и сырой код, и держатель без помощника");
        String mart = "class Y { @Inject @RestClient MartClient client; }";
        assertEquals(1, offenders("/bench/Y.java", mart).size());
        assertEquals(0, offenders("/lore/Z.java", mart).size(), "MartClient вне bench — основная база, не опциональна");
    }
}
