package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Логины людей — из Keycloak, а не выведенные (STAT-1, уточнение владельца
 * «логины у KC»).
 *
 * <p>LORE не наблюдает вход: он происходит в Keycloak, до всякого запроса сюда.
 * Поэтому «первый запрос после паузы» в {@link LoreRequestStats} — это НАЧАЛО
 * СЕССИИ, честная догадка, и она остаётся полезной для агентов (у них входа в KC
 * нет вовсе, они ходят по client_credentials). Для людей же есть настоящий факт,
 * и брать надо его: KC пишет события {@code LOGIN} со временем, пользователем и
 * клиентом.
 *
 * <p>Опрашивается редко (по умолчанию раз в 5 минут): события входа — не
 * телеметрия реального времени, а дёргать админ-API чаще значит греть Keycloak
 * впустую.
 *
 * <h2>Что делать, если событий нет</h2>
 * Пустой ответ законен (никто не входил), но он же выглядит как выключённое в
 * реалме сохранение Login Events. Различить снаружи нельзя, поэтому при первой
 * пустой выборке пишется одна поясняющая строка в лог — иначе «логинов нет»
 * читалось бы как факт, хотя это может быть неведение.
 */
@ApplicationScoped
public class LoreKcLoginPoller {

    private static final Logger LOG = Logger.getLogger(LoreKcLoginPoller.class);

    static final String M_LOGIN = "lore.login";

    @ConfigProperty(name = "lore.stats.enabled", defaultValue = "true")
    boolean statsEnabled;

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @ConfigProperty(name = "lore.stats.kc-poll-minutes", defaultValue = "5")
    int pollMinutes;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    KcBridge kc;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    private ScheduledExecutorService poller;
    /** Граница уже обработанного, epoch-ms. */
    private volatile long since;
    /** Идентификаторы событий последнего окна — чтобы не задвоить на границе. */
    private final Set<String> seen = new HashSet<>();
    private boolean emptyReported;

    @PostConstruct
    void start() {
        if (!statsEnabled || !loreEnabled) return;
        // Стартовая граница — «сейчас»: историю не вычитываем. Прошлые входы уже
        // прошли мимо, и задним числом они бы легли одной кучей на момент старта,
        // соврав про распределение по времени.
        since = System.currentTimeMillis();
        poller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-kc-login-poll");
            t.setDaemon(true);
            return t;
        });
        poller.scheduleAtFixedRate(this::pollQuietly, pollMinutes, pollMinutes, TimeUnit.MINUTES);
        LOG.infof("[LORE STATS] опрос логинов Keycloak включён, раз в %d мин", pollMinutes);
    }

    @PreDestroy
    void stop() {
        if (poller != null) poller.shutdown();
    }

    private void pollQuietly() {
        try {
            poll();
        } catch (Exception e) {
            // Недоступный Keycloak не имеет права ронять LORE: не собрали логины —
            // потеряли метрику, а не работу пользователя.
            LOG.warnf("[LORE STATS] опрос логинов KC не удался: %s", e.getMessage());
        }
    }

    void poll() throws Exception {
        if (!kc.configured()) return;   // секрет lore-admin не задан — молча не работаем
        String token = kc.adminToken();
        long from = since;
        long now = System.currentTimeMillis();

        HttpResponse<String> r = kc.kc("GET",
            "/events?type=LOGIN&max=500&dateFrom=" + java.time.Instant.ofEpochMilli(from)
                .atZone(java.time.ZoneOffset.UTC).toLocalDate(),
            null, token);
        if (r.statusCode() != 200) {
            LOG.warnf("[LORE STATS] KC /events → %d", r.statusCode());
            return;
        }

        JsonArray events = new JsonArray(r.body());
        int written = 0;
        Set<String> current = new HashSet<>();
        for (int i = 0; i < events.size(); i++) {
            JsonObject e = events.getJsonObject(i);
            long ts = e.getLong("time", 0L);
            if (ts < from) continue;            // dateFrom режет по суткам — досекундную границу держим сами
            String user = username(e);
            String key = ts + "|" + user + "|" + e.getString("clientId", "");
            if (seen.contains(key)) continue;   // окна перекрываются по границе суток
            current.add(key);
            if (write(Instant.ofEpochMilli(ts).toString(), user, e.getString("clientId", "unknown"))) written++;
        }
        seen.clear();
        seen.addAll(current);
        since = now;

        if (events.isEmpty() && !emptyReported) {
            emptyReported = true;
            LOG.info("[LORE STATS] KC вернул ноль событий LOGIN. Это либо никто не входил, "
                + "либо в реалме выключено сохранение Login Events — различить снаружи нельзя");
        }
        if (written > 0) LOG.debugf("[LORE STATS] логинов записано: %d", written);
    }

    /** Имя пользователя из события; KC кладёт его в details, id — отдельно. */
    private static String username(JsonObject e) {
        JsonObject d = e.getJsonObject("details");
        if (d != null) {
            String u = d.getString("username");
            if (u != null && !u.isBlank()) return u;
        }
        String uid = e.getString("userId");
        return uid == null || uid.isBlank() ? "unknown" : uid;
    }

    private boolean write(String ts, String user, String clientId) {
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "INSERT INTO MetricSnapshot SET ts=:ts, object_type='caller', object_id=:user, "
                + "metric=:m, source=:src, segment='human', value=1",
                Map.of("ts", ts, "user", user, "m", M_LOGIN, "src", clientId))).await().indefinitely();
            return true;
        } catch (Exception ex) {
            LOG.warnf("[LORE STATS] логин %s не записан: %s", user, LoreUpstream.detail(ex));
            return false;
        }
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (mart.user() + ":" + mart.password()).getBytes(StandardCharsets.UTF_8));
    }
}
