package studio.seer.heimdall.lore;

/**
 * DBR-05: достать НАСТОЯЩУЮ причину отказа ArcadeDB.
 *
 * <p>RESTEasy отдаёт наружу родовое сообщение вида
 * {@code Received: 'Internal Server Error, status code 500' when invoking REST
 * Client method: 'LoreCommandClient#command'}. Оно одинаково для всех отказов —
 * локаут креда, снесённый full-text индекс, синтаксическая ошибка в SQL. То, что
 * их различает, лежит в ТЕЛЕ ответа и по умолчанию теряется.
 *
 * <p>Пока причина не видна, любая другая починка идёт вслепую: отказ по локауту
 * и отказ по битому индексу выглядят снаружи одинаково.
 *
 * <p>Приём был написан в раннере миграций и работал только там. Здесь он вынесен
 * общим, чтобы рабочий путь (слайсы, запись) не пришлось править по 230 точкам
 * вызова поодиночке.
 */
final class LoreUpstream {

    private LoreUpstream() {}

    /**
     * Сообщение об ошибке с телом ответа, если оно есть.
     *
     * <p><b>Заголовки не читаются никогда.</b> В них лежит {@code Authorization},
     * и попадание его в лог было бы утечкой креда в обмен на диагностику.
     */
    static String detail(Throwable e) {
        String base = e.getMessage();
        if (e instanceof jakarta.ws.rs.WebApplicationException w) {
            try {
                String body = w.getResponse().readEntity(String.class);
                if (body != null && !body.isBlank()) {
                    // Тело, а не вместо: код ответа тоже нужен, а тело может
                    // оказаться усечённым или неинформативным.
                    return base + " | ответ БД: " + body.strip();
                }
            } catch (Exception ignored) {
                // Тело уже вычитано или недоступно — остаётся родовое сообщение,
                // и это не повод потерять исходную ошибку.
            }
        }
        return base;
    }

    // ── SPRINT_UXR_S1_HONEST_API/S1-03 (B-05): «база лежит» ≠ «запрос упал» ──
    //
    // Раньше каждая точка отдавала LORE_UPSTREAM, а клиент читает этот код как
    // «LORE недоступен» и заменяет ВСЮ страницу. Битый SQL одного слайса гасил
    // экран целиком при живой базе. Теперь код выбирает классификатор:
    //   LORE_UPSTREAM     — до базы не достучались (глобально, уровень страницы);
    //   LORE_QUERY_FAILED — база ответила ошибкой на этот запрос (уровень блока).
    // HTTP-статус остаётся 502 у обоих — различает код, клиенты по статусу не ломаются.

    /** База недоступна. Код прежний — miniLORE/MCP/веб уже читают его как «недоступен». */
    static final String DB_UNAVAILABLE = "LORE_UPSTREAM";
    /** База жива, упал конкретный запрос. */
    static final String QUERY_FAILED = "LORE_QUERY_FAILED";

    // Классы транспорта Vert.x/Netty, которые не наследуют java.net-исключения.
    private static final java.util.Set<String> TRANSPORT_CLASSES = java.util.Set.of(
        "io.vertx.core.http.HttpClosedException",
        "io.vertx.core.impl.NoStackTraceTimeoutException",
        "io.vertx.core.impl.NoStackTraceThrowable",
        "io.netty.handler.timeout.ReadTimeoutException",
        "io.netty.handler.timeout.WriteTimeoutException",
        "io.netty.channel.ConnectTimeoutException",
        "io.netty.channel.StacklessClosedChannelException");

    /**
     * До базы не достучались: отказ соединения/DNS/таймаут по всей цепочке
     * причин, либо ответ, общий для ЛЮБОГО запроса — 502/503/504 (прокси перед
     * базой) и 401/403 (кред отвергнут/локаут). Ответ базы ошибкой 4xx/5xx на
     * конкретный SQL — не сюда: это упавший запрос.
     */
    static boolean dbUnreachable(Throwable e) {
        java.util.Set<Throwable> seen = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        for (Throwable t = e; t != null && seen.add(t); t = t.getCause()) {
            if (t instanceof jakarta.ws.rs.WebApplicationException w && w.getResponse() != null) {
                int s = w.getResponse().getStatus();
                // База (или прокси перед ней) ответила — глубже не идём: статус решает.
                return s == 401 || s == 403 || s == 502 || s == 503 || s == 504;
            }
            if (t instanceof java.net.ConnectException
                || t instanceof java.net.UnknownHostException
                || t instanceof java.net.NoRouteToHostException
                || t instanceof java.net.SocketTimeoutException
                || t instanceof java.net.http.HttpTimeoutException
                || t instanceof java.util.concurrent.TimeoutException
                || t instanceof java.nio.channels.ClosedChannelException
                || TRANSPORT_CLASSES.contains(t.getClass().getName())) {
                return true;
            }
        }
        return false;
    }

    /** Тело ошибки с кодом по классификации; detail — как раньше, сообщение исключения. */
    static LoreResourceBase.LoreError error(Throwable e) {
        return error(e, e == null ? null : e.getMessage());
    }

    static LoreResourceBase.LoreError error(Throwable e, String detail) {
        return new LoreResourceBase.LoreError(dbUnreachable(e) ? DB_UNAVAILABLE : QUERY_FAILED,
            String.valueOf(detail));
    }

    /** Готовый 502 с классифицированным телом. */
    static jakarta.ws.rs.core.Response.ResponseBuilder failure(Throwable e) {
        return jakarta.ws.rs.core.Response.status(jakarta.ws.rs.core.Response.Status.BAD_GATEWAY).entity(error(e));
    }
}
