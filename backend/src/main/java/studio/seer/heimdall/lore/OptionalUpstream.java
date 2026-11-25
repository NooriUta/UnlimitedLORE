package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.http.HttpConnectTimeoutException;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.Callable;

/**
 * Опциональный upstream (хранилище файлов S3, витрина bench MART): задан, но недоступен — 503 с причиной и
 * переменной, которую проверить; ошибка самого сервиса — 502. Один помощник на все такие upstream
 * (SPRINT_LORE_EXT_ISSUES_W2/ISS-03-OPTIONAL-SERVICES, issues SeidrStudio/UnlimitedLORE #3 и #7).
 *
 * <p>Раньше отказ соединения уходил 502 {@code S3_UPSTREAM}/{@code MART_UPSTREAM} с сырым «Connection refused» при
 * зелёном healthcheck: отказ выглядел поломкой, хотя сервис просто не поднят, и не говорил, что проверить.
 * «Не задан» — отдельный случай, он ловится раньше ({@code FILES_NOT_CONFIGURED}, {@code MART_DISABLED}).
 *
 * <p>Сторож — {@code OptionalUpstreamTest}: коды {@code <SVC>_UPSTREAM|UNREACHABLE} литералом живут только здесь,
 * а каждый держатель upstream зовёт этот помощник.
 */
public final class OptionalUpstream {

    private OptionalUpstream() {}

    /** Опциональный upstream: имя, коды, что проверить и что без него деградирует. */
    public enum Service {
        S3("хранилище файлов S3",
            "проверьте S3_ENDPOINT (адрес должен быть виден из контейнера бэкенда, не localhost), S3_ACCESS_KEY и"
                + " S3_SECRET_KEY и что сервис S3 поднят; установка без файлов — оставьте S3_ENDPOINT пустым",
            "загрузка и отдача файлов (bragi_asset_up, asset_up, аватары); остальное работает"),
        MART("витрина bench (ArcadeDB, база RAGVSDL)",
            "проверьте MART_ARCADE_URL и что база RAGVSDL есть; bench не нужен — BENCH_MART_ENABLED=false",
            "срезы bench (bench_query_slice); остальное работает");

        final String what;
        final String hint;
        final String degrades;

        Service(String what, String hint, String degrades) {
            this.what = what;
            this.hint = hint;
            this.degrades = degrades;
        }

        public String unreachableCode() { return name() + "_UNREACHABLE"; }
        public String upstreamCode() { return name() + "_UPSTREAM"; }
    }

    /** Решение об ответе: статус, код, слова. */
    public record Failure(int status, String code, String detail) {
        public Response toResponse() {
            return Response.status(status).type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store")
                .entity(new LoreResourceBase.LoreError(code, detail)).build();
        }
    }

    /** Отказ сети до сервиса: соединение отвергнуто, хост неизвестен/недостижим, таймаут соединения. */
    static boolean unreachable(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause() == c ? null : c.getCause()) {
            if (c instanceof ConnectException || c instanceof UnknownHostException
                || c instanceof NoRouteToHostException || c instanceof HttpConnectTimeoutException) return true;
            if (c instanceof SocketTimeoutException && String.valueOf(c.getMessage()).toLowerCase(Locale.ROOT).contains("connect"))
                return true;
            String m = String.valueOf(c.getMessage()).toLowerCase(Locale.ROOT);
            if (m.contains("connection refused") || m.contains("no route to host")
                || m.contains("unknownhostexception") || m.contains("name or service not known")
                || m.matches("(?s).*connect to \\S+ failed.*")) return true;
        }
        return false;
    }

    /** Какой ответ дать на сбой вызова {@code s}; {@code context} — что не удалось («файл не загружен»). */
    public static Failure classify(Service s, Throwable t, String context) {
        String prefix = context == null || context.isBlank() ? "" : context + ": ";
        if (unreachable(t))
            return new Failure(503, s.unreachableCode(), prefix + s.what + " задано, но недоступно (нет соединения) — "
                + s.hint + ". Без него не работает: " + s.degrades + ".");
        return new Failure(502, s.upstreamCode(), prefix + s.what + " ответило ошибкой: " + String.valueOf(t == null ? null : t.getMessage()));
    }

    /** То же, сразу ответом. */
    public static Response failure(Service s, Throwable t, String context) {
        return classify(s, t, context).toResponse();
    }

    /** Проба при старте: пусто — доступен; иначе — строка предупреждения для журнала. Никогда не бросает. */
    static Optional<String> probe(Service s, Callable<?> call) {
        try {
            call.call();
            return Optional.empty();
        } catch (Throwable t) {
            Failure f = classify(s, t, "проба при старте");
            return Optional.of("[" + f.code() + "] " + f.detail());
        }
    }
}
