package studio.seer.heimdall.lore;

import io.smallrye.health.api.HealthGroup;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.Callable;

/**
 * DBR-18: секреты мостов проверяются РАБОТОЙ, а не наличием.
 *
 * <p>{@code kc_configured=true} значило «секрет получен», а не «Keycloak его
 * принимает»; {@code ForgejoBridge.configured()} — «токен есть». Отозванный или
 * ротированный секрет давал зелёный деплой и мёртвый мост, а обнаруживался на
 * первом живом вызове.
 *
 * <p>Здесь — дешёвая проба без побочных эффектов: KC — токен по client
 * credentials; Forgejo — поиск репозиториев (см. probeForgejo). Результат кэшируется на
 * {@link #TTL}: проба ходит наружу, и делать её на каждый запрос нельзя.
 *
 * <p><b>Не readiness, а своя группа</b> ({@code /q/health/group/bridges}):
 * недоступный Keycloak выводил бы из ротации весь бэкенд, которому KC нужен
 * лишь для части путей. Группу читает шаг CD после выкатки.
 *
 * <p>Мост не настроен — UP с {@code probed=false}: ненастроенный мост —
 * законный режим установки (pluggable, ADR-LORE-025 D14), а его отсутствие
 * уже видно в readiness. DOWN — только «настроен, но не работает».
 */
@HealthGroup("bridges")
@ApplicationScoped
public class LoreBridgeProbeCheck implements HealthCheck {

    private static final Logger LOG = Logger.getLogger(LoreBridgeProbeCheck.class);
    static final Duration TTL = Duration.ofMinutes(5);
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5)).build();

    @Inject
    KcBridge kc;

    @Inject
    ForgejoBridge forgejo;

    /** Итог одной пробы: probed=false — проверять было нечего; error=null — работает. */
    record Probe(boolean probed, String error, long atMillis) {
        boolean up() { return !probed || error == null; }
    }

    private volatile Probe kcLast;
    private volatile Probe fjLast;

    @Override
    public HealthCheckResponse call() {
        // Проба не бросает наружу никогда. На #711 исключение внутри неё (NPE,
        // дефект кода) превратилось в DOWN без данных моста, и CD назвал это
        // «секрет отозван». Сбой самой пробы и неработающий секрет — разные
        // факты, и в ответе они разведены: probe_defect против *_error.
        try {
            long now = System.currentTimeMillis();
            Probe k = kcLast = fresh(kcLast, now, kc.configured(), this::probeKc);
            Probe f = fjLast = fresh(fjLast, now, forgejoProbeable(), this::probeForgejo);
            return HealthCheckResponse.named("lore-bridges-live")
                .status(k.up() && f.up())
                .withData("kc_probed", k.probed())
                .withData("kc_error", k.error() == null ? "" : k.error())
                .withData("forgejo_probed", f.probed())
                .withData("forgejo_error", f.error() == null ? "" : f.error())
                .withData("probe_defect", "")
                .withData("cache_seconds", TTL.toSeconds())
                .build();
        } catch (RuntimeException e) {
            LOG.errorf(e, "[LORE BRIDGES] сбой самой пробы — дефект кода, о секретах ничего не известно");
            return HealthCheckResponse.named("lore-bridges-live").down()
                .withData("probe_defect", e.getClass().getSimpleName() + ": " + e.getMessage())
                .build();
        }
    }

    /**
     * Чистое правило кэша и вердикта — тестируемо без сети. Свежий результат
     * отдаётся из кэша; мост не настроен — probed=false без похода наружу;
     * исключение пробы — DOWN с причиной, а не «UP, потому что упало тихо».
     */
    static Probe fresh(Probe last, long now, boolean configured, Callable<String> probe) {
        if (last != null && now - last.atMillis() < TTL.toMillis()
                && last.probed() == configured) return last;
        if (!configured) return new Probe(false, null, now);
        String err;
        try {
            err = probe.call();
        } catch (Exception e) {
            err = "проба упала: " + e.getMessage();
        }
        return new Probe(true, err, now);
    }

    /** null — Keycloak выдал токен по client credentials. */
    private String probeKc() {
        try {
            kc.adminToken();
            return null;
        } catch (Exception e) {
            LOG.warnf("[LORE BRIDGES] KC не принял учётку lore-admin: %s", e.getMessage());
            return "Keycloak не выдал токен lore-admin: " + e.getMessage();
        }
    }

    private boolean forgejoProbeable() {
        return forgejo.configured() && forgejo.probeBase().isPresent();
    }

    /**
     * null — Forgejo принял токен. Путь — поиск репозиториев, а не {@code /user}:
     * для {@code /user} токену нужно право read:user, которого у токена моста
     * может не быть, и проба краснела бы на исправном мосте. Чтение репозиториев
     * мост делает в работе всегда; несуществующий/отозванный токен Forgejo
     * отбивает 401 на любом пути.
     */
    private String probeForgejo() throws Exception {
        String base = forgejo.probeBase().orElseThrow();
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/v1/repos/search?limit=1"))
            .timeout(Duration.ofSeconds(10))
            .header("Authorization", "token " + forgejo.probeToken())
            .header("Accept", "application/json").GET().build();
        HttpResponse<Void> r = HTTP.send(req, HttpResponse.BodyHandlers.discarding());
        if (r.statusCode() == 200) return null;
        LOG.warnf("[LORE BRIDGES] Forgejo ответил %d на /api/v1/repos/search", r.statusCode());
        return "Forgejo ответил " + r.statusCode() + " на /api/v1/repos/search — токен отозван или без прав";
    }
}
